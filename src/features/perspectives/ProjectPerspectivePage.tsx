import {installedProjectViews} from '../../perspectives/project/installed'
import {InstalledProjectView} from '../../perspectives/project/InstalledProjectView'
import React,{useEffect,useRef,useState} from 'react'
import {useNavigate,useParams} from 'react-router-dom'
import {useStore} from '../../data/store'
import {PerspectiveHost} from '../../perspectives/PerspectiveHost'
import {PROJECT_PERSPECTIVES,resolveProjectPerspective} from '../../perspectives/project/builtins'
import {projectTaskModel,type ProjectTaskModel} from '../../perspectives/project/model'
import type {PresentationLayer} from '../../services/presentationSettings'
import './project-perspectives.css'
void React
export function ProjectPerspectivePage(){const {projectId=''}=useParams();const {services}=useStore();return <ProjectPerspectiveWorkspace key={projectId} projectId={projectId} services={services}/>}
function ProjectPerspectiveWorkspace({projectId,services}:{projectId:string;services:ReturnType<typeof useStore>['services']}){
 const navigate=useNavigate(),generation=useRef(0),locked=useRef(false)
 const [state,setState]=useState<{services:typeof services;identity:string|undefined;model:ProjectTaskModel;installed:ReturnType<typeof installedProjectViews>;preferred:string;layer?:PresentationLayer}>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0)
 const identity=services?.presentationSettings?.identity()
 const current=state?.services===services&&state?.identity===identity?state:undefined
 useEffect(()=>{const epoch=++generation.current;setState(undefined);setError('');setBusy(true);locked.current=true
 if(!services?.journey){setError('Project task authority is unavailable.');setBusy(false);locked.current=false;return}
 Promise.all([services.journey.snapshot(projectId),services.presentationSettings?.effective(projectId),services.presentationSettings?.read('user_project',projectId),services.malleableShell?.applicationRenderers?.(projectId).catch(()=>[])??Promise.resolve([])]).then(([snapshot,effective,layer,renderers])=>{if(epoch===generation.current)setState({services,identity,model:projectTaskModel(snapshot,projectId),installed:installedProjectViews(renderers),preferred:effective?.values.perspective??'dialogue',layer})}).catch(()=>{if(epoch===generation.current)setError('Could not load this project and its view preference. Check your connection and access.')}).finally(()=>{if(epoch===generation.current){setBusy(false);locked.current=false}})
 return()=>{generation.current++}
 },[services,identity,projectId,refresh])
 async function select(id:string){if(!current?.layer||!services?.presentationSettings||locked.current)return;const epoch=generation.current;locked.current=true;setBusy(true);setError('');try{const layer=await services.presentationSettings.replace('user_project',projectId,current.layer.revision,{...current.layer.values,perspective:id});if(epoch===generation.current)setState({...current,layer,preferred:id})}catch{if(epoch===generation.current)setError('View preference changed or could not be saved. Refresh before trying again.')}finally{if(epoch===generation.current){locked.current=false;setBusy(false)}}}
 const installed=current?.installed.find(view=>view.id===current.preferred)
 const resolved=current?resolveProjectPerspective(current.preferred):undefined
 return <section className="content-page project-perspective-workspace"><header className="project-perspective-toolbar"><div><span>{projectId}</span><h1>Workspace</h1></div><label>View<select disabled={busy||!current?.layer} value={installed?.id??resolved?.perspective.id??'dialogue'} onChange={event=>void select(event.target.value)}>{[...PROJECT_PERSPECTIVES,...(current?.installed??[])].map(view=><option key={view.id} value={view.id}>{view.title}</option>)}</select></label><button disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Refresh workspace</button></header>{error&&<p role="alert">{error}</p>}{busy&&!current&&<p role="status">Loading project…</p>}{current&&resolved&&<>{!installed&&resolved.fallback&&<p role="status">Your preferred view “{current.preferred}” is unavailable. Showing Dialogue; your preference is preserved.</p>}{installed&&services?.malleableShell?<InstalledProjectView client={services.malleableShell} renderer={installed.renderer} model={current.model} connectionKey={identity??'connected'} onOpenTask={id=>navigate(`/runs?run=${encodeURIComponent(id)}`)} onNewTask={()=>navigate(`/project/${encodeURIComponent(projectId)}/collaboration`)}/>:<PerspectiveHost key={resolved.perspective.id} perspective={resolved.perspective} projectId={projectId} inputs={{model:current.model,onOpenTask:(id:string)=>{if(current.model.tasks.some(task=>task.id===id))navigate(`/runs?run=${encodeURIComponent(id)}`)},onNewTask:()=>navigate(`/project/${encodeURIComponent(projectId)}/collaboration`)}}/>}</>}</section>
}
