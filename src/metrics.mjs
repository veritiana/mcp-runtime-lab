const labels = value => String(value).replace(/[\\"\n]/g, '');
export class Metrics {
  constructor() { this.map = new Map(); this.samples = []; this.startedAt = Date.now(); }
  record(serverId, method, latencyMs, success) {
    const key = `${serverId}:${method}`;
    const value = this.map.get(key) || { serverId, method, calls: 0, errors: 0, durations: [] };
    value.calls++;
    if (!success) value.errors++;
    value.durations.push(latencyMs);
    if (value.durations.length > 2000) value.durations.shift();
    this.map.set(key, value);
    this.samples.push({ time: Date.now(), serverId, latencyMs, success });
    if (this.samples.length > 10000) this.samples.shift();
  }
  snapshot() {
    const q = (array, p) => { const x = [...array].sort((a,b) => a-b); return x.length ? Math.round(x[Math.min(x.length-1, Math.ceil(x.length*p)-1)] * 100)/100 : 0; };
    const servers = [...this.map.values()].map(x => ({ serverId:x.serverId, method:x.method, calls:x.calls, errors:x.errors, p50:q(x.durations,.5), p95:q(x.durations,.95), p99:q(x.durations,.99) }));
    const since = Date.now() - 60_000;
    const recent = this.samples.filter(x => x.time >= since);
    return { uptimeSeconds: Math.round((Date.now()-this.startedAt)/1000), callsTotal: servers.reduce((a,x)=>a+x.calls,0), errorsTotal: servers.reduce((a,x)=>a+x.errors,0), callsPerMinute: recent.length, rssBytes: process.memoryUsage().rss, servers, timeline: Array.from({length:12},(_,i)=> {const start=Date.now()-(11-i)*5000; return { time:new Date(start).toISOString(), calls:recent.filter(s=>s.time>=start && s.time<start+5000).length };}) };
  }
  prometheus(extra={}) {
    const lines = [
      '# HELP mcp_runtime_calls_total Total tool/protocol calls', '# TYPE mcp_runtime_calls_total counter',
      ...[...this.map.values()].map(x=>`mcp_runtime_calls_total{server="${labels(x.serverId)}",method="${labels(x.method)}"} ${x.calls}`),
      '# HELP mcp_runtime_errors_total Failed calls', '# TYPE mcp_runtime_errors_total counter',
      ...[...this.map.values()].map(x=>`mcp_runtime_errors_total{server="${labels(x.serverId)}",method="${labels(x.method)}"} ${x.errors}`),
      '# TYPE mcp_runtime_rss_bytes gauge',`mcp_runtime_rss_bytes ${process.memoryUsage().rss}`,
      '# TYPE mcp_runtime_uptime_seconds gauge',`mcp_runtime_uptime_seconds ${Math.round((Date.now()-this.startedAt)/1000)}`,
      '# TYPE mcp_runtime_active_processes gauge',`mcp_runtime_active_processes ${extra.processes || 0}`
    ]; return lines.join('\n')+'\n';
  }
}
