const DEFAULT_PROTOCOL = '2025-11-25';
export class HttpMcpClient {
  constructor(config) { this.url=config.url; this.tokenEnv=config.tokenEnv; this.sessionId=null; this.nextId=0; this.initializing=null; this.initialized=false; this.info=null; }
  async post(method, params, { notification=false, retry=true }={}) {
    const token = this.tokenEnv && process.env[this.tokenEnv];
    if (this.tokenEnv && !token) throw new Error(`Upstream token environment variable ${this.tokenEnv} is not configured`);
    const obj={jsonrpc:'2.0',...(notification?{}:{id:++this.nextId}),method,params};
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(this.url, {method:'POST',signal:controller.signal,headers:{'content-type':'application/json','accept':'application/json, text/event-stream','mcp-protocol-version':DEFAULT_PROTOCOL,...(this.sessionId?{'mcp-session-id':this.sessionId}:{}),...(token?{'authorization':`Bearer ${token}`}:{})},body:JSON.stringify(obj)});
      if (response.status===404 && this.sessionId && retry) { this.sessionId=null; this.initialized=false; await this.initialize(); return this.post(method,params,{notification,retry:false}); }
      if (response.status===202 && notification) return {};
      const raw=await response.text();
      if (!response.ok) throw new Error(`Upstream HTTP ${response.status}: ${raw.slice(0,300)}`);
      if (response.headers.get('mcp-session-id')) this.sessionId=response.headers.get('mcp-session-id');
      if (notification) return {};
      let json;
      if ((response.headers.get('content-type')||'').includes('text/event-stream')) {
        const dataLines=raw.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim());
        for (const line of dataLines) { try { const event=JSON.parse(line); if (event.id===obj.id) {json=event;break;} } catch {} }
      } else { json=JSON.parse(raw); }
      if (!json) throw new Error('Upstream response missing matching JSON-RPC ID');
      if (json.error) throw new Error(json.error.message || 'Upstream MCP error');
      return json.result;
    } finally { clearTimeout(timer); }
  }
  async initialize() {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing=(async()=> {
      this.info=await this.post('initialize', {protocolVersion:DEFAULT_PROTOCOL,capabilities:{},clientInfo:{name:'mcp-runtime-lab',version:'0.1.0'}});
      if (!this.info?.protocolVersion) throw new Error('Invalid upstream initialize response');
      await this.post('notifications/initialized',{}, {notification:true});
      this.initialized=true;
    })();
    try { await this.initializing; } finally { this.initializing=null; }
  }
  async request(method,params) { await this.initialize(); return this.post(method,params); }
  status() { return {status:this.initialized?'connected':'configured',url:this.url,serverInfo:this.info}; }
}
