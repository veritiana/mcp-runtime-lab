import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { DockerAdapter } from '../src/adapters/docker.mjs';
import { KubernetesAdapter } from '../src/adapters/kubernetes.mjs';

test('Docker provider: create, start, inspect, read logs, stop, remove via Unix socket API',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'docker-mock-')), socket=join(dir,'docker.sock');
  let container=null;
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const data=chunks.length?JSON.parse(Buffer.concat(chunks)) : {};
    let code=200,result={};
    if(req.method==='POST'&&req.url.startsWith('/v1.43/containers/create')){container={Id:'fake-container-id',Config:data,State:{Running:false,Status:'created'},NetworkSettings:{Ports:{'8080/tcp':[{HostPort:'49199'}]}}};result={Id:container.Id};}
    else if(req.method==='GET'&&req.url.endsWith('/json')) {if(!container)code=404;else result=container;}
    else if(req.method==='POST'&&req.url.endsWith('/start')) {container.State={Running:true,Status:'running'};}
    else if(req.method==='POST'&&req.url.includes('/stop')) {container.State={Running:false,Status:'exited'};}
    else if(req.method==='GET'&&req.url.includes('/logs')) {const payload=Buffer.from('server startup\n'),head=Buffer.alloc(8);head[0]=1;head.writeUInt32BE(payload.length,4);res.writeHead(200,{'content-type':'application/octet-stream'});return res.end(Buffer.concat([head,payload]));}
    else if(req.method==='DELETE')container=null;
    else code=404;
    res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(result));
  });server.listen(socket);await once(server,'listening');t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const adapter=new DockerAdapter({dockerEnabled:true,dockerSocket:socket,dockerNetwork:''});
  const c={id:'echo-docker',image:'mcp-runtime-example:local',containerPort:8080,endpointPath:'/mcp'};
  const status=await adapter.start(c);assert.equal(status.status,'running');assert.match(status.endpoint,/49199/);
  const logs=await adapter.logs(c);assert.match(logs[0],/server startup/);
  await adapter.stop(c);assert.equal((await adapter.status(c)).status,'exited');
  await adapter.remove(c);assert.equal((await adapter.status(c)).status,'not-deployed');
});

test('Kubernetes provider: namespace deployment/service lifecycle against mocked API',async t=>{
  const entries=new Map();let scaled=0;
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
    const path=decodeURIComponent(req.url);
    let result={},code=200;
    if(req.method==='POST'){entries.set(`${path}/${body.metadata.name}`,body);result=body;}
    else if(req.method==='GET'){if(entries.has(path))result=entries.get(path);else if(path.includes('/pods?'))result={items:[]};else code=404;}
    else if(req.method==='PATCH'&&path.endsWith('/scale')) {scaled=body.spec.replicas;result={status:{replicas:scaled}};}
    else if(req.method==='PATCH'){result=body;}
    else if(req.method==='DELETE'){entries.delete(path);result={};}
    else code=404;
    res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(result));
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}`;
  const adapter=new KubernetesAdapter({k8sNamespace:'mcp-system',k8sApiUrl:url,k8sBearerToken:'mock-token',k8sCaFile:'/missing'});
  const c={id:'echo-k8s',replicas:2,image:'mcp-runtime-example:local',containerPort:8080,endpointPath:'/mcp'};
  await adapter.start(c);
  const d=entries.get('/apis/apps/v1/namespaces/mcp-system/deployments/echo-k8s');
  assert.equal(d.metadata.labels['app.kubernetes.io/managed-by'],'mcp-runtime-lab');
  assert.ok(entries.has('/api/v1/namespaces/mcp-system/services/echo-k8s'));
  await adapter.scale(c,4);assert.equal(scaled,4);
  await adapter.stop(c);assert.equal(scaled,0);
  await adapter.remove(c);assert.equal(entries.size,0);
});
