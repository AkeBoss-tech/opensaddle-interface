import {ManagerConversationsPanel} from '../command-center/ManagerConversationsPanel'
import {installedProjectViews} from '../../perspectives/project/installed'
import {InstalledProjectView} from '../../perspectives/project/InstalledProjectView'
import React,{useEffect,useMemo,useRef,useState} from 'react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {useStore} from '../../data/store'
import {PerspectiveHost} from '../../perspectives/PerspectiveHost'
import {PROJECT_PERSPECTIVES,resolveProjectPerspective} from '../../perspectives/project/builtins'
import {ProjectTaskFeed} from '../../perspectives/project/ProjectTaskFeed'
import type {PresentationLayer} from '../../services/presentationSettings'
void React
type WorkspaceProps={projectId:string;services:ReturnType<typeof useStore>['services']}
export function ProjectPerspectiveWorkspace(props:WorkspaceProps){
 // Scope changes discard recovery, drafts and in-flight UI state synchronously.
 // The old mount's cleanup invalidates pending reads before they can publish.
 const settings=props.services?.presentationSettings
 const scope=JSON.stringify([props.projectId,settings?.stateScope(),settings?.identity()])
 return <ScopedProjectPerspectiveWorkspace key={scope} {...props}/>
}
function ScopedProjectPerspectiveWorkspace({projectId,services}:WorkspaceProps){
 const [search,setSearch]=useSearchParams()
 const conversations=useMemo(()=>services?.projectConversations?.(projectId),[services,projectId])
 const [conversationBusy,setConversationBusy]=useState(false)
 const [failedView,setFailedView]=useState('')
 const recoveryNotice=useRef<HTMLParagraphElement>(null)
 const navigate=useNavigate(),generation=useRef(0),locked=useRef(false)
 const [state,setState]=useState<{services:typeof services;identity:string|undefined;installed:ReturnType<typeof installedProjectViews>;preferred:string;layer?:PresentationLayer}>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0)
 const identity=services?.presentationSettings?.identity()
 const conversationDrafts=useMemo(()=>new Map<string,string>(),[conversations,identity,projectId])
 const current=state?.services===services&&state?.identity===identity?state:undefined
 useEffect(()=>{const epoch=++generation.current;setState(undefined);setError('');setBusy(true);locked.current=true
 if(!services?.journey){setError('Project task authority is unavailable.');setBusy(false);locked.current=false;return}
 Promise.all([services.presentationSettings?.effective(projectId),services.presentationSettings?.read('user_project',projectId),services.malleableShell?.applicationRenderers?.(projectId).catch(()=>[])??Promise.resolve([])]).then(([effective,layer,renderers])=>{if(epoch===generation.current)setState({services,identity,installed:installedProjectViews(renderers),preferred:effective?.values.perspective??'dialogue',layer})}).catch(()=>{if(epoch===generation.current)setError('Could not load this project and its view preference. Check your connection and access.')}).finally(()=>{if(epoch===generation.current){setBusy(false);locked.current=false}})
 return()=>{generation.current++}
 },[services,identity,projectId,refresh])
 async function select(id:string){if(!current?.layer||!services?.presentationSettings||locked.current)return;const epoch=generation.current;locked.current=true;setBusy(true);setError('');try{const layer=await services.presentationSettings.replace('user_project',projectId,current.layer.revision,{...current.layer.values,perspective:id});if(epoch===generation.current){setFailedView('');setState({...current,layer,preferred:id})}}catch{if(epoch===generation.current)setError('View preference changed or could not be saved. Refresh before trying again.')}finally{if(epoch===generation.current){locked.current=false;setBusy(false)}}}
 // Removing a focused frame can leave focus on body. Announce recovery without
 // interrupting someone who has already moved to another host control.
 useEffect(()=>{if(failedView&&current&&!busy&&typeof document!=='undefined'&&document.activeElement===document.body)recoveryNotice.current?.focus()},[failedView,current,busy])
 const selectedInstalled=current?.installed.find(view=>view.id===current.preferred)
 const installed=failedView===current?.preferred?undefined:selectedInstalled
 const resolved=current?resolveProjectPerspective(current.preferred):undefined
 return <section className="content-page project-perspective-workspace"><header className="project-perspective-toolbar"><div><span>{projectId}</span><h1>Workspace</h1></div><label>View<select disabled={busy||conversationBusy||!current?.layer} value={installed?.id??resolved?.perspective.id??'dialogue'} onChange={event=>void select(event.target.value)}>{[...PROJECT_PERSPECTIVES,...(current?.installed??[])].map(view=><option key={view.id} value={view.id}>{view.title}</option>)}</select></label><button disabled={busy||conversationBusy} onClick={()=>{setFailedView('');setRefresh(value=>value+1)}}>Refresh workspace</button></header>{error&&<p role="alert">{error}</p>}{busy&&!current&&<p role="status">Loading project…</p>}{current&&resolved&&<>{!installed&&resolved.fallback&&<p ref={recoveryNotice} tabIndex={-1} role="status">Your preferred view “{current.preferred}” is unavailable. Showing Dialogue; your preference is preserved.</p>}{!installed&&resolved.perspective.id==='dialogue'&&conversations&&<ManagerConversationsPanel onBusy={setConversationBusy} conversationDrafts={conversationDrafts} selection={{id:search.get('conversation')??'',onChange:id=>{const next=new URLSearchParams(search);next.set('conversation',id);setSearch(next)}}} client={conversations} identity={identity} projectIds={[projectId]} name={id=>id}/>}<ProjectTaskFeed taskFeed={services?.projectTaskFeed} key={refresh} authority={services!.journey!} projectId={projectId} connectionKey={identity??'connected'}>{model=>installed&&services?.malleableShell?<InstalledProjectView onUnavailable={()=>{setFailedView(current.preferred);setRefresh(value=>value+1)}} settingsClient={services?.rendererSettings} client={services.malleableShell} renderer={installed.renderer} model={model} connectionKey={identity??'connected'} stateScope={services.presentationSettings?.stateScope()} onOpenTask={id=>navigate(`/project/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(id)}`)} onNewTask={()=>navigate(`/project/${encodeURIComponent(projectId)}/new-task`)}/>:<PerspectiveHost key={resolved.perspective.id} perspective={resolved.perspective} projectId={projectId} inputs={{model,onOpenTask:(id:string)=>{if(model.tasks.some(task=>task.id===id))navigate(`/project/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(id)}`)},onNewTask:()=>navigate(`/project/${encodeURIComponent(projectId)}/new-task`)}}/>}</ProjectTaskFeed></>}</section>
}
