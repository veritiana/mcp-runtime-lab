import { resolve } from 'node:path';
export function configFromEnv(env = process.env) {
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return {
    host: env.HOST || '127.0.0.1', port,
    dataDir: resolve(env.DATA_DIR || '.data'),
    adminToken: env.MCP_ADMIN_TOKEN || '', agentToken: env.MCP_AGENT_TOKEN || '',
    dockerSocket: env.DOCKER_SOCKET || '/var/run/docker.sock',
    dockerEnabled: env.DOCKER_ENABLED === 'true',
    dockerNetwork: env.DOCKER_NETWORK || '',
    k8sNamespace: env.K8S_NAMESPACE || 'mcp-system',
    k8sApiUrl: env.K8S_API_URL || 'https://kubernetes.default.svc',
    k8sTokenFile: env.K8S_TOKEN_FILE || '/var/run/secrets/kubernetes.io/serviceaccount/token',
    k8sCaFile: env.K8S_CA_FILE || '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt',
    k8sBearerToken: env.K8S_BEARER_TOKEN || ''
  };
}
export function assertSecureConfig(config) {
  if (config.adminToken.length < 24 || config.agentToken.length < 24) {
    throw new Error('MCP_ADMIN_TOKEN and MCP_AGENT_TOKEN must each have >=24 characters');
  }
  if (config.adminToken === config.agentToken) {
    throw new Error('Admin and agent tokens must be different');
  }
}
