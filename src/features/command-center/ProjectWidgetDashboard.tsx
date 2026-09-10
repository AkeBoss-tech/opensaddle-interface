import type {ProjectTaskFeedAuthority} from '../../services/projectTaskFeed'
import React,{useCallback,useEffect,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {DashboardLayout,type DashboardWidget} from './DashboardLayout'
import type {DashboardSettings} from '../../services/dashboardSettings'
import type {ProjectDirectoryClient,DirectoryProject} from '../../services/projectDirectory'
import type {MalleableShellClient,ApplicationRendererDescriptor} from '../../services/contracts'
import type {JourneyAuthority} from '../onboarding/ConnectedJourneySurface'
import {PROJECT_VIEW_CONTRACT,projectViewCompatibility} from '../../perspectives/project/installed'
import {InstalledProjectView} from '../../perspectives/project/InstalledProjectView'
import {ProjectTaskFeed} from '../../perspectives/project/ProjectTaskFeed'
void React
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('')}
export async function projectWidgetPrefix(projectId:string){return 'widget.'+(await hash(projectId)).slice(0,32)+'.'}
export async function projectWidgetId(projectId:string,renderer:ApplicationRendererDescriptor){return await projectWidgetPrefix(projectId)+(await hash(JSON.stringify([renderer.package_ref.package_id,renderer.application_id,renderer.instance_id]))).slice(0,32)}
type Entry={id:string;project:DirectoryProject;renderer:ApplicationRendererDescriptor}
export function ProjectWidgetDashboard({client,identity,widgets,directory,shell,journey,stateScope,taskFeed}:{taskFeed?:ProjectTaskFeedAuthority;client?:DashboardSettings;identity:unknown;widgets:DashboardWidget[];directory?:Pick<ProjectDirectoryClient,'list'>;shell?:MalleableShellClient;journey?:Pick<JourneyAuthority,'snapshot'>;stateScope?:string}){
 const navigate=useNavigate(),[savedIds,setSavedIds]=useState<string[]>([]),[selected,setSelected]=useState(''),[reload,setReload]=useState(0)
 const [catalog,setCatalog]=useState<{identity:unknown;directory:typeof directory;shell:typeof shell;selection:string;key:string;projects:DirectoryProject[];entries:Entry[]}>(),[error,setError]=useState('')
 const key=JSON.stringify(savedIds.filter(id=>/^widget\.[a-f0-9]{32}\.[a-f0-9]{32}$/.test(id))),enabled=Boolean(client&&directory&&shell?.applicationRenderers&&journey)
 const current=enabled&&catalog&&catalog.identity===identity&&catalog.directory===directory&&catalog.shell===shell&&catalog.selection===selected&&catalog.key===key?catalog:undefined
 const receiveLayout=useCallback((ids:string[])=>setSavedIds(previous=>JSON.stringify(previous)===JSON.stringify(ids)?previous:ids),[])
 useEffect(()=>{let stopped=false;setCatalog(undefined);setError('');if(!enabled||!directory||!shell?.applicationRenderers)return
  const timer=setTimeout(()=>{stopped=true;setCatalog(undefined);setError('Widget discovery timed out. Reload to check access.')},15000)
  void (async()=>{
   const projects=await directory.list(),wanted=JSON.parse(key) as string[]
   const relevant=(await Promise.all(projects.map(async project=>({project,prefix:await projectWidgetPrefix(project.id)})))).filter(({project,prefix})=>project.id===selected||wanted.some(id=>id.startsWith(prefix)))
   const entries=(await Promise.all(relevant.map(async({project})=>{
    const rows=await shell.applicationRenderers!(project.id)
    const compatible=rows.filter(row=>row.authority==='core'&&row.execution_trust==='trusted_signed_publisher'&&row.input_schema?.$id===PROJECT_VIEW_CONTRACT&&projectViewCompatibility(row,'widget')===undefined)
    return Promise.all(compatible.map(async renderer=>({id:await projectWidgetId(project.id,renderer),project,renderer})))
   }))).flat()
   if(new Set(entries.map(entry=>entry.id)).size!==entries.length)throw Error('Ambiguous widget registration')
   if(!stopped)setCatalog({identity,directory,shell,selection:selected,key,projects,entries})
  })().catch(()=>{if(!stopped)setError('Project widgets could not be loaded. Check your connection and Project access.')}).finally(()=>clearTimeout(timer))
  return()=>{stopped=true;clearTimeout(timer)}
 },[enabled,directory,shell,identity,selected,key,reload])
 const connectionKey=typeof identity==='string'?identity:'connected'
 const contributions:DashboardWidget[]=(current?.entries??[]).map(({id,project,renderer})=>({id,title:project.name+' · '+renderer.application_id,content:<section className="cc-panel" aria-label={project.name+' widget'}><h2>{project.name} · {renderer.application_id}</h2><ProjectTaskFeed taskFeed={taskFeed} authority={journey!} projectId={project.id} connectionKey={connectionKey}>{model=><InstalledProjectView mount="widget" client={shell!} renderer={renderer} model={model} connectionKey={connectionKey} stateScope={stateScope?stateScope+'/dashboard-widgets':undefined} onOpenTask={run=>navigate(`/project/${encodeURIComponent(project.id)}/tasks/${encodeURIComponent(run)}`)} onNewTask={()=>navigate(`/project/${encodeURIComponent(project.id)}/new-task`)}/>}</ProjectTaskFeed></section>}))
 return <>{enabled&&<details className="cc-panel"><summary>Add project widgets</summary><p>Choose a project to discover its enabled widgets, then select them in Customize dashboard. Each widget sees only its own project.</p><label>Widget project<select value={selected} disabled={!current} onChange={event=>setSelected(event.target.value)}><option value="">Choose a project</option>{current?.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label><button onClick={()=>setReload(value=>value+1)}>Reload widget catalog</button>{error&&<p role="alert">{error}</p>}{!current&&!error&&<p role="status">Loading widget catalog…</p>}{current&&selected&&!current.entries.some(entry=>entry.project.id===selected)&&<p>No compatible widgets are enabled for this project.</p>}</details>}<DashboardLayout client={client} identity={identity} widgets={[...widgets,...contributions]} onLayoutChange={receiveLayout}/></>
}
