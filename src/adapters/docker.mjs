import { request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';

export class DockerAdapter {
  constructor(config) {this.socket=config.dockerSocket; this.enabled=config.dockerEnabled; this.network=config.dockerNetwork; }
  available(){ return this.enabled && existsSync(this.socket); }
  async request(method,path,body,{raw=false}={}) {
    if(!this.available()) throw new Error('Docker adapter unavailable: set DOCKER_ENABLED=true and mount Docker socket (high privilege)');
    return await new Promise((resolve,reject)=>{
      const data=body===undefined?null:JSON.stringify(body);
      const req=httpRequest({socketPath:this.socket,method,path:`/v1.43${path}`,headers:{'content-type':'application/json',...(data?{'content-length':Buffer.byteLength(data)}:{})},timeout:15000},res=>{
        const parts=[];let len=0;
        res.on('data',chunk=>{len+=chunk.length;if(len<=4*1024*1024)parts.push(chunk); else req.destroy(new Error('Docker API response too large'));});
        res.on('end',()=> {const bytes=Buffer.concat(parts);const bodyText=bytes.toString();let parsed;try{parsed=bodyText?JSON.parse(bodyText):{};}catch{parsed=bodyText;}if(res.statusCode>=400)reject(new Error(`Docker ${res.statusCode}: ${parsed.message||bodyText.slice(0,300)}`));else resolve(raw?bytes:parsed);});
      });
      req.on('timeout',()=>req.destroy(new Error('Docker API timeout')));req.on('error',reject);
      if(data)req.write(data);req.end();
    });
  }
  name(id){return `mcp-lab-${id}`;}
  async inspect(id){try{const obj=await this.request('GET',`/containers/${this.name(id)}/json`);if(obj.Config?.Labels?.['mcp-runtime-lab.id']!==id)throw new Error('Refusing to manage existing container without matching ownership label');return obj;}catch(e){if(e.message.includes('Docker 404'))return null;throw e;}}
  async start(config){
    let obj=await this.inspect(config.id);
    if(!obj){
      const port=`${config.containerPort}/tcp`;
      await this.request('POST',`/containers/create?name=${encodeURIComponent(this.name(config.id))}`,{
        Image:config.image,Labels:{'mcp-runtime-lab':'true','mcp-runtime-lab.id':config.id},
        ExposedPorts:{[port]:{}},HostConfig:{AutoRemove:false,Memory:512*1024*1024,NanoCpus:1_000_000_000,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],...(this.network?{}:{PortBindings:{[port]:[{HostIp:'127.0.0.1',HostPort:''}]}})},
        ...(this.network?{NetworkingConfig:{EndpointsConfig:{[this.network]:{}}}}:{}),
        User:'1000:1000'
      });
      obj=await this.inspect(config.id);
    }
    if(obj.Config?.Labels?.['mcp-runtime-lab.id']!==config.id) throw new Error('Refusing to manage existing container without matching ownership label');
    if(!obj.State.Running)await this.request('POST',`/containers/${this.name(config.id)}/start`);
    return this.status(config);
  }
  async stop(config){const obj=await this.inspect(config.id);if(obj?.State?.Running)await this.request('POST',`/containers/${this.name(config.id)}/stop?t=3`);}
  async restart(config){const obj=await this.inspect(config.id);if(!obj)return this.start(config);await this.request('POST',`/containers/${this.name(config.id)}/restart?t=3`);}
  async remove(config){await this.stop(config);if(await this.inspect(config.id))await this.request('DELETE',`/containers/${this.name(config.id)}?force=true`);}
  async status(config){
    const obj=await this.inspect(config.id);if(!obj)return {status:'not-deployed',replicas:0};
    if(obj.Config?.Labels?.['mcp-runtime-lab.id']!==config.id) throw new Error('Existing container lacks matching ownership label');
    const port=`${config.containerPort}/tcp`;
    const binding=obj.NetworkSettings?.Ports?.[port]?.[0];
    const address=this.network?`http://${this.name(config.id)}:${config.containerPort}${config.endpointPath}`:(binding?`http://127.0.0.1:${binding.HostPort}${config.endpointPath}`:null);
    return {status:obj.State.Running?'running':obj.State.Status,replicas:obj.State.Running?1:0,containerId:obj.Id?.slice(0,12),endpoint:address};
  }
  async logs(config){
    const obj=await this.inspect(config.id); if(!obj)return [];
    const result=await this.request('GET',`/containers/${this.name(config.id)}/logs?stdout=1&stderr=1&tail=60`,undefined,{raw:true});
    const bytes=Buffer.isBuffer(result)?result:Buffer.from(String(result));
    // Docker multiplexed log frame: 8-byte header + payload. Plain text fallback.
    const lines=[];let i=0;
    while(i+8<=bytes.length && [1,2].includes(bytes[i]) && bytes[i+1]===0) {
      const n=bytes.readUInt32BE(i+4);if(i+8+n>bytes.length)break;
      lines.push(bytes.subarray(i+8,i+8+n).toString().slice(0,1024));i+=8+n;
    }
    return (lines.length?lines:[bytes.toString()]).slice(-60);
  }
}
