import type { PersonalRuntimeHandoff } from './personalRuntimeCommissioning.js'

export interface PersonalRuntimeProxyRequest { path:string; method:'GET'|'POST'|'PUT'; body?:string; rendererHostToken?:string; expectedBaseUrl:string; expectedInstallationId:string; expectedProjectId:string }
export interface PersonalRuntimeProxyResponse { status:number; contentType:string; bodyBase64:string }
const component = "(?:[A-Za-z0-9._~!*'()-]|%[A-Fa-f0-9]{2})"
const conversationRoot = '/api/v2/(?:manager|projects/[A-Za-z0-9._~-]+)/conversations'
const conversationId = '[A-Za-z0-9._~-]+'
const conversationPage = String.raw`\?limit=100(?:&cursor=${component}+)?`
const standaloneSettingsRoot = '/api/v2/(?:teams/[A-Za-z0-9._~-]+/)?settings/plugins'
const scopedRoot = '/api/v2/(?:me|teams/[A-Za-z0-9._~-]+)'
const scopedObservation = new RegExp(`^${scopedRoot}/renderer-host-sessions/[A-Za-z0-9._~-]+/observations$`)
function scopedContent(path:string):boolean {
 const [pathname,query]=path.split('?')
 if(!new RegExp(`^${scopedRoot}/environment/content$`).test(pathname)||!query||path.split('?').length!==2)return false
 const values=new URLSearchParams(query), keys=['package_id','version','manifest_digest','application_id','environment_revision','environment_digest','content_digest']
 if([...values.keys()].length!==keys.length||keys.some(key=>values.getAll(key).length!==1))return false
 return keys.every(key=>{
  const value=values.get(key)!
  if(key.endsWith('digest'))return /^[a-f0-9]{64}$/.test(value)
  if(key==='environment_revision')return /^[1-9][0-9]*$/.test(value)&&Number.isSafeInteger(Number(value))
  return /^[A-Za-z0-9._~:+-]{1,200}$/.test(value)
 })
}
const allowed:Array<[PersonalRuntimeProxyRequest['method'],RegExp]>=[
 ['GET',/^\/api\/v2\/settings\/dashboard$/],
 ['PUT',/^\/api\/v2\/settings\/dashboard$/],
 ['GET',/^\/api\/v2\/personal-runtime\/catalog\/packages$/],
 ['POST',/^\/api\/v2\/personal-runtime\/catalog\/(?:packages|publishers)$/],
 ['GET',/^\/api\/v2\/personal-runtime\/catalog\/publishers\/[A-Za-z0-9._~-]+\/keys\/[A-Za-z0-9._~-]+$/],
 ['POST',/^\/api\/v2\/personal-runtime\/catalog\/publishers\/[A-Za-z0-9._~-]+\/keys\/[A-Za-z0-9._~-]+\/revoke$/],
 ['GET',new RegExp(`^${standaloneSettingsRoot}$`)],
 ['POST',new RegExp(`^${standaloneSettingsRoot}$`)],
 ['PUT',new RegExp(`^${standaloneSettingsRoot}/[a-f0-9]{64}$`)],
 ['GET',new RegExp(`^${scopedRoot}/(?:environment|application-renderer-candidates)$`)],
 ['POST',new RegExp(`^${scopedRoot}/(?:environment/selection|application-renderer-candidates/[A-Za-z0-9._~-]+/(?:enable|disable)|renderer-host-sessions)$`)],
 ['POST',scopedObservation],
 ['GET',new RegExp(`^/api/v2/devices\\?limit=50&after=${component}*$`)],
 ['GET',/^\/api\/v2\/devices\/[A-Za-z0-9._~-]+\/(?:activity|assignments)$/],
 ['GET',/^\/api\/v2\/device-pairings\/[A-Za-z0-9._~-]+$/],
 ['GET',/^\/api\/v2\/teams$/],
 ['GET',/^\/api\/v2\/team-invitations$/],
 ['GET',/^\/api\/v2\/teams\/[A-Za-z0-9._~-]+(?:\/(?:presentation-projects|settings\/presentation))?$/],
 ['POST',/^\/api\/v2\/teams(?:\/[A-Za-z0-9._~-]+\/(?:invitations|accept))?$/],
 ['POST',new RegExp(`^/api/v2/teams/[A-Za-z0-9._~-]+/members/${component}+/remove$`)],
 ['PUT',/^\/api\/v2\/teams\/[A-Za-z0-9._~-]+\/settings\/presentation$/],
 ['GET',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/presentation-team$/],
 ['POST',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/presentation-team$/],
 ['GET',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/(?:devices|sources)$/],
 ['POST',/^\/api\/v2\/devices(?:\/[A-Za-z0-9._~-]+\/(?:pairing|unpair|assignments\/[A-Za-z0-9._~-]+\/revoke))?$/],
 ['POST',/^\/api\/v2\/device-pairings\/[A-Za-z0-9._~-]+\/confirm$/],
 ['POST',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/devices\/[A-Za-z0-9._~-]+\/decision$/],
 ['PUT',/^\/api\/v2\/devices\/[A-Za-z0-9._~-]+\/assignments\/[A-Za-z0-9._~-]+$/],

 ['GET',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/(?:commands|environment|command-invocations\?limit=50)$/],
 ['GET',/^\/api\/v2\/command-invocations\/[A-Za-z0-9._~-]+$/],
 ['GET',/^\/api\/v2\/runs\/[A-Za-z0-9._~-]+\/connectors$/],
 ['POST',/^\/api\/v2\/commands\/[A-Za-z0-9._~-]+\/invocations$/],
 ['GET',/^\/api\/v2\/settings\/presentation$/],
 ['PUT',/^\/api\/v2\/settings\/presentation$/],
 ['GET',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/(?:application-renderers|settings\/presentation\/(?:effective|project|user_project))$/],
 ['PUT',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/settings\/presentation\/(?:project|user_project)$/],
 ['GET',new RegExp(`^/api/v2/projects/[A-Za-z0-9._~-]+/task-feed\\?after=${component}*&limit=100$`)],
 ['GET',new RegExp(`^${conversationRoot}${conversationPage}$`)],
 ['GET',new RegExp(`^${conversationRoot}/${conversationId}(?:/messages${conversationPage}|/messages/${conversationId}/(?:result|dispatches(?:/${conversationId}/result)?))?$`)],
 ['POST',new RegExp(`^${conversationRoot}(?:/${conversationId}/messages(?:/${conversationId}/dispatch)?)?$`)],
 ['PUT',new RegExp(`^/api/v2/manager/conversations/${conversationId}/scope$`)],

 ['GET',/^\/api\/v2\/projects\?limit=100&after=(?:[A-Za-z0-9._~!*'()-]|%[A-Fa-f0-9]{2})*$/],
 ['POST',/^\/api\/v2\/manager\/context$/],
 ['GET',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/goal$/],
 ['POST',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/goal$/],
 ['PUT',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/goal$/],
 ['GET',/^\/api\/health$/],
 ['GET',/^\/api\/v2\/runs\/[A-Za-z0-9._~-]+\/coding-result\/review$/],
 ['POST',/^\/api\/v2\/runs\/[A-Za-z0-9._~-]+\/coding-result\/review$/],
 ['GET',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/retained-evidence(?:\/captures\/[A-Za-z0-9._~-]+\/(?:inspection|content|availability))?$/],
 ['POST',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/retained-evidence\/(?:setup|captures(?:\/[A-Za-z0-9._~-]+\/(?:review|availability))?)$/],
 ['GET',/^\/api\/v2\/(?:capabilities|personal-runtime)$/],['POST',/^\/api\/v2\/personal-runtime\/(?:lifecycle|recovery|supervisor)$/],
 ['GET',/^\/api\/v2\/projects(?:\/[A-Za-z0-9._~-]+(?:\/(?:members|workers|invitations|capacity|native-adapters)|\/(?:sources|participants|authorized-context-sources)\?limit=100)?)?$/],
 ['POST',/^\/api\/v2\/(?:projects|workers|runs)$/],['PUT',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/(?:capacity-limits|members)$/],
 ['POST',/^\/api\/v2\/projects\/[A-Za-z0-9._~-]+\/invitations(?:\/[A-Za-z0-9._~-]+\/(?:accept|revoke))?$/],
 ['GET',/^\/api\/v2\/(?:command-center|runs\/[A-Za-z0-9._~-]+(?:\/(?:artifacts|checkpoints|authorized-context-packet))?|runs\/[A-Za-z0-9._~-]+\/artifacts\/[A-Za-z0-9._~-]+\/content)$/],
 ['POST',/^\/api\/v2\/runs\/[A-Za-z0-9._~-]+\/(?:cancel|continuations)$/],
]
function string(value:unknown,name:string,max=2048){if(typeof value!=='string'||!value||value.length>max)throw Error(`Personal runtime ${name} is invalid`);return value}
function validateRequest(value:unknown,handoff:PersonalRuntimeHandoff):PersonalRuntimeProxyRequest{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Personal runtime request is invalid');const raw=value as Record<string,unknown>,permitted=['body','rendererHostToken','expectedBaseUrl','expectedInstallationId','expectedProjectId','method','path'],keys=Object.keys(raw);if(keys.some(key=>!permitted.includes(key))||permitted.filter(key=>key!=='body'&&key!=='rendererHostToken').some(key=>!keys.includes(key)))throw Error('Personal runtime request fields are invalid');if(raw.method!=='GET'&&raw.method!=='POST'&&raw.method!=='PUT')throw Error('Personal runtime request method is invalid');const path=string(raw.path,'request path'),expectedBaseUrl=string(raw.expectedBaseUrl,'expected base URL'),expectedInstallationId=string(raw.expectedInstallationId,'expected installation'),expectedProjectId=string(raw.expectedProjectId,'expected project');if(expectedBaseUrl!==handoff.baseUrl||expectedInstallationId!==handoff.installationId||expectedProjectId!==handoff.projectId)throw Error('Personal runtime request authority changed');if(path.includes('#')||!(allowed.some(([method,pattern])=>method===raw.method&&pattern.test(path))||(raw.method==='GET'&&scopedContent(path))))throw Error('Personal runtime request path is unavailable');if(raw.body!==undefined&&(typeof raw.body!=='string'||Buffer.byteLength(raw.body)>262_144))throw Error('Personal runtime request body is invalid');if(raw.method==='GET'&&raw.body!==undefined)throw Error('Personal runtime GET body is invalid');const observation=raw.method==='POST'&&scopedObservation.test(path);if(observation?typeof raw.rendererHostToken!=='string'||!/^[-A-Za-z0-9._~]{1,512}$/.test(raw.rendererHostToken):raw.rendererHostToken!==undefined)throw Error('Personal runtime renderer host token is invalid');return{...(observation?{rendererHostToken:raw.rendererHostToken as string}:{}),method:raw.method,path,expectedBaseUrl,expectedInstallationId,expectedProjectId,...(typeof raw.body==='string'?{body:raw.body}:{})}}
async function boundedBody(response:Response,max=4_194_304){if(!response.body)return Buffer.alloc(0);const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const{done,value}=await reader.read();if(done)break;if(value){size+=value.byteLength;if(size>max){await reader.cancel();throw Error('Personal runtime response exceeded its bound')}chunks.push(value)}}}finally{reader.releaseLock()}return Buffer.concat(chunks.map(value=>Buffer.from(value)),size)}
export async function proxyPersonalRuntimeRequest(handoff:PersonalRuntimeHandoff,value:unknown,fetchImpl:typeof fetch=fetch):Promise<PersonalRuntimeProxyResponse>{const request=validateRequest(value,handoff),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15_000);try{const response=await fetchImpl(new URL(request.path,handoff.baseUrl),{method:request.method,redirect:'manual',signal:controller.signal,headers:{Authorization:`Bearer ${handoff.bearerToken}`,'X-OpenSaddle-User':handoff.ownerSubject,...(request.rendererHostToken?{'X-OpenSaddle-Renderer-Host-Token':request.rendererHostToken}:{}),...(request.body!==undefined?{'Content-Type':'application/json'}:{})},...(request.body!==undefined?{body:request.body}:{})});if(response.status>=300&&response.status<400){await response.body?.cancel();throw Error('Personal runtime redirect was rejected')}const bytes=await boundedBody(response);return{status:response.status,contentType:response.headers.get('content-type')??'application/octet-stream',bodyBase64:bytes.toString('base64')}}finally{clearTimeout(timeout)}}
