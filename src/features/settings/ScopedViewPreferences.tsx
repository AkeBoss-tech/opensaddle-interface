import React,{useEffect,useMemo,useState} from 'react'
import type {ApplicationRendererCandidate} from '../../services/contracts'
import type {ScopedRendererClient} from '../../services/scopedRenderers'
import type {StandalonePluginPreference} from '../../services/standalonePluginSettings'
import {rendererSettingsContract,type RendererSettingsTarget} from '../../services/rendererSettings'
import {RendererSettingsEditor} from './RendererSettingsEditor'
void React

/** Catalog-owned identity replaces manual package-reference entry. */
export function ScopedViewPreferences({client,candidate,teamId}:{client:ScopedRendererClient;candidate:ApplicationRendererCandidate;teamId?:string}){
 const [open,setOpen]=useState(false)
 const contract=rendererSettingsContract((candidate as unknown as {descriptor?:{settings_contract?:unknown}}).descriptor?.settings_contract)
 if(!contract?.scopes.includes(teamId?'team':'user'))return null
 return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>View settings</summary>{open&&<Preferences key={JSON.stringify([client.identity(),teamId,candidate.package_id,candidate.package_version,candidate.manifest_digest,candidate.application_id])} client={client} candidate={candidate} teamId={teamId}/>}</details>
}
function Preferences({client,candidate,teamId}:{client:ScopedRendererClient;candidate:ApplicationRendererCandidate;teamId?:string}){
 const preferences=useMemo(()=>client.preferences(),[client]),identity=client.identity()
 const [row,setRow]=useState<StandalonePluginPreference>(),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0)
 const ref=useMemo(()=>({package_id:candidate.package_id,version:candidate.package_version,manifest_digest:candidate.manifest_digest,application_id:candidate.application_id}),[candidate])
 useEffect(()=>{let active=true;setLoaded(false);setRow(undefined);setError('');void preferences.list(teamId).then(rows=>{if(active&&preferences.identity()===identity){setRow(rows.find(item=>item.application_id===ref.application_id&&item.package_ref.package_id===ref.package_id&&item.package_ref.version===ref.version&&item.package_ref.manifest_digest===ref.manifest_digest));setLoaded(true)}}).catch(()=>{if(active)setError('View settings could not be loaded. Check your access and retry.')});return()=>{active=false}},[preferences,identity,teamId,ref,reload])
 async function enroll(){if(busy)return;setBusy(true);setError('');try{await preferences.enroll(ref,teamId);setReload(value=>value+1)}catch{setError('Defaults could not be created. Reload to check your access and the saved state.')}finally{setBusy(false)}}
 const authority=useMemo(()=>row?preferences.editor(row,teamId):undefined,[preferences,row,teamId])
 const renderer=useMemo(()=>row?{application_id:row.application_id,instance_id:teamId?'team defaults':'personal defaults',package_ref:row.package_ref,descriptor:{settings_contract:row.contract}} satisfies RendererSettingsTarget:undefined,[row,teamId])
 return <section aria-label="Selected view preferences">{error&&<p role="alert">{error}</p>}{!loaded&&!error&&<p role="status">Loading view settings…</p>}{loaded&&!row&&<><p>This view is using its declared defaults. {teamId?'A Team manager can create shared preferences.':'Create personal preferences to customize it.'}</p><button disabled={busy} onClick={()=>void enroll()}>Create view defaults</button></>}{authority&&renderer&&<RendererSettingsEditor defaultExpanded client={authority} renderer={renderer} projectId=""/>}<button disabled={busy} onClick={()=>setReload(value=>value+1)}>Reload view settings</button></section>
}
