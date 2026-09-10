import React,{useEffect,useMemo,useState} from 'react'
import {StandalonePluginSettingsClient,type StandalonePluginPreference} from '../../services/standalonePluginSettings'
import {RendererSettingsEditor} from './RendererSettingsEditor'
import type {RendererSettingsTarget} from '../../services/rendererSettings'
void React
export function StandalonePluginSettings({client,teamId}:{client:StandalonePluginSettingsClient;teamId?:string}){
 const identity=client.identity(),[reload,setReload]=useState(0),[error,setError]=useState('')
 const [loaded,setLoaded]=useState<{client:typeof client;identity:string;teamId?:string;items:StandalonePluginPreference[]}>()
 const current=loaded?.client===client&&loaded.identity===identity&&loaded.teamId===teamId?loaded:undefined
 useEffect(()=>{let active=true;setLoaded(undefined);setError('');void client.list(teamId).then(items=>{if(active)setLoaded({client,identity,teamId,items})}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Plugin preferences unavailable.')});return()=>{active=false}},[client,identity,teamId,reload])
 return <section className="presentation-editor"><h2>{teamId?'Team plugin defaults':'Personal plugin defaults'}</h2><p>Manage saved defaults across projects. Project overrides can take precedence.</p><button onClick={()=>setReload(value=>value+1)}>Reload plugin preferences</button>{error&&<p role="alert">{error}</p>}{!current&&!error&&<p role="status">Loading plugin preferences…</p>}{current?.items.map(item=><Preference key={item.settings_key} client={client} item={item} teamId={teamId}/>)}{current&&!current.items.length&&<p>No saved plugin defaults are available. Defaults first saved from a project appear here while the package remains available.</p>}</section>
}
function Preference({client,item,teamId}:{client:StandalonePluginSettingsClient;item:StandalonePluginPreference;teamId?:string}){
 const authority=useMemo(()=>client.editor(item,teamId),[client,item,teamId])
 // This descriptor is used only by the host form; no renderer bytes or sandbox are created.
 const renderer=useMemo(()=>({application_id:item.application_id,instance_id:teamId?'team defaults':'personal defaults',package_ref:item.package_ref,descriptor:{settings_contract:item.contract}} satisfies RendererSettingsTarget),[item,teamId])
 return <RendererSettingsEditor client={authority} renderer={renderer} projectId=""/>
}
