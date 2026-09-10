import React,{useEffect,useMemo,useState,useRef} from 'react'
import {StandalonePluginSettingsClient,type StandalonePluginPreference} from '../../services/standalonePluginSettings'
import {RendererSettingsEditor} from './RendererSettingsEditor'
import type {RendererSettingsTarget} from '../../services/rendererSettings'
void React
export function StandalonePluginSettings({client,teamId}:{client:StandalonePluginSettingsClient;teamId?:string}){
 const identity=client.identity(),[reload,setReload]=useState(0),[error,setError]=useState('')
 const [loaded,setLoaded]=useState<{client:typeof client;identity:string;teamId?:string;items:StandalonePluginPreference[]}>()
 const current=loaded?.client===client&&loaded.identity===identity&&loaded.teamId===teamId?loaded:undefined
 useEffect(()=>{let active=true;setLoaded(undefined);setError('');void client.list(teamId).then(items=>{if(active)setLoaded({client,identity,teamId,items})}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Plugin preferences unavailable.')});return()=>{active=false}},[client,identity,teamId,reload])
 return <section className="presentation-editor"><h2>{teamId?'Team plugin defaults':'Personal plugin defaults'}</h2><p>Manage saved defaults across projects. Project overrides can take precedence.</p><button onClick={()=>setReload(value=>value+1)}>Reload plugin preferences</button>{error&&<p role="alert">{error}</p>}{!current&&!error&&<p role="status">Loading plugin preferences…</p>}{current&&<Setup key={JSON.stringify([identity,teamId])} client={client} teamId={teamId} onCreated={()=>setReload(value=>value+1)}/>} {current?.items.map(item=><Preference key={item.settings_key} client={client} item={item} teamId={teamId}/>)}{current&&!current.items.length&&<p>No saved plugin defaults are available. Add a plugin reference to start, or save defaults from a project.</p>}</section>
}
function Preference({client,item,teamId}:{client:StandalonePluginSettingsClient;item:StandalonePluginPreference;teamId?:string}){
 const authority=useMemo(()=>client.editor(item,teamId),[client,item,teamId])
 // This descriptor is used only by the host form; no renderer bytes or sandbox are created.
 const renderer=useMemo(()=>({application_id:item.application_id,instance_id:teamId?'team defaults':'personal defaults',package_ref:item.package_ref,descriptor:{settings_contract:item.contract}} satisfies RendererSettingsTarget),[item,teamId])
 return <RendererSettingsEditor client={authority} renderer={renderer} projectId=""/>
}

function Setup({client,teamId,onCreated}:{client:StandalonePluginSettingsClient;teamId?:string;onCreated:()=>void}){
 const [reference,setReference]=useState({package_id:'',version:'',manifest_digest:'',application_id:''})
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const locked=useRef(false),active=useRef(true)
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 async function submit(event:React.FormEvent){
  event.preventDefault();if(locked.current)return
  locked.current=true;setBusy(true);setError('')
  try{await client.enroll(reference,teamId);if(active.current)onCreated()}
  catch(reason){if(active.current)setError(reason instanceof Error?reason.message:'Setup could not be confirmed. Reload before retrying.')}
  finally{if(active.current)setBusy(false)}
 }
 return <details><summary>Add plugin defaults</summary><p>Use the exact reference supplied by the plugin publisher or your administrator. The package must already be installed. {teamId?'A Team manager must set up shared defaults.':''}</p><form onSubmit={event=>void submit(event)}>{([['package_id','Package ID'],['version','Package version'],['manifest_digest','Manifest digest'],['application_id','Application ID']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} required disabled={busy||Boolean(error)} value={reference[key]} maxLength={key==='manifest_digest'?64:key==='version'?100:200} onChange={event=>setReference(previous=>({...previous,[key]:event.target.value.trim()}))}/></label>)}<button type="submit" disabled={busy||Boolean(error)||Object.values(reference).some(value=>!value)}>{busy?'Adding defaults…':'Add defaults'}</button>{error&&<p role="alert">{error} Reload plugin preferences to check the saved state.</p>}</form></details>
}
