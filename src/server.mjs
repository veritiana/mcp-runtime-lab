import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { publicServer } from './validate.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const assetDir=join(here,'web');
const MAX_BODY=1024*1024;
const json=(res,code,obj,headers={})=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(obj));};
function compareToken(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function bearer(req){const match=/^Bearer (.+)$/i.exec(req.headers.authorization||'');return match?.[1]||'';}
function auth(req,config,level='admin') {const token=bearer(req);return compareToken(token,config.adminToken)||(level==='agent'&&compareToken(token,config.agentToken));}
async function readBody(req) {
  if(!['application/json','application/json; charset=utf-8'].includes((req.headers['content-type']||'').toLowerCase()))throw Object.assign(new Error('Expected application/json'),{statusCode:415});
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw Object.assign(new Error('Request body exceeds 1 MiB'),{statusCode:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{statusCode:400});}
}
function errorCode(e){return Number.isInteger(e.statusCode)?e.statusCode:/already|in progress/i.test(e.message)?409:/not found/i.test(e.message)?404:400;}
const asyncWrap=fn=>async (req,res)=>{try{await fn(req,res);}catch(e){json(res,errorCode(e),{error:e.message||'Unknown error'});}};
function requireAuth(req,res,config,level='admin'){if(auth(req,config,level))return true;json(res,401,{error:'Unauthorized'}, {'www-authenticate':'Bearer realm="mcp-runtime-lab"'});return false;}
async function serveAsset(res,name) {
  const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};
  if(!files[name])return false;
  const content=await readFile(join(assetDir,files[name]));
  const ext=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html';
  res.writeHead(200,{'content-type':ext+'; charset=utf-8','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",'cache-control':'no-cache'});res.end(content);return true;
}
export function createApi(manager,config){
  const handler=asyncWrap(async(req,res)=>{
    // Always require explicit bearer tokens for API and MCP. No CORS, no cookies.
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    const path=u.pathname;
    if(req.method==='GET'&&path==='/healthz')return json(res,200,{ok:true,service:'mcp-runtime-lab'});
    if(req.method==='GET'&&path==='/readyz')return json(res,200,{ok:true});
    if(req.method==='GET'&&await serveAsset(res,path))return;
    if(path.startsWith('/mcp/')){
      if(!requireAuth(req,res,config,'agent'))return;
      const id=decodeURIComponent(path.slice('/mcp/'.length));
      if(req.method!=='POST'){res.writeHead(405,{allow:'POST'});return res.end();}
      const origin=req.headers.origin;
      if(origin){let parsed;try{parsed=new URL(origin);}catch{return json(res,403,{error:'Invalid origin'});}if(parsed.hostname!==new URL(`http://${req.headers.host||'localhost'}`).hostname)return json(res,403,{error:'Untrusted origin'});}
      const msg=await readBody(req);
      if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return json(res,400,{error:'Expected JSON-RPC 2.0 request'});
      manager.require(id);
      if(msg.id===undefined){res.writeHead(202);return res.end();}
      try{
        let result;
        if(msg.method==='initialize')result={protocolVersion:'2025-11-25',serverInfo:{name:`mcp-runtime-lab/${id}`,version:'0.1.0'},capabilities:{tools:{listChanged:false}}};
        else if(msg.method==='ping')result={};
        else if(['tools/list','tools/call','resources/list','resources/read','prompts/list','prompts/get'].includes(msg.method))result=await manager.request(id,msg.method,msg.params||{});
        else return json(res,200,{jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}});
        return json(res,200,{jsonrpc:'2.0',id:msg.id,result});
      }catch(e){return json(res,200,{jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:e.message}});}
    }
    if(!path.startsWith('/api/')&&!path.startsWith('/metrics')){return json(res,404,{error:'Not found'});}
    if(!requireAuth(req,res,config))return;
    if(req.method==='GET'&&path==='/api/auth')return json(res,200,{authenticated:true});
    if(req.method==='GET'&&path==='/metrics'){res.writeHead(200,{'content-type':'text/plain; version=0.0.4','cache-control':'no-store'});return res.end(manager.metrics.prometheus({processes:manager.activeProcesses()}));}
    if(req.method==='GET'&&path==='/api/overview'){
      const servers=await manager.list();return json(res,200,{servers,metrics:manager.metrics.snapshot(),history:manager.store.state.history.slice(0,25),benchmarks:manager.store.state.benchmarks.slice(0,10),adapters:{docker:manager.docker.available(),kubernetes:'configured'},version:'0.1.0'});
    }
    if(req.method==='GET'&&path==='/api/servers')return json(res,200,{servers:await manager.list()});
    if(req.method==='POST'&&path==='/api/servers')return json(res,201,await manager.create(await readBody(req)));
    const match=/^\/api\/servers\/([a-z0-9-]+)(?:\/(start|stop|restart|scale|inspect|call|logs|status|benchmark))?$/.exec(path);
    if(match){
      const id=match[1],action=match[2];
      if(!action){if(req.method==='GET')return json(res,200,publicServer(manager.require(id)));if(req.method==='PUT')return json(res,200,await manager.update(id,await readBody(req)));if(req.method==='DELETE')return json(res,200,await manager.remove(id));}
      if(req.method==='GET'&&action==='inspect')return json(res,200,await manager.inspect(id));
      if(req.method==='GET'&&action==='logs')return json(res,200,{lines:await manager.logs(id)});
      if(req.method==='GET'&&action==='status')return json(res,200,await manager.status(manager.require(id)));
      if(req.method==='POST'&&action==='start')return json(res,200,await manager.start(id));
      if(req.method==='POST'&&action==='stop')return json(res,200,await manager.stop(id));
      if(req.method==='POST'&&action==='restart')return json(res,200,await manager.restart(id));
      if(req.method==='POST'&&action==='scale'){const {replicas}=await readBody(req);return json(res,200,await manager.scale(id,replicas));}
      if(req.method==='POST'&&action==='call'){
        const body=await readBody(req);
        if(typeof body.tool!=='string'||body.tool.length>200)throw new Error('tool required');
        return json(res,200,{result:await manager.request(id,'tools/call',{name:body.tool,arguments:body.arguments||{}})});
      }
      if(req.method==='POST'&&action==='benchmark')return json(res,202,await manager.benchmark(id,await readBody(req)));
    }
    const bm=/^\/api\/benchmarks\/([\w-]+)$/.exec(path);
    if(req.method==='GET'&&bm){const x=manager.findBenchmark(bm[1]);return x?json(res,200,x):json(res,404,{error:'Benchmark not found'});}
    return json(res,404,{error:'Route not found'});
  });
  const server=http.createServer(handler);
  server.requestTimeout=20_000;server.headersTimeout=10_000;server.keepAliveTimeout=5_000;
  return server;
}
