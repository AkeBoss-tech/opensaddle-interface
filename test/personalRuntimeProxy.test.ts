import assert from'node:assert/strict'
import test from'node:test'
import{proxyPersonalRuntimeRequest}from'../electron/personalRuntimeProxy'

const handoff={baseUrl:'http://127.0.0.1:8766/',installationId:'install',ownerSubject:'owner',projectId:'project',bearerToken:'private-token',adoptionSocket:'/private/p.sock',ipcDir:'/private'}
test('main proxy binds a permitted path to the adopted runtime and owns authorization',async()=>{let seen:Request|undefined;const response=await proxyPersonalRuntimeRequest(handoff,{method:'GET',expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',path:'/api/v2/personal-runtime'},async(input,init)=>{seen=new Request(input,init);return Response.json({lifecycle:'running'})});assert.equal(seen?.url,'http://127.0.0.1:8766/api/v2/personal-runtime');assert.equal(seen?.headers.get('Authorization'),'Bearer private-token');assert.equal(seen?.headers.get('X-OpenSaddle-User'),'owner');assert.equal(Buffer.from(response.bodyBase64,'base64').toString(),'{"lifecycle":"running"}');assert.equal(JSON.stringify(response).includes('private-token'),false)})
test('main proxy rejects authority expansion, caller URLs, and redirects',async()=>{const never=async()=>{throw Error('fetch must not run')};await assert.rejects(proxyPersonalRuntimeRequest(handoff,{method:'DELETE',expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',path:'/api/v2/personal-runtime'},never),/method/);await assert.rejects(proxyPersonalRuntimeRequest(handoff,{method:'GET',expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',path:'http://example.com/api/v2/personal-runtime'},never),/path/);await assert.rejects(proxyPersonalRuntimeRequest(handoff,{method:'POST',expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',path:'/api/v2/projects/project/members',body:'{}'},never),/path/);await assert.rejects(proxyPersonalRuntimeRequest(handoff,{method:'GET',expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',path:'/api/v2/personal-runtime',authorization:'Bearer caller'},never),/fields/);await assert.rejects(proxyPersonalRuntimeRequest(handoff,{method:'GET',expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',path:'/api/v2/personal-runtime'},async()=>new Response('',{status:302,headers:{Location:'https://example.com'}})),/redirect/)})
test('main proxy permits only the exact bounded context discovery query',async()=>{await proxyPersonalRuntimeRequest(handoff,{method:'GET',expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',path:'/api/v2/projects/project/authorized-context-sources?limit=100'},async()=>Response.json({items:[]}));await assert.rejects(proxyPersonalRuntimeRequest(handoff,{method:'GET',expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',path:'/api/v2/projects/project/authorized-context-sources?limit=1000'},async()=>Response.json({items:[]})),/path/)})
test('main proxy rejects a stale expected identity and cancels oversized streaming bodies',async()=>{await assert.rejects(proxyPersonalRuntimeRequest(handoff,{method:'GET',expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'other',expectedProjectId:'project',path:'/api/v2/personal-runtime'},async()=>Response.json({})),/authority changed/);let cancelled=false;const body=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(1_048_576));},cancel(){cancelled=true}});await assert.rejects(proxyPersonalRuntimeRequest(handoff,{method:'GET',expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',path:'/api/v2/personal-runtime'},async()=>new Response(body)),/exceeded its bound/);assert.equal(cancelled,true)})

test('desktop proxy permits explicit retained document lifecycle without wildcard paths',async()=>{
 const base={expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project'}
 for(const path of ['/api/v2/projects/project/retained-evidence','/api/v2/projects/project/retained-evidence/captures/capture-one/inspection','/api/v2/projects/project/retained-evidence/captures/capture-one/availability'])await proxyPersonalRuntimeRequest(handoff,{...base,method:'GET',path},async()=>Response.json({}))
 for(const path of ['/api/v2/projects/project/retained-evidence/setup','/api/v2/projects/project/retained-evidence/captures','/api/v2/projects/project/retained-evidence/captures/capture-one/review','/api/v2/projects/project/retained-evidence/captures/capture-one/availability'])await proxyPersonalRuntimeRequest(handoff,{...base,method:'POST',path,body:'{}'},async()=>Response.json({}))
 await assert.rejects(proxyPersonalRuntimeRequest(handoff,{...base,method:'POST',path:'/api/v2/projects/project/retained-evidence/captures/capture-one/delete',body:'{}'},async()=>Response.json({})),/path/)
})

test('desktop commissioning negotiation can read legacy health absence then authenticated v2 capabilities',async()=>{
 const base={expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',method:'GET' as const}
 const paths:string[]=[]
 const server=async(input:URL|string|Request)=>{const path=new URL(String(input)).pathname;paths.push(path);return Response.json(path==='/api/health'?{detail:'not found'}:{personal_runtime:{available:true}},{status:path==='/api/health'?404:200})}
 const health=await proxyPersonalRuntimeRequest(handoff,{...base,path:'/api/health'},server)
 assert.equal(health.status,404)
 const capabilities=await proxyPersonalRuntimeRequest(handoff,{...base,path:'/api/v2/capabilities'},server)
 assert.equal(capabilities.status,200);assert.deepEqual(paths,['/api/health','/api/v2/capabilities'])
 await assert.rejects(proxyPersonalRuntimeRequest(handoff,{...base,path:'/api/health/reset'},server),/path/)
})

test('advertised project objective read create and exact revision update pass only their canonical route',async()=>{
 const base={expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project',path:'/api/v2/projects/project/goal'}
 for(const method of ['GET','POST','PUT'] as const)await proxyPersonalRuntimeRequest(handoff,{...base,method,...(method==='GET'?{}:{body:'{}'})},async()=>Response.json({}))
 await assert.rejects(proxyPersonalRuntimeRequest(handoff,{...base,method:'POST',path:base.path+'/start',body:'{}'},async()=>Response.json({})),/path/)
})

test('workspace discovery permits bounded Project pages and explicit manager context through the desktop proxy',async()=>{
 const base={expectedBaseUrl:handoff.baseUrl,expectedInstallationId:'install',expectedProjectId:'project'}
 const seen:string[]=[]
 const server=async(input:URL|string|Request,init?:RequestInit)=>{const request=new Request(input,init);seen.push(request.url);assert.equal(request.headers.get('Authorization'),'Bearer private-token');return Response.json({})}
 await assert.doesNotReject(proxyPersonalRuntimeRequest(handoff,{...base,method:'GET',path:'/api/v2/projects?limit=100&after='},server),'desktop must admit the production Project directory URL')
 await proxyPersonalRuntimeRequest(handoff,{...base,method:'GET',path:'/api/v2/projects?limit=100&after=project%2Fone'},server)
 await proxyPersonalRuntimeRequest(handoff,{...base,method:'POST',path:'/api/v2/manager/context',body:JSON.stringify({project_ids:['project']})},server)
 assert.equal(seen.length,3)
 for(const path of ['/api/v2/projects?limit=1000&after=','/api/v2/projects?limit=100&after=&admin=true','/api/v2/projects?limit=100&after=%ZZ','/api/v2/manager/context/execute'])await assert.rejects(proxyPersonalRuntimeRequest(handoff,{...base,method:'GET',path},server),/path/)
 assert.equal(seen.length,3)
})
