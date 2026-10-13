import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const DEFAULT_TIMEOUT = 12_000;
const MAX_LINE = 16 * 1024 * 1024;
const inheritedKeys = ['PATH', 'HOME', 'LANG', 'TMPDIR', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'];
function sanitizedEnv(extra={}) { const result = {}; for (const key of inheritedKeys) if (process.env[key]) result[key]=process.env[key]; return { ...result, ...extra }; }

export class StdioWorker extends EventEmitter {
  constructor(config) { super(); this.config = config; this.child = null; this.nextId = 0; this.pending = new Map(); this.buffer = ''; this.logs = []; this.initialized = false; this.closing = false; }
  async start() {
    if (this.child) throw new Error('Worker already running');
    this.closing = false;
    const child = spawn(this.config.command, this.config.args, { cwd: this.config.cwd || process.cwd(), env: sanitizedEnv(this.config.env), shell: false, stdio: ['pipe','pipe','pipe'] });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.read(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { this.logs.push(`${new Date().toISOString()} ${chunk}`.slice(0,4096)); this.logs = this.logs.slice(-150); });
    const fail = error => { this.initialized = false; this.rejectPending(error); if (this.child === child) this.child = null; this.emit('exit',error); };
    child.on('error', fail);
    child.on('exit',(code,signal)=>fail(new Error(`MCP worker exited (code ${code}, signal ${signal})`)));
    try {
      const init = await this.rawRequest('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name:'mcp-runtime-lab', version:'0.1.0' } }, DEFAULT_TIMEOUT);
      if (!init?.protocolVersion) throw new Error('Invalid MCP initialize response');
      this.serverInfo = init;
      this.notification('notifications/initialized');
      this.initialized = true;
    } catch(e) { await this.stop(); throw e; }
  }
  read(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE) { this.rejectPending(new Error('stdio response exceeds 16 MiB')); this.child?.kill('SIGKILL'); return; }
    let pos;
    while ((pos = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0,pos).replace(/\r$/, ''); this.buffer = this.buffer.slice(pos+1);
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch { this.logs.push('Invalid JSON-RPC line on stdout'); continue; }
      if (obj.id === undefined || obj.id === null) { this.emit('message',obj); continue; }
      const pending = this.pending.get(String(obj.id));
      if (!pending) { this.emit('message',obj); continue; }
      this.pending.delete(String(obj.id)); clearTimeout(pending.timer);
      if (obj.error) pending.reject(new Error(obj.error.message || 'MCP upstream error'));
      else pending.resolve(obj.result);
    }
  }
  rawRequest(method, params, timeout=DEFAULT_TIMEOUT) {
    if (!this.child || this.child.exitCode !== null || !this.child.stdin.writable) return Promise.reject(new Error('MCP process not running'));
    if (this.pending.size >= 100) return Promise.reject(new Error('Worker concurrency limit reached'));
    const id = ++this.nextId;
    return new Promise((resolve,reject)=> {
      const timer = setTimeout(()=>{ this.pending.delete(String(id)); reject(new Error(`MCP ${method} timed out`)); },timeout);
      timer.unref(); this.pending.set(String(id),{ resolve,reject,timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params })+'\n', error=> {
        if (error) { clearTimeout(timer); this.pending.delete(String(id)); reject(error); }
      });
    });
  }
  notification(method,params={}) {
    if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n');
  }
  request(method,params={},timeout) { if (!this.initialized) return Promise.reject(new Error('Worker is not initialized')); return this.rawRequest(method,params,timeout); }
  rejectPending(error) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
  async stop() {
    this.closing = true;
    const child = this.child; this.child = null; this.initialized = false;
    if (child && child.exitCode === null) {
      const closed = new Promise(resolve => { child.once('exit',resolve); setTimeout(()=>{child.kill('SIGKILL'); resolve();},1800).unref(); });
      child.stdin.end(); child.kill('SIGTERM'); await closed;
    }
    this.rejectPending(new Error('Worker stopped'));
  }
  status() { return { pid:this.child?.pid || null, running:Boolean(this.child && this.initialized), pending:this.pending.size, logs:this.logs.slice(-60), info:this.serverInfo || null }; }
}

export class StdioPool {
  constructor(config) { this.config=config; this.workers=[]; this.counter=0; this.desired=0; this.restartTimers=new Set(); this.restarts=[]; this.enabled=false; }
  async start() {
    if (this.enabled) return;
    this.enabled=true; this.desired=this.config.replicas || 1;
    try { for (let i=0;i<this.desired;i++) await this.addWorker(); }
    catch(e) { await this.stop(); throw e; }
  }
  async addWorker() {
    const worker = new StdioWorker(this.config); this.workers.push(worker);
    worker.on('exit',()=>{
      this.workers = this.workers.filter(w=>w!==worker);
      if (!this.enabled) return;
      const now=Date.now(); this.restarts=this.restarts.filter(x=>now-x<60_000);
      if (this.restarts.length>=5) { this.enabled=false; this.error='Restart limit exceeded (5/min)'; return; }
      this.restarts.push(now);
      const timer=setTimeout(()=>{this.restartTimers.delete(timer); if(this.enabled && this.workers.length<this.desired) this.addWorker().catch(e=>{this.error=e.message;});},1000);
      this.restartTimers.add(timer);
    });
    try { await worker.start(); this.error=null; } catch(e) { this.workers=this.workers.filter(w=>w!==worker); throw e; }
  }
  async scale(n) {
    if (!Number.isInteger(n) || n<1 || n>32) throw new Error('replicas must be 1..32');
    this.desired=n;
    if (!this.enabled) return;
    while(this.workers.length<n) await this.addWorker();
    while(this.workers.length>n) { const worker=this.workers.pop(); await worker.stop(); }
  }
  async stop() {
    this.enabled=false; this.desired=0;
    for (const t of this.restartTimers) clearTimeout(t);
    this.restartTimers.clear();
    const workers=this.workers.splice(0); await Promise.all(workers.map(w=>w.stop()));
  }
  async request(method,params,timeout) {
    const available=this.workers.filter(w=>w.initialized);
    if (!available.length) throw new Error(this.error || 'No healthy workers');
    const worker=available[this.counter++ % available.length];
    return worker.request(method,params,timeout);
  }
  status() { return { status:this.workers.some(w=>w.initialized)?'running':this.enabled?'starting':'stopped', replicas:this.workers.filter(w=>w.initialized).length, desired:this.desired, error:this.error, workers:this.workers.map(w=>w.status()) }; }
  logs() { return this.workers.flatMap(w=>w.logs).slice(-100); }
}
