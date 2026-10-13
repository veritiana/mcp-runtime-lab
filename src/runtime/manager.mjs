import { StdioPool } from './stdio.mjs';
import { HttpMcpClient } from './http-client.mjs';
import { DockerAdapter } from '../adapters/docker.mjs';
import { KubernetesAdapter } from '../adapters/kubernetes.mjs';
import { Metrics } from '../metrics.mjs';
import { publicServer, validateServer } from '../validate.mjs';
import { randomUUID } from 'node:crypto';

export class RuntimeManager {
  constructor(store,config) {
    this.store=store;this.config=config;this.stdio=new Map();this.remote=new Map();this.metrics=new Metrics();
    this.docker=new DockerAdapter(config);this.k8s=new KubernetesAdapter(config);this.benchmarks=new Map();this.mutating=new Set();
  }
  async restore() {for(const server of this.store.servers.filter(s=>s.enabled&&s.kind==='stdio')){try{await this.startInternal(server);}catch(e){console.error(`Restore ${server.id}:`,e.message);}}}
  async list() { return Promise.all(this.store.servers.map(async s=>({ ...publicServer(s),runtime:await this.status(s).catch(e=>({status:'error',error:e.message})) }))); }
  async status(server) {
    if(server.kind==='stdio')return this.stdio.get(server.id)?.status()||{status:'stopped',replicas:0};
    if(server.kind==='http')return this.remote.get(server.id)?.status()||{status:'configured',replicas:1};
    return (server.kind==='docker'?this.docker:this.k8s).status(server);
  }
  async create(input) {
    const server=validateServer(input);if(this.store.getServer(server.id))throw new Error('Server id already exists');
    const autoStart=server.enabled;server.enabled=false;
    await this.store.change(s=>s.servers.push(server)); await this.store.record('create',server.id);
    if(autoStart)await this.start(server.id);
    return publicServer(this.store.getServer(server.id));
  }
  async update(id,input) {
    const old=this.require(id);if(old.enabled)throw new Error('Stop the server before editing configuration');
    const next=validateServer(input,{previous:old});next.enabled=false;
    await this.store.change(state=>{state.servers.splice(state.servers.findIndex(s=>s.id===id),1,next);});
    this.remote.delete(id);await this.store.record('update',id);return publicServer(next);
  }
  require(id){const s=this.store.getServer(id);if(!s)throw Object.assign(new Error('Server not found'),{statusCode:404});return s;}
  async startInternal(server){
    if(server.kind==='stdio'){
      let pool=this.stdio.get(server.id);
      if(!pool){pool=new StdioPool(server);this.stdio.set(server.id,pool);}
      await pool.start();
    } else if(server.kind==='http') {this.remote.set(server.id,new HttpMcpClient(server));}
    else await (server.kind==='docker'?this.docker:this.k8s).start(server);
  }
  async mutate(id,job){
    if(this.mutating.has(id))throw Object.assign(new Error('Operation already in progress'),{statusCode:409});
    this.mutating.add(id);
    try{return await job();}finally{this.mutating.delete(id);}
  }
  async start(id){return this.mutate(id,async()=>{const s=this.require(id);await this.startInternal(s);await this.store.change(()=>{s.enabled=true;});await this.store.record('start',id);return this.status(s);});}
  async stopInternal(s){
    if(s.kind==='stdio') {await this.stdio.get(s.id)?.stop();this.stdio.delete(s.id);}
    else if(s.kind==='http')this.remote.delete(s.id);
    else await (s.kind==='docker'?this.docker:this.k8s).stop(s);
  }
  async stop(id){return this.mutate(id,async()=>{const s=this.require(id);await this.stopInternal(s);await this.store.change(()=>{s.enabled=false;});await this.store.record('stop',id);return this.status(s);});}
  async restart(id){return this.mutate(id,async()=>{const s=this.require(id);
    if(s.kind==='stdio'||s.kind==='http'){await this.stopInternal(s);await this.startInternal(s);}
    else await (s.kind==='docker'?this.docker:this.k8s).restart(s);
    await this.store.change(()=>{s.enabled=true;});await this.store.record('restart',id);return this.status(s);
  });}
  async scale(id,replicas){return this.mutate(id,async()=>{
    const s=this.require(id);if(!Number.isInteger(replicas)||replicas<1||replicas>32)throw new Error('replicas must be 1..32');
    if(s.kind==='http'||s.kind==='docker')throw new Error('Scaling supported for stdio and Kubernetes only');
    if(s.kind==='stdio') {
      if(!s.enabled)throw new Error('Start server before scaling');
      await this.stdio.get(id).scale(replicas);
    } else await this.k8s.scale(s,replicas);
    await this.store.change(()=>{s.replicas=replicas;});await this.store.record('scale',id,replicas);return this.status(s);
  });}
  async remove(id){return this.mutate(id,async()=>{
    const s=this.require(id);await this.stopInternal(s);
    if(s.kind==='docker'||s.kind==='kubernetes')await (s.kind==='docker'?this.docker:this.k8s).remove(s);
    await this.store.change(x=>{x.servers=x.servers.filter(q=>q.id!==id);});await this.store.record('remove',id);return {deleted:id};
  });}
  async request(serverId,method,params={}) {
    const start=performance.now();let success=false;
    try {
      const server=this.require(serverId);
      if(!server.enabled)throw new Error('Server stopped');
      let backend;
      if(server.kind==='stdio')backend=this.stdio.get(serverId);
      else if(server.kind==='http') {
        if(!this.remote.has(serverId))this.remote.set(serverId,new HttpMcpClient(server));
        backend=this.remote.get(serverId);
      } else {
        const status=await this.status(server);
        if(!status.endpoint)throw new Error('No reachable MCP endpoint');
        const cached=this.remote.get(serverId);
        if(!cached||cached.url!==status.endpoint)this.remote.set(serverId,new HttpMcpClient({url:status.endpoint}));
        backend=this.remote.get(serverId);
      }
      if(!backend)throw new Error('Runtime not started');
      const result=await backend.request(method,params);
      success=true;return result;
    } finally {this.metrics.record(serverId,method,performance.now()-start,success);}
  }
  async inspect(id) {
    // Discover advertised capabilities first: absent optional capabilities are not errors.
    const tools = await Promise.allSettled([this.request(id,'tools/list',{})]);
    const caps = this.stdio.get(id)?.workers.find(w=>w.initialized)?.serverInfo?.capabilities || this.remote.get(id)?.info?.capabilities || {};
    const optional = await Promise.allSettled([
      caps.resources ? this.request(id,'resources/list',{}) : Promise.resolve({resources:[]}),
      caps.prompts ? this.request(id,'prompts/list',{}) : Promise.resolve({prompts:[]})
    ]);
    const [t]=tools,[resources,prompts]=optional;
    return {tools:t.status==='fulfilled'?t.value.tools||[]:[],resources:resources.status==='fulfilled'?resources.value.resources||[]:[],prompts:prompts.status==='fulfilled'?prompts.value.prompts||[]:[],warnings:[t,resources,prompts].filter(x=>x.status==='rejected').map(x=>x.reason.message)};
  }
  async logs(id){const s=this.require(id);
    if(s.kind==='stdio')return this.stdio.get(id)?.logs()||[];
    if(s.kind==='http')return ['Remote HTTP server: use the upstream service logs'];
    return (s.kind==='docker'?this.docker:this.k8s).logs(s);
  }
  async benchmark(serverId,{tool='echo',arguments:args={text:'benchmark'},concurrency=10,durationSeconds=5}={}){
    this.require(serverId);if(!Number.isInteger(concurrency)||concurrency<1||concurrency>100)throw new Error('concurrency must be 1..100');
    if(!Number.isInteger(durationSeconds)||durationSeconds<1||durationSeconds>30)throw new Error('durationSeconds must be 1..30');
    if(this.benchmarks.size>=3)throw new Error('Maximum 3 benchmarks running');
    if(tool==='echo_bytes' && Number(args?.bytes)>1024*1024 && concurrency>4)throw new Error('Large payload benchmarks require concurrency <=4 to bound memory consumption');
    const id=randomUUID();const result={id,serverId,tool,concurrency,durationSeconds,status:'running',startedAt:new Date().toISOString(),completed:0,errors:0};
    this.benchmarks.set(id,result);
    const until=Date.now()+durationSeconds*1000;const times=[];
    const worker=async()=>{while(Date.now()<until && result.completed+result.errors<50000){const start=performance.now();try{await this.request(serverId,'tools/call',{name:tool,arguments:args});result.completed++;times.push(performance.now()-start);}catch(e){result.errors++;result.lastError=e.message;await new Promise(r=>setTimeout(r,20));}}};
    Promise.allSettled(Array.from({length:concurrency},worker)).then(async()=>{
      times.sort((a,b)=>a-b);const q=p=>times.length?Math.round(times[Math.max(0,Math.ceil(p*times.length)-1)]*100)/100:0;
      Object.assign(result,{status:'complete',finishedAt:new Date().toISOString(),p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),callsPerSecond:Math.round(result.completed/(Math.max(1,Date.now()-new Date(result.startedAt).getTime())/1000)*100)/100});
      this.benchmarks.delete(id);await this.store.change(s=>{s.benchmarks.unshift(result);s.benchmarks=s.benchmarks.slice(0,30);}).catch(console.error);
    });
    await this.store.record('benchmark',serverId,`${concurrency} workers for ${durationSeconds}s`);
    return result;
  }
  findBenchmark(id){return this.benchmarks.get(id)||this.store.state.benchmarks.find(b=>b.id===id);}
  activeProcesses(){return [...this.stdio.values()].reduce((n,p)=>n+p.workers.length,0);}
  async shutdown(){await Promise.all([...this.stdio.values()].map(p=>p.stop()));this.stdio.clear();}
}
