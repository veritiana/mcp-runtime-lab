import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { KubernetesAdapter } from '../src/adapters/kubernetes.mjs';
import { HttpMcpClient } from '../src/runtime/http-client.mjs';

test('Kubernetes adapter creates namespace-scoped workload with restricted security context',()=>{
  const a=new KubernetesAdapter({k8sNamespace:'mcp-system',k8sApiUrl:'http://127.0.0.1',k8sBearerToken:'test'});
  const s={id:'risk-mcp',replicas:3,image:'example/mcp:1',containerPort:8080,endpointPath:'/mcp'};
  const d=a.deployment(s),svc=a.service(s);
  assert.equal(d.metadata.namespace,'mcp-system');assert.equal(d.spec.replicas,3);
  assert.equal(d.spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation,false);
  assert.equal(d.spec.template.spec.automountServiceAccountToken,false);
  assert.equal(svc.spec.type,'ClusterIP');
});
test('HTTP MCP client performs protocol initialize and tools call',async t=>{
  const methods=[];
  const server=http.createServer(async(req,res)=>{const parts=[];for await(const c of req)parts.push(c);const m=JSON.parse(Buffer.concat(parts));methods.push(m.method);
    if(m.method==='notifications/initialized'){res.writeHead(202);return res.end();}
    const result=m.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}:m.method==='tools/list'?{tools:[{name:'hello'}]}:{};
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const client=new HttpMcpClient({url:`http://127.0.0.1:${server.address().port}/mcp`});
  const a=await client.request('tools/list');const b=await client.request('tools/list');assert.equal(a.tools[0].name,'hello');assert.equal(b.tools[0].name,'hello');
  assert.equal(methods.filter(x=>x==='initialize').length,1);
});
