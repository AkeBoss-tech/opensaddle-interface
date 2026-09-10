import React,{useEffect,useRef,useState} from 'react'
import type {ApplicationRendererDescriptor,MalleableShellClient} from '../../services/contracts'
import {APPLICATION_PROTOCOL,acceptsApplicationMessage,readExactRenderer,sandboxDocument} from '../../applications/executableApplication'
import {PROJECT_VIEW_CONTRACT} from './installed'
import type {ProjectTaskModel} from './model'
import {projectViewState,readProjectViewState,writeProjectViewState} from './state'
void React
// Installed views receive data and navigation requests, never services or credentials.
export function InstalledProjectView({client,renderer,model,connectionKey,stateScope,onOpenTask,onNewTask}:{client:MalleableShellClient;renderer:ApplicationRendererDescriptor;model:ProjectTaskModel;connectionKey:string;stateScope?:string;onOpenTask:(id:string)=>void;onNewTask:()=>void}){
 const kinds=(renderer.input_schema.properties as {kind?:{enum?:unknown}}|undefined)?.kind?.enum
 const live=Array.isArray(kinds)&&kinds.includes('projection')
 const currentModel=useRef(model);currentModel.current=model
 const sentModel=useRef<ProjectTaskModel|undefined>(undefined),projectionRevision=useRef(0)
 const lifecycleModel=live?model.projectId:model
 const actions=useRef({onOpenTask,onNewTask});actions.current={onOpenTask,onNewTask}
 const authorize=useRef<()=>Promise<boolean>>(async()=>false),requestPending=useRef(false)
 const frame=useRef<HTMLIFrameElement>(null),generation=useRef(0)
 const saved=useRef<ReturnType<typeof projectViewState>>(undefined)
 const [stateNotice,setStateNotice]=useState('')
 const [document,setDocument]=useState<{html:string;nonce:string;generation:number}>(),[error,setError]=useState(''),[ready,setReady]=useState(false)
 useEffect(()=>{const epoch=++generation.current,abort=new AbortController();setDocument(undefined);setError('');setReady(false);setStateNotice('');saved.current=undefined;sentModel.current=undefined;projectionRevision.current=0
  let stopped=false,poll:ReturnType<typeof setTimeout>|undefined,pending:Promise<boolean>|undefined
  const revoke=()=>{if(!stopped&&epoch===generation.current){stopped=true;generation.current++;setDocument(undefined);setError('This view lost authorization or its connection. Refresh to recheck access.')}}
  const check=()=>{
   if(stopped||epoch!==generation.current)return Promise.resolve(false)
   if(pending)return pending
   const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>
   const unavailable=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(Error('Authorization timed out'))},5000)})
   pending=Promise.race([client.applicationRenderers?.(model.projectId,controller.signal)??Promise.reject(Error('Catalog unavailable')),unavailable]).then(rows=>{
    const found=rows.some(row=>row.authority==='core'&&row.execution_trust==='trusted_signed_publisher'&&row.application_id===renderer.application_id&&row.instance_id===renderer.instance_id&&row.package_ref.package_id===renderer.package_ref.package_id&&row.package_ref.version===renderer.package_ref.version&&row.package_ref.manifest_digest===renderer.package_ref.manifest_digest&&row.content_digest===renderer.content_digest&&row.input_schema.$id===PROJECT_VIEW_CONTRACT)
    if(!found)revoke();return found&&!stopped&&epoch===generation.current
   }).catch(()=>{revoke();return false}).finally(()=>{clearTimeout(timeout);pending=undefined})
   return pending
  }
  authorize.current=check;requestPending.current=false
  const pollNext=()=>{poll=setTimeout(()=>{void check().then(ok=>{if(ok)pollNext()})},5000)}
  if(!client.applicationRendererContent){revoke();return}

  const manifest={...renderer,sandbox_policy:{scripts:true as const,network:false as const,same_origin:false as const,navigation:'host_observed_only' as const}}
  client.applicationRendererContent(model.projectId,renderer,abort.signal).then(response=>readExactRenderer(response,manifest)).then(async fragment=>{if(await check()){saved.current=readProjectViewState(stateScope,model.projectId,renderer,()=>setStateNotice("Saved view state was migrated using this package’s declaration. The previous package’s state is preserved."));pollNext();setDocument({html:sandboxDocument(fragment),nonce:crypto.randomUUID(),generation:epoch})}}).catch(()=>{if(epoch===generation.current&&!abort.signal.aborted)setError('This view could not be loaded. Select another view or refresh.')})
  return()=>{stopped=true;clearTimeout(poll);abort.abort();generation.current++}
 },[client,renderer,lifecycleModel,connectionKey,stateScope])
 useEffect(()=>{if(!document)return;let initialized=false,count=0,windowStart=Date.now();const timeout=setTimeout(()=>{if(!initialized)setError('This view did not become ready. Select another view or refresh.')},5000)
  const listener=(event:MessageEvent)=>{if(document.generation!==generation.current||!acceptsApplicationMessage(event,{source:frame.current?.contentWindow??null,nonce:document.nonce,generation:document.generation,instanceId:renderer.instance_id,connectionKey,packageRef:renderer.package_ref}))return
   if(Date.now()-windowStart>1000){count=0;windowStart=Date.now()}if(++count>32)return
   const message=event.data as typeof event.data & {task_id?:unknown}
   if(message.kind==='ready'){initialized=true;clearTimeout(timeout);setReady(true);return}
   if(initialized&&message.kind==='state'){
    const value=projectViewState(message.state,renderer)
    if(!value||requestPending.current)return
    requestPending.current=true
    void authorize.current().then(ok=>{if(ok&&document.generation===generation.current){saved.current=value;setStateNotice(writeProjectViewState(stateScope,model.projectId,renderer,value)?'':'View state could not be saved in this tab.')}}).finally(()=>{if(document.generation===generation.current)requestPending.current=false})
    return
   }
   if(!initialized||message.kind!=='request')return
   const taskId=message.task_id
   if(requestPending.current||!(message.action==='new_task'||(message.action==='open_task'&&typeof taskId==='string'&&currentModel.current.tasks.some(task=>task.id===taskId))))return
   requestPending.current=true
   void authorize.current().then(ok=>{if(ok&&document.generation===generation.current){if(message.action==='new_task')actions.current.onNewTask();else if(currentModel.current.tasks.some(task=>task.id===taskId))actions.current.onOpenTask(taskId as string)}}).finally(()=>{if(document.generation===generation.current)requestPending.current=false})
  };addEventListener('message',listener);return()=>{clearTimeout(timeout);removeEventListener('message',listener)}
 },[document,renderer,connectionKey,stateScope])
 useEffect(()=>{
  if(!live||!ready||!document||sentModel.current===model)return
  let cancelled=false
  void authorize.current().then(ok=>{
   if(!ok||cancelled||document.generation!==generation.current||currentModel.current!==model)return
   frame.current?.contentWindow?.postMessage({protocol:APPLICATION_PROTOCOL,kind:'projection',nonce:document.nonce,generation:document.generation,instance_id:renderer.instance_id,connection_key:connectionKey,package_ref:renderer.package_ref,projection_revision:++projectionRevision.current,projection:{schema:PROJECT_VIEW_CONTRACT,model}},'*')
   sentModel.current=model
  })
  return()=>{cancelled=true}
 },[live,ready,document,model,renderer,connectionKey])
 if(error)return <p role="alert">{error}</p>
 return <section>{stateNotice&&<p role="status">{stateNotice}</p>}{!ready&&<p role="status">Loading installed view…</p>}{document&&<iframe key={document.nonce} title={`Project view: ${renderer.application_id}`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document.html} style={{width:'100%',minHeight:520,border:0}} onLoad={()=>{if(frame.current?.dataset.loaded){setError('View navigation interrupted. Select another view or refresh.');return}if(frame.current)frame.current.dataset.loaded='true';sentModel.current=model;frame.current?.contentWindow?.postMessage({protocol:APPLICATION_PROTOCOL,kind:'init',nonce:document.nonce,generation:document.generation,instance_id:renderer.instance_id,connection_key:connectionKey,package_ref:renderer.package_ref,projection:{schema:PROJECT_VIEW_CONTRACT,model},state:saved.current},'*')}} ref={frame}/>}</section>
}
