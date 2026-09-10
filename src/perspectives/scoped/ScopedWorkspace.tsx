import React,{useCallback,useEffect,useState,type ReactNode} from 'react'
import {Link} from 'react-router-dom'
import type {ScopedRendererClient,ScopedEnvironment} from '../../services/scopedRenderers'
import type {ApplicationRendererCandidate} from '../../services/contracts'
import {ScopedViewHost} from './ScopedViewHost'
import './scoped-workspace.css'
void React

/** The host owns navigation and escape controls even when its main view is replaced. */
export function ScopedWorkspace({client,teamId,children}:{client?:ScopedRendererClient;teamId?:string;children:ReactNode}) {
 const identity=client?.identity(),scopeKey=[identity,teamId??''].join('\0')
 const [loaded,setLoaded]=useState<{key:string;environment:ScopedEnvironment;candidate?:ApplicationRendererCandidate}>()
 const [fallback,setFallback]=useState<string>(),[attempt,setAttempt]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const unavailable=useCallback(()=>setFallback(scopeKey),[scopeKey])
 useEffect(()=>{
  if(!client||!identity)return
  let active=true;const abort=new AbortController()
  setLoaded(undefined);setError('')
  const scope=teamId?{kind:'team' as const,id:teamId}:{kind:'user' as const,id:identity}
  void client.environment(scope,abort.signal).then(async environment=>{
   if(!active)return
   if(!environment.definition.applications?.length){setLoaded({key:scopeKey,environment});return}
   const catalog=await client.candidates(scope,abort.signal)
   if(!active)return
   const application=environment.definition.applications?.[0]
   const candidate=catalog.items.find(item=>item.available.available&&item.enablement?.status==='enabled'&&item.enablement.version===item.package_version&&item.application_id===application?.application_id&&item.package_id===application.package_ref?.package_id&&item.package_version===application.package_ref?.version&&item.manifest_digest===application.package_ref?.manifest_digest)
   setLoaded({key:scopeKey,environment,candidate})
   if(application&&!candidate)setFallback(scopeKey)
  }).catch(()=>{if(active){setError('Your selected view could not be checked. The default workspace is available.');setFallback(scopeKey)}})
  return()=>{active=false;abort.abort()}
 },[client,identity,teamId,scopeKey,attempt])
 const current=loaded?.key===scopeKey?loaded:undefined,selected=Boolean(current?.environment.definition.applications?.length)
 const useDefault=async()=>{
  if(!client||!current||busy)return
  setBusy(true)
  try{await client.select(teamId?{kind:'team',id:teamId}:{kind:'user',id:identity!},current.environment.revision,null,'Restore default workspace');setFallback(scopeKey);setAttempt(value=>value+1)}
  catch{setError('The default could not be saved. Check your access and refresh before retrying.');setFallback(scopeKey)}
  finally{setBusy(false)}
 }
 const show=client&&current?.candidate&&fallback!==scopeKey
 return <>{(selected||error)&&<div className="scoped-workspace-controls" role="region" aria-label="Workspace view controls">
  <div className="scoped-workspace-summary"><strong>{show?current.candidate?.title:'Default workspace'}</strong><span>{show?'Installed view':selected?'Your installed view is still selected':'Workspace recovery'}</span></div>
  <div className="scoped-workspace-actions">
  <Link to={teamId?'/teams':'/settings/appearance'}>View settings</Link>
  {show?<button onClick={()=>setFallback(scopeKey)}>Show default workspace</button>:<button onClick={()=>{setFallback(undefined);setAttempt(value=>value+1)}}>Retry selected view</button>}
  {selected&&<button disabled={busy} onClick={()=>useDefault()}>Restore default workspace</button>}
  </div>
  {selected&&<p className="scoped-workspace-hint">Showing the default is temporary. Restoring it changes your saved view.</p>}
  {error&&<p role="alert">{error}</p>}
 </div>}{show?<div className="scoped-workspace-view"><ScopedViewHost client={client} scope={teamId?{kind:'team',id:teamId}:{kind:'user',id:identity!}} environment={current.environment} candidate={current.candidate!} onUnavailable={unavailable} fullPage/></div>:children}</>
}
