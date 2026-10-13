// CLI standalone benchmark. Requires running MCP runtime with a registered echo server.
const base=process.env.BASE_URL||'http://127.0.0.1:8787';
const token=process.env.MCP_ADMIN_TOKEN;if(!token)throw new Error('Set MCP_ADMIN_TOKEN');
const serverId=process.argv[2]||'echo-local', concurrent=Number(process.argv[3]||10), durationSeconds=Number(process.argv[4]||5);
async function api(route,body){const res=await fetch(base+route,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});const obj=await res.json();if(!res.ok)throw new Error(JSON.stringify(obj));return obj;}
const bench=await api(`/api/servers/${serverId}/benchmark`,{tool:'echo',arguments:{text:'load test'},concurrency:concurrent,durationSeconds});
console.log('Started',bench.id);
let result;for(let i=0;i<35;i++){await new Promise(r=>setTimeout(r,1000));const response=await fetch(`${base}/api/benchmarks/${bench.id}`,{headers:{authorization:`Bearer ${token}`}});result=await response.json();if(result.status==='complete')break;}
console.log(JSON.stringify(result,null,2));
if(result.status!=='complete'||result.completed===0)process.exitCode=1;
