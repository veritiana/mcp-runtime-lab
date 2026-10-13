import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { JsonStore } from '../src/storage.mjs';
import { RuntimeManager } from '../src/runtime/manager.mjs';
import { createApi } from '../src/server.mjs';

const token='admin-token-for-test-0123456789abcdef',agent='agent-token-for-test-0123456789abcdef';
let fixture;
async function request(path,method='GET',body,cred=token){
  const result=await fetch(fixture.url+path,{method,headers:{...(cred?{authorization:`Bearer ${cred}`}:{})},...(body!==undefined?{body:JSON.stringify(body),headers:{...(cred?{authorization:`Bearer ${cred}`}:{}),'content-type':'application/json'}}:{})});
  const data=await result.text();return {status:result.status,data:data?JSON.parse(data):null,headers:result.headers};
}
test('full control plane integration',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'mcp-lab-test-'));
  const store=new JsonStore(dir);await store.init();
  const config={adminToken:token,agentToken:agent,dockerEnabled:false,dockerSocket:'/does-not-exist',dockerNetwork:'',k8sNamespace:'lab',k8sApiUrl:'http://127.0.0.1:1',k8sBearerToken:'abc'};
  const manager=new RuntimeManager(store,config);
  const server=createApi(manager,config);server.listen(0,'127.0.0.1');await once(server,'listening');fixture={url:`http://127.0.0.1:${server.address().port}`,manager,store};
  t.after(async()=>{await manager.shutdown();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  await t.test('dashboard is served; APIs require bearer',async()=>{
    const page=await fetch(fixture.url);assert.equal(page.status,200);assert.match(await page.text(),/MCP Runtime Lab/);
    assert.equal((await request('/api/servers','GET',undefined,null)).status,401);
    assert.equal((await request('/api/auth','GET',undefined,agent)).status,401);
    assert.equal((await request('/api/auth')).status,200);
  });
  await t.test('register local stdio, start and inspect',async()=>{
    const creation=await request('/api/servers','POST',{id:'echo-test',name:'Echo Test',kind:'stdio',command:process.execPath,args:[resolve('examples/echo-stdio.mjs')],replicas:2,env:{SECURE_SECRET:'not-exposed'}});
    assert.equal(creation.status,201);assert.deepEqual(creation.data.envKeys,['SECURE_SECRET']);assert.equal(JSON.stringify(creation.data).includes('not-exposed'),false);
    const started=await request('/api/servers/echo-test/start','POST',{});assert.equal(started.status,200);assert.equal(started.data.replicas,2);
    const inspect=await request('/api/servers/echo-test/inspect');assert.equal(inspect.status,200);assert.ok(inspect.data.tools.find(x=>x.name==='echo'));
    const call=await request('/api/servers/echo-test/call','POST',{tool:'echo',arguments:{text:'hello kernel'}});assert.equal(call.data.result.content[0].text,'hello kernel');
  });
  await t.test('real MCP JSON-RPC Streamable HTTP works without extra port',async()=>{
    const headers={'content-type':'application/json','accept':'application/json, text/event-stream','authorization':`Bearer ${agent}`};
    const init=await fetch(fixture.url+'/mcp/echo-test',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}})});
    const initData=await init.json();assert.equal(init.status,200);assert.equal(initData.result.protocolVersion,'2025-11-25');
    const list=await fetch(fixture.url+'/mcp/echo-test',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})});
    assert.equal((await list.json()).result.tools[0].name,'echo');
    const call=await fetch(fixture.url+'/mcp/echo-test',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'fibonacci',arguments:{n:10}}})});
    assert.equal((await call.json()).result.content[0].text,'55');
    assert.equal((await request('/mcp/echo-test','POST',{jsonrpc:'2.0',id:10,method:'tools/list'},null)).status,401);
  });
  await t.test('10 MiB MCP stdout payload is transferred through local IPC',async()=>{
    const response=await manager.request('echo-test','tools/call',{name:'echo_bytes',arguments:{bytes:10*1024*1024}});
    assert.equal(response.content[0].text.length,10*1024*1024);
  });
  await t.test('scale two workers to three, and restart',async()=>{
    const scaled=await request('/api/servers/echo-test/scale','POST',{replicas:3});assert.equal(scaled.data.replicas,3);
    const restart=await request('/api/servers/echo-test/restart','POST',{});assert.equal(restart.data.replicas,3);
  });
  await t.test('benchmark produces metrics and recorded result',async()=>{
    const start=await request('/api/servers/echo-test/benchmark','POST',{tool:'echo',arguments:{text:'load'},concurrency:5,durationSeconds:1});assert.equal(start.status,202);
    let result;for(let i=0;i<35;i++){await new Promise(r=>setTimeout(r,100));result=(await request(`/api/benchmarks/${start.data.id}`)).data;if(result.status==='complete')break;}
    assert.equal(result.status,'complete');assert.ok(result.completed>1);assert.ok(result.callsPerSecond>0);
    const metrics=await fetch(fixture.url+'/metrics',{headers:{authorization:`Bearer ${token}`}});assert.match(await metrics.text(),/mcp_runtime_calls_total/);
    const overview=(await request('/api/overview')).data;assert.ok(overview.metrics.callsTotal>1);assert.ok(overview.benchmarks.length>0);
  });
  await t.test('stop, update, persist and delete',async()=>{
    const stop=await request('/api/servers/echo-test/stop','POST',{});assert.equal(stop.data.status,'stopped');
    const stoppedCall=await request('/api/servers/echo-test/call','POST',{tool:'echo',arguments:{text:'x'}});assert.equal(stoppedCall.status,400);
    const updated=await request('/api/servers/echo-test','PUT',{name:'Updated Echo',replicas:1});assert.equal(updated.data.name,'Updated Echo');
    assert.equal(updated.data.replicas,1);
    const read=new JsonStore(dir);await read.init();assert.equal(read.servers[0].name,'Updated Echo');
    const data=JSON.parse(await readFile(join(dir,'registry.json')));assert.equal(data.servers.length,1);
    const removed=await request('/api/servers/echo-test','DELETE');assert.equal(removed.status,200);
    assert.equal((await request('/api/servers')).data.servers.length,0);
  });
});
