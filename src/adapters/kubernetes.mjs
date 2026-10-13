import { readFile } from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';

export class KubernetesAdapter {
  constructor(config){this.config=config;}
  async credentials() {
    let token=this.config.k8sBearerToken;
    if(!token){try{token=(await readFile(this.config.k8sTokenFile,'utf8')).trim();}catch{throw new Error('Kubernetes service account token unavailable. Run in cluster or configure K8S_BEARER_TOKEN.');}}
    let ca;try{ca=await readFile(this.config.k8sCaFile);}catch{}
    return {token,ca};
  }
  async request(method,path,body) {
    const {token,ca}=await this.credentials();const url=new URL(path,this.config.k8sApiUrl);const isTls=url.protocol==='https:';
    const data=body===undefined?null:JSON.stringify(body);
    return await new Promise((resolve,reject)=> {
      const request=(isTls?https:http).request({hostname:url.hostname,port:url.port||undefined,path:url.pathname+url.search,method,ca,headers:{authorization:`Bearer ${token}`,'content-type':method==='PATCH'?'application/merge-patch+json':'application/json',...(data?{'content-length':Buffer.byteLength(data)}:{})},timeout:15000},res=>{
        let text='';res.on('data',chunk=>{text+=chunk.toString();if(text.length>3e6)req.destroy(new Error('K8s response too large'));});
        res.on('end',()=>{let parsed;try{parsed=JSON.parse(text);}catch{parsed={raw:text};}if(res.statusCode>=400)reject(Object.assign(new Error(`K8s ${res.statusCode}: ${parsed.message||text.slice(0,400)}`),{statusCode:res.statusCode}));else resolve(parsed);});
      });
      const req=request;req.on('timeout',()=>req.destroy(new Error('K8s API timeout')));req.on('error',reject);if(data)req.write(data);req.end();
    });
  }
  ns(){return this.config.k8sNamespace;}
  prefix(){return `/apis/apps/v1/namespaces/${encodeURIComponent(this.ns())}`;}
  core(){return `/api/v1/namespaces/${encodeURIComponent(this.ns())}`;}
  deployment(config){return {
    apiVersion:'apps/v1',kind:'Deployment',metadata:{name:config.id,namespace:this.ns(),labels:{'app.kubernetes.io/managed-by':'mcp-runtime-lab','app.kubernetes.io/name':config.id}},
    spec:{replicas:config.replicas,selector:{matchLabels:{'app.kubernetes.io/name':config.id}},template:{metadata:{labels:{'app.kubernetes.io/name':config.id}},spec:{automountServiceAccountToken:false,securityContext:{runAsNonRoot:true,runAsUser:1000,seccompProfile:{type:'RuntimeDefault'}},containers:[{name:'mcp',image:config.image,ports:[{containerPort:config.containerPort,name:'http'}],resources:{requests:{cpu:'100m',memory:'128Mi'},limits:{cpu:'1',memory:'512Mi'}},securityContext:{allowPrivilegeEscalation:false,readOnlyRootFilesystem:true,capabilities:{drop:['ALL']}},readinessProbe:{httpGet:{path:'/healthz',port:config.containerPort},initialDelaySeconds:2,periodSeconds:5},livenessProbe:{httpGet:{path:'/healthz',port:config.containerPort},initialDelaySeconds:10,periodSeconds:10}}]} } }
  };}
  service(config){return {apiVersion:'v1',kind:'Service',metadata:{name:config.id,namespace:this.ns(),labels:{'app.kubernetes.io/managed-by':'mcp-runtime-lab'}},spec:{type:'ClusterIP',selector:{'app.kubernetes.io/name':config.id},ports:[{port:config.containerPort,targetPort:config.containerPort,protocol:'TCP'}]}};}
  async apply(path,createPath,obj){try {const existing=await this.request('GET',path);if(existing.metadata?.labels?.['app.kubernetes.io/managed-by']!=='mcp-runtime-lab')throw new Error('Refusing to overwrite non-managed Kubernetes resource');await this.request('PATCH',path,obj);}catch(e){if(e.statusCode===404)await this.request('POST',createPath,obj);else throw e;}}
  async start(config){
    await this.apply(`${this.prefix()}/deployments/${config.id}`,`${this.prefix()}/deployments`,this.deployment(config));
    await this.apply(`${this.core()}/services/${config.id}`,`${this.core()}/services`,this.service(config));
    return this.status(config);
  }
  async ensureOwned(config){const d=await this.request('GET',`${this.prefix()}/deployments/${config.id}`);if(d.metadata?.labels?.['app.kubernetes.io/managed-by']!=='mcp-runtime-lab')throw new Error('Refusing to modify non-managed Kubernetes workload');}
  async stop(config){await this.scale(config,0);}
  async restart(config){await this.ensureOwned(config);await this.request('PATCH',`${this.prefix()}/deployments/${config.id}`,{spec:{template:{metadata:{annotations:{'mcp-runtime-lab/restarted-at':new Date().toISOString()}}}}});}
  async scale(config,count){if(!Number.isInteger(count)||count<0||count>32)throw new Error('replicas 0..32');await this.ensureOwned(config);await this.request('PATCH',`${this.prefix()}/deployments/${config.id}/scale`,{spec:{replicas:count}});}
  async remove(config){try{await this.ensureOwned(config);}catch(e){if(e.statusCode===404)return;throw e;}
    try{const svc=await this.request('GET',`${this.core()}/services/${config.id}`);if(svc.metadata?.labels?.['app.kubernetes.io/managed-by']!=='mcp-runtime-lab')throw new Error('Refusing to delete non-managed Kubernetes service');}catch(e){if(e.statusCode!==404)throw e;}
    for(const url of [`${this.prefix()}/deployments/${config.id}`,`${this.core()}/services/${config.id}`]){try{await this.request('DELETE',url);}catch(e){if(e.statusCode!==404)throw e;}}}
  async status(config){
    try {const d=await this.request('GET',`${this.prefix()}/deployments/${config.id}`);return {status:(d.status?.readyReplicas||0)>0?'running':'pending',replicas:d.status?.readyReplicas||0,desired:d.spec?.replicas||0,endpoint:`http://${config.id}.${this.ns()}.svc.cluster.local:${config.containerPort}${config.endpointPath}`};}
    catch(e){if(e.statusCode===404)return {status:'not-deployed',replicas:0};throw e;}
  }
  async logs(config){
    const result=await this.request('GET',`${this.core()}/pods?labelSelector=${encodeURIComponent(`app.kubernetes.io/name=${config.id}`)}`);
    const pod=result.items?.[0]?.metadata?.name;if(!pod)return [];
    const response=await this.request('GET',`${this.core()}/pods/${pod}/log?tailLines=60`);
    return String(response.raw||JSON.stringify(response)).split('\n').slice(-60);
  }
}
