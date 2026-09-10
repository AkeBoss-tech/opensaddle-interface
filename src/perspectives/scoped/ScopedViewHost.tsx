import {readScopedViewState,writeScopedViewState} from './state'
import React,{useEffect,useRef,useState} from 'react'
import {APPLICATION_PROTOCOL,acceptsApplicationMessage,readExactRenderer,sandboxDocument,type ExecutableRendererManifest} from '../../applications/executableApplication'
import type {ScopedRendererClient,ScopedEnvironment,ViewScope} from '../../services/scopedRenderers'
import type {ApplicationRendererCandidate} from '../../services/contracts'
void React

type Candidate=ApplicationRendererCandidate & Pick<ExecutableRendererManifest,'entry_file'|'media_type'|'input_schema'|'output_schema'> & {descriptor:{ui_contract:{schema_version:string;scope:string;mount_kind:string;host_api_min:number;host_api_max:number;required_capabilities:string[]}}}
let generation=0
/** Credential-free scoped fragment host. The parent retains recovery controls. */
export function ScopedViewHost({client,scope,environment,candidate,onUnavailable,fullPage=false}:{onUnavailable?:()=>void;fullPage?:boolean;client:ScopedRendererClient;scope:ViewScope;environment:ScopedEnvironment;candidate:ApplicationRendererCandidate}) {
 const account=client.identity(),stateScope=client.stateScope(), key=[stateScope,account,scope.kind,scope.id,environment.revision,environment.definition_digest,candidate.manifest_digest,candidate.application_id].join('\0')
 const frame=useRef<HTMLIFrameElement>(null),[state,setState]=useState<{key:string;document?:string;status:string}>({key,status:'Loading view…'})
 useEffect(()=>{
  let disposed=false,ready=false,statePending=false,sequence=0,reportTail=Promise.resolve(),poll:ReturnType<typeof setTimeout>|undefined,timeout:ReturnType<typeof setTimeout>|undefined
  let probeTimer:ReturnType<typeof setTimeout>|undefined,probeDeadline:ReturnType<typeof setTimeout>|undefined,pendingProbe:string|undefined
  const epoch=++generation,nonce=crypto.randomUUID(),abort=new AbortController(),item=candidate as Candidate
  const capabilities=item.descriptor?.ui_contract?.required_capabilities??[],knownDevices=new Set<string>();let resourcePending=false
  const packageRef={package_id:item.package_id,version:item.package_version,manifest_digest:item.manifest_digest}
  const instance=item.environment_application?.instances[0]?.instance_id
  let session:Awaited<ReturnType<ScopedRendererClient['createHost']>>|undefined
  const current=()=>!disposed&&client.identity()===account
  const fail=()=>{if(disposed)return;onUnavailable?.();setState({key,status:'This view is unavailable. Your workspace controls remain available.'});clearTimeout(poll);clearTimeout(timeout);clearTimeout(probeTimer);clearTimeout(probeDeadline);abort.abort()}
  const report=(status:'loading'|'ready'|'error')=>{
   reportTail=reportTail.then(async()=>{if((!current()&&status!=='error')||client.identity()!==account||!session)return;await client.report(scope,session,{sequence:++sequence,state:status,...(status==='error'?{error_code:'renderer_unavailable'}:{})})}).catch(fail)
   return reportTail
  }
  const envelope={protocol:APPLICATION_PROTOCOL,nonce,generation:epoch,instance_id:instance,connection_key:key,package_ref:packageRef}
  const probe=()=>{
   if(!current()||abort.signal.aborted)return
   pendingProbe=crypto.randomUUID()
   probeDeadline=setTimeout(()=>{void report('error');fail()},3000)
   frame.current?.contentWindow?.postMessage({...envelope,kind:'ping',request_id:pendingProbe},'*')
  }
  const listener=(event:MessageEvent)=>{
   if(abort.signal.aborted||!current()||!instance||!acceptsApplicationMessage(event,{source:frame.current?.contentWindow??null,nonce,generation:epoch,instanceId:instance,connectionKey:key,packageRef}))return
   if(event.data.kind==='pong'){if(pendingProbe&&event.data.request_id===pendingProbe){pendingProbe=undefined;clearTimeout(probeDeadline);probeTimer=setTimeout(probe,5000)}return}
   if(event.data.kind==='request'&&ready&&!resourcePending&&scope.kind==='user'){
    const message=event.data as typeof event.data & {after?:unknown;device_id?:unknown}
    if(typeof message.request_id!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(message.request_id))return
    const inventory=message.action==='read_devices'&&capabilities.includes('owner.devices.read')&&(message.after===undefined||typeof message.after==='string'&&message.after.length<=512)
    const activity=message.action==='read_device_activity'&&capabilities.includes('owner.device-activity.read')&&typeof message.device_id==='string'&&knownDevices.has(message.device_id)
    if(!inventory&&!activity)return
    resourcePending=true
    void (async()=>{
     await report('ready');if(!current()||abort.signal.aborted)return
     const value=inventory?await client.ownerDevices(scope,typeof message.after==='string'?message.after:''):await client.ownerDeviceActivity(scope,message.device_id as string)
     await report('ready');if(!current()||abort.signal.aborted)return
     if('items' in value){for(const device of value.items)knownDevices.add(device.device_id);while(knownDevices.size>200)knownDevices.delete(knownDevices.values().next().value!)}
     frame.current?.contentWindow?.postMessage({...envelope,kind:'resources',request_id:message.request_id,resource:inventory?'owner_devices':'owner_device_activity',value},'*')
    })().catch(()=>{if(current()&&!abort.signal.aborted)frame.current?.contentWindow?.postMessage({...envelope,kind:'resource_error',request_id:message.request_id,error:'unavailable'},'*')}).finally(()=>{resourcePending=false})
   }
   if(event.data.kind==='state'&&ready&&!statePending){
    statePending=true
    const proposed=event.data.state
    void report('ready').then(()=>{if(current()&&!abort.signal.aborted&&client.stateScope()===stateScope&&instance)writeScopedViewState(stateScope,scope,item,instance,proposed)}).finally(()=>{statePending=false})
   }
   if(event.data.kind==='failure'){void report('error');fail()}
   if(event.data.kind==='ready'&&!ready){ready=true;clearTimeout(timeout);probeTimer=setTimeout(probe,5000);void report('ready').then(()=>{if(current()&&!abort.signal.aborted)setState(value=>({...value,status:'View ready. Content is not independently verified.'}))})}
  }
  // Parent init is dispatched only to this opaque-origin sandbox. No services,
  // tokens, Project identifiers or automatic cross-scope data are exposed.
  const initialize=()=>frame.current?.contentWindow?.postMessage({...envelope,kind:'init',state:instance?readScopedViewState(stateScope,scope,item,instance):undefined,model:{schema_version:'opensaddle.scoped-view.v1',scope:{...scope},capabilities}},'*')
  addEventListener('message',listener)
  const check=async()=>{
   const latest=await client.environment(scope,abort.signal)
   if(!current()||latest.revision!==environment.revision||latest.definition_digest!==environment.definition_digest)throw Error('selection_changed')
   // A host report revalidates selection, enablement, publisher and session expiry.
   await report(ready?'ready':'loading')
   if(!abort.signal.aborted&&current())poll=setTimeout(()=>{void check().catch(fail)},5000)
  }
  setState({key,status:'Loading view…'})
  void (async()=>{
   const contract=item.descriptor?.ui_contract
   if(!instance||contract?.schema_version!=='opensaddle.ui-contract.v1'||contract.scope!==scope.kind||contract.mount_kind!=='perspective'||contract.host_api_min>1||contract.host_api_max<1||!Array.isArray(contract.required_capabilities)||contract.required_capabilities.some(capability=>scope.kind!=='user'||!['owner.devices.read','owner.device-activity.read'].includes(capability)))throw Error('unsupported_scoped_contract')
   if(capabilities.includes('owner.device-activity.read')&&!capabilities.includes('owner.devices.read'))throw Error('owner_inventory_required')
   const ref={...packageRef,application_id:item.application_id,environment_revision:environment.revision,environment_digest:environment.definition_digest,content_digest:item.content_digest}
   const manifest={...item,instance_id:instance,size:item.size_bytes,package_ref:packageRef,authority:'core' as const,sandbox_policy:{scripts:true as const,network:false as const,same_origin:false as const,navigation:false as const}}
   const fragment=await readExactRenderer(await client.content(scope,ref,abort.signal),manifest)
   if(!current())return
   session=await client.createHost(scope,{...ref,host_id:'scoped:'+nonce,instance_id:instance,generation:epoch})
   if(!current())return
   await report('loading')
   if(abort.signal.aborted||!current())return
   setState({key,status:'Starting view…',document:sandboxDocument(fragment,true)})
   timeout=setTimeout(()=>{void report('error');fail()},5000)
   await check()
  })().catch(fail)
  // React onLoad reads a current callback, preventing a previous frame's load
  // event from initializing a new account or selection.
  initializeRef.current=initialize
  return()=>{disposed=true;abort.abort();clearTimeout(poll);clearTimeout(timeout);clearTimeout(probeTimer);clearTimeout(probeDeadline);removeEventListener('message',listener);initializeRef.current=()=>{}}
 },[client,key,account,stateScope,scope.kind,scope.id,environment,candidate,onUnavailable])
 const initializeRef=useRef<()=>void>(()=>{})
 const visible=state.key===key?state:{key,status:'Loading view…'}
 return <section aria-label="Selected scoped view"><p role="status">{visible.status}</p>{visible.document&&<iframe ref={frame} title={candidate.title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={visible.document} onLoad={()=>initializeRef.current()} style={{width:'100%',height:fullPage?'calc(100dvh - 200px)':480,minHeight:320,border:0}}/>}</section>
}
