/** Public MCP Runtime Lab workload types for TypeScript consumers. */
export type ServerKind = 'stdio' | 'http' | 'docker' | 'kubernetes';
export interface BaseMcpServer {
  id: string;
  name: string;
  kind: ServerKind;
  enabled: boolean;
  createdAt: string;
}
export interface StdioMcpServer extends BaseMcpServer {
  kind: 'stdio'; command: string; args: string[]; cwd?: string;
  env?: Record<string,string>; replicas: number;
}
export interface HttpMcpServer extends BaseMcpServer {
  kind: 'http'; url: string; tokenEnv?: string;
}
export interface ContainerMcpServer extends BaseMcpServer {
  kind: 'docker'|'kubernetes'; image:string;
  containerPort: number; endpointPath:string; replicas:number;
}
export type McpServerDefinition = StdioMcpServer|HttpMcpServer|ContainerMcpServer;
export interface McpCallResult {
  content?: Array<{type:'text';text:string}|Record<string,unknown>>;
  isError?:boolean;
}
