type RuntimeIdentity={baseUrl:string;installationId:string;projectId:string;ownerSubject?:string}
let installed:RuntimeIdentity|undefined,originalFetch:typeof fetch|undefined

export function personalRuntimeSubject(baseUrl:string):string|undefined {
 return installed?.baseUrl.replace(/\/$/,'')===baseUrl.replace(/\/$/,'') && typeof installed.ownerSubject==='string' && installed.ownerSubject.length>0 ? installed.ownerSubject : undefined
}

export function installPersonalRuntimeTransport(identity:RuntimeIdentity){
 if(!window.opensaddle?.personalRuntimeRequest)return
 const base=new URL(identity.baseUrl)
 if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port||base.pathname!=='/'||base.search||base.hash)throw Error('Personal runtime transport endpoint is invalid')
 installed={...identity}
 if(originalFetch)return
 originalFetch=globalThis.fetch.bind(globalThis)
 globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url),authority=installed
  if(!authority||url.origin!==new URL(authority.baseUrl).origin)return originalFetch!(input,init)
  if(request.headers.has('Authorization'))throw Error('Personal runtime credentials are owned by the desktop transport')
  const abortReason=()=>request.signal.reason??new DOMException('Aborted','AbortError')
  if(request.signal.aborted)throw abortReason()
  let onAbort!:()=>void
  const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(abortReason())})
  request.signal.addEventListener('abort',onAbort,{once:true})
  try{
   const method=request.method as 'GET'|'POST'|'PUT'
   const body=method==='GET'?undefined:await Promise.race([request.text(),aborted])
   // Body consumption is asynchronous: authorize dispatch again before any write.
   if(request.signal.aborted)throw abortReason()
   if(installed!==authority)throw Error('Personal runtime authority changed while the request was pending')
   const pending=window.opensaddle!.personalRuntimeRequest!({
    path:`${url.pathname}${url.search}`,method,
    ...(request.headers.has('X-OpenSaddle-Renderer-Host-Token')?{rendererHostToken:request.headers.get('X-OpenSaddle-Renderer-Host-Token')!}:{}),
    expectedBaseUrl:authority.baseUrl,expectedInstallationId:authority.installationId,expectedProjectId:authority.projectId,
    ...(body?{body}:{}),
   })
   const result=await Promise.race([pending,aborted])
   if(request.signal.aborted)throw abortReason()
   if(installed!==authority)throw Error('Personal runtime authority changed while the request was pending')
   const bytes=Uint8Array.from(atob(result.bodyBase64),character=>character.charCodeAt(0))
   return new Response([204,205,304].includes(result.status)?null:bytes,{status:result.status,headers:{'Content-Type':result.contentType}})
  }finally{
   request.signal.removeEventListener('abort',onAbort)
  }
 }
}
