#!/usr/bin/env node
// Real MCP stdio test server: JSON-RPC line framing, initialize, tools/list, tools/call.
import readline from 'node:readline';
const tools=[
  { name:'echo', description:'Return the input text', inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']} },
  { name:'sleep', description:'Sleep for a specified number of milliseconds', inputSchema:{type:'object',properties:{ms:{type:'integer',minimum:0,maximum:5000}},required:['ms']} },
  { name:'echo_bytes', description:'Produce a text payload of up to 10 MiB for transport benchmarks', inputSchema:{type:'object',properties:{bytes:{type:'integer',minimum:1,maximum:10485760}},required:['bytes']} },
  { name:'fibonacci', description:'Compute fibonacci(n) synchronously to demonstrate CPU load', inputSchema:{type:'object',properties:{n:{type:'integer',minimum:0,maximum:38}},required:['n']} }
];
const fib=n=>n<2?n:fib(n-1)+fib(n-2);
export async function dispatch(method,params={}) {
  if(method==='initialize') return {protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'echo-stdio',version:'0.1.0'}};
  if(method==='tools/list') return {tools};
  if(method==='tools/call') {
    const a=params.arguments||{};
    if(params.name==='echo') { if(typeof a.text!=='string') throw new Error('text must be string'); return {content:[{type:'text',text:a.text}]}; }
    if(params.name==='sleep') {const ms=Number(a.ms); if(!Number.isInteger(ms)||ms<0||ms>5000)throw new Error('ms 0..5000 required'); await new Promise(r=>setTimeout(r,ms));return {content:[{type:'text',text:`Slept ${ms}ms`}]};}
    if(params.name==='echo_bytes') {const bytes=Number(a.bytes);if(!Number.isInteger(bytes)||bytes<1||bytes>10485760)throw new Error('bytes must be 1..10485760');return {content:[{type:'text',text:'X'.repeat(bytes)}]};}
    if(params.name==='fibonacci') {const n=Number(a.n);if(!Number.isInteger(n)||n<0||n>38)throw new Error('n 0..38 required'); return {content:[{type:'text',text:String(fib(n))}]};}
    throw new Error(`Unknown tool: ${params.name}`);
  }
  if(method==='ping') return {};
  throw new Error(`Unknown method: ${method}`);
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  rl.on('line', async line=> {
    let req;
    try {req=JSON.parse(line);} catch {return;}
    if(!('id' in req))return;
    try {const result=await dispatch(req.method,req.params);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\n');}
    catch(e){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,error:{code:-32603,message:e.message}})+'\n');}
  });
}
