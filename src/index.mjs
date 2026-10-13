import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFromEnv, assertSecureConfig } from './config.mjs';
import { JsonStore } from './storage.mjs';
import { RuntimeManager } from './runtime/manager.mjs';
import { createApi } from './server.mjs';
const config=configFromEnv();assertSecureConfig(config);
const store=new JsonStore(config.dataDir);await store.init();
const manager=new RuntimeManager(store,config);
await manager.restore();
if (store.servers.length===0 && process.env.DEMO_SEED !== 'false') {
  await manager.create({id:'echo-local',name:'Echo MCP',kind:'stdio',command:process.execPath,args:[resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples/echo-stdio.mjs')],replicas:2,enabled:true});
}
const server=createApi(manager,config);
server.listen(config.port,config.host,()=>console.log(`MCP Runtime Lab listening http://${config.host}:${config.port}`));
async function shutdown(){console.log('Shutting down MCP Runtime Lab');server.close();await manager.shutdown();process.exit(0);}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
