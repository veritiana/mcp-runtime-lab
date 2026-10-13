import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class JsonStore {
  constructor(dir) { this.dir = dir; this.path = join(dir, 'registry.json'); this.state = { servers: [], history: [], benchmarks: [] }; this.writeChain = Promise.resolve(); }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      this.state = { servers: Array.isArray(parsed.servers) ? parsed.servers : [], history: Array.isArray(parsed.history) ? parsed.history : [], benchmarks: Array.isArray(parsed.benchmarks) ? parsed.benchmarks : [] };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  async save() {
    const snapshot = JSON.stringify(this.state, null, 2);
    const flush = async () => {
      const temp = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(temp, this.path);
      await chmod(this.path, 0o600);
    };
    const result = this.writeChain.then(flush);
    this.writeChain = result.catch(() => {});
    return result;
  }
  async change(fn) { const output = fn(this.state); await this.save(); return output; }
  get servers() { return this.state.servers; }
  getServer(id) { return this.state.servers.find(s => s.id === id); }
  async record(action, serverId, detail = '') {
    await this.change(state => {
      state.history.unshift({ id: randomUUID(), time: new Date().toISOString(), action, serverId, detail: String(detail).slice(0, 400) });
      state.history = state.history.slice(0, 500);
    });
  }
}
