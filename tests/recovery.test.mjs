import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { StdioPool } from '../src/runtime/stdio.mjs';

test('stdio process supervisor replaces crashed worker and continues serving requests',async t=>{
  const pool=new StdioPool({command:process.execPath,args:[resolve('examples/echo-stdio.mjs')],replicas:1});
  await pool.start();t.after(()=>pool.stop());
  const original=pool.status().workers[0].pid;
  process.kill(original,'SIGKILL');
  let restored=false;
  for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,100));const current=pool.status();if(current.workers[0]?.running&&current.workers[0].pid!==original){restored=true;break;}}
  assert.equal(restored,true,'process supervisor should replace a crashed subprocess');
  const response=await pool.request('tools/call',{name:'echo',arguments:{text:'recover'}});
  assert.equal(response.content[0].text,'recover');
});
