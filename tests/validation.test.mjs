import test from 'node:test';
import assert from 'node:assert/strict';
import { validateServer, publicServer } from '../src/validate.mjs';
import { configFromEnv, assertSecureConfig } from '../src/config.mjs';

test('validates stdio process and strips secrets from public view',()=>{
  const s=validateServer({id:'local-mcp',name:'Local MCP',kind:'stdio',command:'node',args:['file.mjs'],env:{MY_SECRET:'secret'},replicas:3});
  assert.equal(s.replicas,3);assert.deepEqual(publicServer(s).envKeys,['MY_SECRET']);assert.equal(publicServer(s).env,undefined);
});
test('rejects malformed workloads and dangerous ids',()=>{
  for(const id of ['../etc/passwd','ABC','x','bad_name'])assert.throws(()=>validateServer({id,kind:'stdio',name:'x',command:'node'}));
  assert.throws(()=>validateServer({kind:'stdio',name:'x',command:'node',replicas:100}));
  assert.throws(()=>validateServer({kind:'http',name:'x',url:'file:///etc/passwd'}));
  assert.throws(()=>validateServer({kind:'docker',name:'x',image:'evil;rm -rf /'}));
});
test('configuration refuses default or identical admin credentials',()=>{
  assert.throws(()=>assertSecureConfig(configFromEnv({MCP_ADMIN_TOKEN:'abc',MCP_AGENT_TOKEN:'abcd'})));
  assert.throws(()=>assertSecureConfig(configFromEnv({MCP_ADMIN_TOKEN:'a'.repeat(32),MCP_AGENT_TOKEN:'a'.repeat(32)})));
});
