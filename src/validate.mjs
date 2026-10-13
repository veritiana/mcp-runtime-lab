import { randomUUID } from 'node:crypto';

const kinds = new Set(['stdio', 'http', 'docker', 'kubernetes']);
const idFormat = /^[a-z][a-z0-9-]{1,38}$/;
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonBlank = (v, name, max = 400) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${name} must be a non-empty string (max ${max})`);
  return v.trim();
};
function allowedHttpUrl(input, field) {
  let url; try { url = new URL(nonBlank(input, field, 2048)); } catch { throw new Error(`${field} must be a valid URL`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`${field} must be http(s) URL without credentials`);
  return url.toString();
}
export function validateServer(input, { previous = null } = {}) {
  if (!isObj(input)) throw new Error('Server must be an object');
  const kind = input.kind || previous?.kind;
  if (!kinds.has(kind)) throw new Error(`kind must be one of ${[...kinds].join(', ')}`);
  if (previous && previous.kind !== kind) throw new Error('Cannot change kind; create new server');
  const id = previous?.id || (typeof input.id === 'string' && input.id ? input.id : `mcp-${randomUUID().slice(0, 8)}`);
  if (!idFormat.test(id)) throw new Error('id must be lowercase letters/digits/hyphens, 2-39 chars, starting with a letter');
  const obj = { id, name: nonBlank(input.name ?? previous?.name, 'name', 100), kind, enabled: Boolean(input.enabled ?? previous?.enabled ?? false), createdAt: previous?.createdAt || new Date().toISOString() };
  if (kind === 'stdio') {
    obj.command = nonBlank(input.command ?? previous?.command, 'command', 512);
    const args = input.args ?? previous?.args ?? [];
    if (!Array.isArray(args) || args.length > 40 || args.some(x => typeof x !== 'string' || x.length > 1000)) throw new Error('args must be string array (max 40)');
    obj.args = args;
    const env = input.env ?? previous?.env ?? {};
    if (!isObj(env) || Object.keys(env).length > 30 || Object.entries(env).some(([k,v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string' || v.length > 5000)) throw new Error('env must be a simple string map');
    obj.env = env;
    const cwd = input.cwd ?? previous?.cwd;
    if (cwd !== undefined && cwd !== '') obj.cwd = nonBlank(cwd, 'cwd', 512);
    const replicas = Number(input.replicas ?? previous?.replicas ?? 1);
    if (!Number.isInteger(replicas) || replicas < 1 || replicas > 32) throw new Error('stdio replicas must be 1..32');
    obj.replicas = replicas;
  } else if (kind === 'http') {
    obj.url = allowedHttpUrl(input.url ?? previous?.url, 'url');
    const tokenEnv = input.tokenEnv ?? previous?.tokenEnv;
    if (tokenEnv) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)) throw new Error('tokenEnv must name an environment variable');
      obj.tokenEnv = tokenEnv;
    }
  } else {
    obj.image = nonBlank(input.image ?? previous?.image, 'image', 300);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/@:-]*$/.test(obj.image)) throw new Error('Invalid image reference');
    obj.containerPort = Number(input.containerPort ?? previous?.containerPort ?? 8080);
    if (!Number.isInteger(obj.containerPort) || obj.containerPort < 1 || obj.containerPort > 65535) throw new Error('Invalid containerPort');
    obj.endpointPath = input.endpointPath ?? previous?.endpointPath ?? '/mcp';
    if (typeof obj.endpointPath !== 'string' || !/^\/[\w/-]*$/.test(obj.endpointPath)) throw new Error('Invalid endpointPath');
    const replicas = Number(input.replicas ?? previous?.replicas ?? 1);
    if (!Number.isInteger(replicas) || replicas < 1 || replicas > 32) throw new Error('replicas must be 1..32');
    obj.replicas = replicas;
  }
  return obj;
}
export function publicServer(obj) {
  if (!obj) return null;
  const { env, ...publicValue } = obj;
  return { ...publicValue, envKeys: env ? Object.keys(env) : [] };
}
export function jsonSizeLimit(body, max = 1024 * 1024) {
  if (Buffer.byteLength(JSON.stringify(body)) > max) throw new Error('JSON payload too large');
}
