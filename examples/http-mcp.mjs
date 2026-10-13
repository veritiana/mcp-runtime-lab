#!/usr/bin/env node
// Stateless MCP over Streamable HTTP (JSON responses only) for Docker/K8s deployment.
import http from 'node:http';
import { dispatch } from './echo-stdio.mjs';
const port=Number(process.env.PORT||8080);
const server=http.createServer(async (req,res)=>{
  if(req.url==='/healthz') {res.writeHead(200,{'content-type':'application/json'});return res.end('{"ok":true}');}
  if(req.url!=='/mcp' || req.method!=='POST') {res.writeHead(404);return res.end();}
  let body=''; for await(const c of req) {body+=c;if(body.length>8*1024*1024){res.writeHead(413);return res.end();}}
  try {const p=JSON.parse(body); if(!('id' in p)){res.writeHead(202);return res.end();} const result=await dispatch(p.method,p.params);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:p.id,result}));}
  catch(e){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32603,message:e.message}}));}
});
server.listen(port,'0.0.0.0',()=>console.log('echo-http MCP listening on',port));
