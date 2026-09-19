import React,{useEffect,useMemo,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {PersonalPackageInstaller} from '../settings/PersonalPackageInstaller'
import {projectViewCompatibility,PROJECT_VIEW_CONTRACT} from '../../perspectives/project/installed'
import type {ApplicationRendererCandidate,EnvironmentPreview,EnvironmentRevision,MalleableShellClient} from '../../services/contracts'
import type {PresentationSettingsClient} from '../../services/presentationSettings'
void React

type Candidate=ApplicationRendererCandidate
type Snapshot={identity:string;projectId:string;candidates:Candidate[];environment:EnvironmentRevision}
type Proposal={candidate:Candidate;environment:EnvironmentRevision;definition:EnvironmentRevision['definition'];preview:EnvironmentPreview}
type Activated={before:number;beforeDigest:string;after:number;digest:string}
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const packageRef=(candidate:Candidate)=>({package_id:candidate.package_id,version:candidate.package_version,manifest_digest:candidate.manifest_digest})
const sameRef=(a:{package_id:string;version:string;manifest_digest:string}|null|undefined,b:{package_id:string;version:string;manifest_digest:string})=>a?.package_id===b.package_id&&a?.version===b.version&&a?.manifest_digest===b.manifest_digest
const exact=(a:Candidate,b:Candidate)=>a.application_id===b.application_id&&a.package_id===b.package_id&&a.package_version===b.package_version&&a.manifest_digest===b.manifest_digest&&a.content_digest===b.content_digest&&a.publisher_key_fingerprint===b.publisher_key_fingerprint
const key=(candidate:Candidate)=>JSON.stringify([candidate.package_id,candidate.package_version,candidate.manifest_digest,candidate.application_id,candidate.content_digest])
function projectView(candidate:Candidate){
 const application=candidate.environment_application
 return candidate.available.available&&candidate.input_schema?.$id===PROJECT_VIEW_CONTRACT&&projectViewCompatibility(candidate)===undefined&&digest(candidate.publisher_key_fingerprint)&&digest(candidate.manifest_digest)&&digest(candidate.content_digest)&&application?.application_id===candidate.application_id&&sameRef(application.package_ref,packageRef(candidate))&&application.source_ref.digest===`sha256:${candidate.content_digest}`&&application.instances.length>0
}
function configured(environment:EnvironmentRevision,candidate:Candidate){return environment.definition.applications?.some(application=>application.application_id===candidate.application_id&&sameRef(application.package_ref,packageRef(candidate)))??false}
function proposedDefinition(environment:EnvironmentRevision,candidate:Candidate){
 const application=candidate.environment_application!
 const selected=environment.definition.applications?.find(item=>item.application_id===candidate.application_id)
 if(selected&&selected.package_ref?.package_id!==candidate.package_id)throw Error('A different package already owns this application ID. Review the Project configuration before replacing it.')
 if(selected?.instances.some(instance=>!application.instances.some(next=>next.instance_id===instance.instance_id)))throw Error('The package omits an existing application instance.')
 const next={...application,instances:application.instances.map(instance=>{const old=selected?.instances.find(value=>value.instance_id===instance.instance_id);return old?{...instance,defaults:old.defaults}:instance})}
 return {...environment.definition,packages:[...(environment.definition.packages??[]).filter(value=>!value||typeof value!=='object'||(value as {package_id?:unknown}).package_id!==candidate.package_id),packageRef(candidate)],applications:[...(environment.definition.applications??[]).filter(value=>value.application_id!==candidate.application_id),next]}
}

/** Project activation composes the existing Core authorities; it never grants package code a command. */
export function ProjectViewCatalog({projectId,client,presentation,installationAvailable=false}:{projectId:string;client:MalleableShellClient & {scopedRenderers?:{personalCatalog:()=>import('../../services/personalCatalog').PersonalCatalogClient}};presentation:PresentationSettingsClient;installationAvailable?:boolean}){
 const identity=presentation.stateScope(),installer=useMemo(()=>installationAvailable?client.scopedRenderers?.personalCatalog():undefined,[client,installationAvailable])
 const epoch=useRef(0),lock=useRef(false),mounted=useRef(false)
 const [reload,setReload]=useState(0),[snapshot,setSnapshot]=useState<Snapshot>(),[proposal,setProposal]=useState<Proposal>(),[activated,setActivated]=useState<Activated>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const current=snapshot?.identity===identity&&snapshot.projectId===projectId?snapshot:undefined
 useEffect(()=>{mounted.current=true;const active=mounted;return()=>{active.current=false}},[client,presentation,projectId])
 useEffect(()=>{const generation=++epoch.current;let active=true;setSnapshot(undefined);setProposal(undefined);setError('');
  if(!client.applicationRendererCandidates){setError('Project view catalog is unavailable on this runtime.');return()=>{active=false}}
  void Promise.all([client.applicationRendererCandidates(projectId),client.environment(projectId)]).then(([candidates,environment])=>{if(active&&generation===epoch.current&&identity===presentation.stateScope()&&environment.project_id===projectId)setSnapshot({identity,projectId,candidates,environment})}).catch(()=>{if(active&&generation===epoch.current)setError('Project views could not be loaded. Check this Project and your connection.')})
  return()=>{active=false}
 },[client,presentation,identity,projectId,reload])
 const refresh=(keepMessage=false)=>{setProposal(undefined);if(!keepMessage)setMessage('');setReload(value=>value+1)}
 async function run(operation:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');try{await operation()}catch(reason){setProposal(undefined);setError(reason instanceof Error?reason.message:'The Project view change could not be confirmed. Refresh before retrying.')}finally{lock.current=false;setBusy(false)}}
 function checkIdentity(){if(!mounted.current||identity!==presentation.stateScope())throw Error('The Project or connected account changed. Reload Project views.')}
 async function exactCurrent(candidate:Candidate){
  checkIdentity();const rows=await client.applicationRendererCandidates!(projectId);checkIdentity()
  const matches=rows.filter(item=>exact(item,candidate));if(matches.length!==1||!projectView(matches[0]))throw Error('The signed Project view changed or is unavailable. Refresh before continuing.')
  return matches[0]
 }
 async function select(candidate:Candidate){
  checkIdentity();const layer=await presentation.read('user_project',projectId);checkIdentity()
  if(!layer.can_write)throw Error('Your Project view preference is read-only.')
  await presentation.replace('user_project',projectId,layer.revision,{...layer.values,perspective:`plugin.${candidate.application_id}`});checkIdentity()
 }
 async function prepare(candidate:Candidate){await run(async()=>{
  if(!client.enableApplicationRendererCandidate)throw Error('Project package enablement is unavailable on this runtime.')
  let fresh=await exactCurrent(candidate)
  if(fresh.enablement?.status!=='enabled'||fresh.enablement.version!==fresh.package_version){await client.enableApplicationRendererCandidate(projectId,fresh);checkIdentity();fresh=await exactCurrent(candidate)}
  if(fresh.enablement?.status!=='enabled'||fresh.enablement.version!==fresh.package_version)throw Error('Exact package enablement could not be confirmed.')
  const environment=await client.environment(projectId);checkIdentity();if(environment.project_id!==projectId)throw Error('Project environment identity mismatch.')
  if(configured(environment,fresh)){setProposal(undefined);setMessage('Exact package enabled. This Project already selects the signed view; use it from Workspace or choose it for your account.');refresh(true);return}
  const definition=proposedDefinition(environment,fresh)
  const preview=await client.preview(projectId,environment.revision,definition,`Preview signed Project view ${fresh.title}`,environment.definition_digest);checkIdentity()
  if(preview.project_id!==projectId||preview.base_revision!==environment.revision||preview.base_definition_digest!==environment.definition_digest)throw Error('Project environment preview identity mismatch.')
  setProposal({candidate:fresh,environment,definition,preview});setMessage('Package enabled for this Project. Review the environment preview before applying it. Runtime health is not yet observed.')
 })}
 async function apply(){if(!proposal)return;const reviewed=proposal;await run(async()=>{
  if(!reviewed.preview.activatable)throw Error(reviewed.preview.requirements.join(', ')||'The Project view cannot be activated.')
  const fresh=await exactCurrent(reviewed.candidate)
  if(fresh.enablement?.status!=='enabled'||fresh.enablement.version!==fresh.package_version||fresh.enablement.revision!==reviewed.candidate.enablement?.revision)throw Error('Project package enablement changed. Preview it again.')
  const environment=await client.environment(projectId);checkIdentity()
  if(environment.revision!==reviewed.environment.revision||environment.definition_digest!==reviewed.environment.definition_digest)throw Error('Project configuration changed. Preview it again.')
  const result=await client.apply(projectId,environment.revision,reviewed.definition,`Activate signed Project view ${fresh.title}`,environment.definition_digest);checkIdentity()
  if(result.project_id!==projectId||result.revision!==environment.revision+1||result.definition_digest!==reviewed.preview.proposed_definition_digest)throw Error('Project environment was applied but the exact result could not be confirmed. Refresh before continuing.')
  const renderers=await client.applicationRenderers?.(projectId);checkIdentity()
  if(!renderers?.some(item=>item.application_id===fresh.application_id&&item.package_ref.package_id===fresh.package_id&&item.package_ref.version===fresh.package_version&&item.package_ref.manifest_digest===fresh.manifest_digest&&item.content_digest===fresh.content_digest&&item.input_schema?.$id===PROJECT_VIEW_CONTRACT&&projectViewCompatibility(item)===undefined))throw Error('Project environment was applied, but the signed view is not available. Refresh before selecting a view.')
  setActivated({before:environment.revision,beforeDigest:environment.definition_digest,after:result.revision,digest:result.definition_digest})
  try{await select(fresh)}catch{throw Error('Project environment was applied, but your view preference was not saved. Select the view from the Workspace menu after checking access.')}
  setProposal(undefined);setMessage(`Project view ${fresh.title} is selected. Open Workspace to use it.`);setReload(value=>value+1)
 })}
 async function use(candidate:Candidate){await run(async()=>{const fresh=await exactCurrent(candidate),environment=await client.environment(projectId);checkIdentity();if(!configured(environment,fresh)||fresh.enablement?.status!=='enabled'||fresh.enablement.version!==fresh.package_version)throw Error('The exact view is no longer configured and enabled. Refresh before selecting it.');await select(fresh);setMessage(`Project view ${fresh.title} is selected. Open Workspace to use it.`)})}
 async function dialogue(){await run(async()=>{const layer=await presentation.read('user_project',projectId);checkIdentity();if(!layer.can_write)throw Error('Your Project view preference is read-only.');await presentation.replace('user_project',projectId,layer.revision,{...layer.values,perspective:'dialogue'});setMessage('Dialogue selected for your Project workspace. The signed package remains enabled.')})}
 async function disable(candidate:Candidate){await run(async()=>{if(!client.disableApplicationRendererCandidate)throw Error('Project package disablement is unavailable on this runtime.');const fresh=await exactCurrent(candidate);if(fresh.enablement?.status!=='enabled'||fresh.enablement.version!==fresh.package_version||fresh.enablement.revision!==candidate.enablement?.revision)throw Error('The exact package enablement changed. Refresh before disabling it.');await client.disableApplicationRendererCandidate(projectId,fresh);checkIdentity();setMessage('Package disabled for this Project. A selected view falls back to Dialogue; the preference and environment remain saved.');refresh(true)})}
 async function restore(){if(!activated)return;const target=activated;await run(async()=>{const environment=await client.environment(projectId);checkIdentity();if(environment.revision!==target.after||environment.definition_digest!==target.digest)throw Error('Project configuration changed. Use environment history to review a safe restore.');const result=await client.revert(projectId,target.after,target.before,'Restore Project configuration before signed view activation');checkIdentity();if(result.project_id!==projectId||result.revision!==target.after+1||result.definition_digest!==target.beforeDigest)throw Error('Project revert was requested, but its exact result could not be confirmed. Refresh and inspect environment history.');setActivated(undefined);setMessage('Previous Project configuration restored. The package remains enabled; choose Dialogue if your preference still names the view.');refresh(true)})}
 const projectCandidates=current?.candidates.filter(item=>item.input_schema?.$id===PROJECT_VIEW_CONTRACT&&projectViewCompatibility(item)===undefined)??[]
 const candidates=projectCandidates.filter(projectView),unavailable=projectCandidates.filter(item=>!projectView(item))
 return <section className="settings-card project-view-catalog"><h2>Add a signed Project view</h2><p>Install a publisher-signed package, enable its exact version for this Project, preview the configuration, then select the view. Publisher HTML runs as trusted signed code; the host does not provide full network isolation.</p>
  {installer?<PersonalPackageInstaller client={installer} onInstalled={()=>refresh()}/>:<p>Installation is available from a connected personal runtime owner catalog. Already installed signed Project views can still be selected here.</p>}
  <p>Project: <strong>{projectId}</strong>. Package installation requires the personal runtime owner; Project enablement requires a Project owner or admin.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {!current&&!error&&<p role="status">Loading signed Project views…</p>}
  {current&&<><button disabled={busy} onClick={()=>refresh()}>Refresh Project views</button>{!candidates.length&&!unavailable.length&&<p>No signed Project Perspectives are installed.</p>}{unavailable.length>0&&<ul>{unavailable.map(candidate=><li key={key(candidate)}><strong>{candidate.title}</strong> · <code>{candidate.package_id}@{candidate.package_version}</code><p role="status">Unavailable: {candidate.available.reason??'signed Project view contract mismatch'}. The package remains installed; it has not been enabled for this Project.</p></li>)}</ul>}{candidates.length>0&&<ul>{candidates.map(candidate=><li key={key(candidate)}><strong>{candidate.title}</strong><p>Package <code>{candidate.package_id}@{candidate.package_version}</code> · application <code>{candidate.application_id}</code></p><p>Publisher key fingerprint <code>{candidate.publisher_key_fingerprint}</code></p><p>Signed manifest <code>{candidate.manifest_digest}</code> · view content <code>{candidate.content_digest}</code></p><p>{candidate.enablement?.status==='enabled'&&candidate.enablement.version===candidate.package_version?'Enabled for this Project':'Not enabled for this Project'} · {configured(current.environment,candidate)?'selected in Project configuration':'not selected in Project configuration'} · runtime health unavailable</p>{!(configured(current.environment,candidate)&&candidate.enablement?.status==='enabled'&&candidate.enablement.version===candidate.package_version)&&<button disabled={busy||Boolean(proposal)} onClick={()=>void prepare(candidate)}>{configured(current.environment,candidate)?'Re-enable exact package':'Enable and preview'}</button>}{configured(current.environment,candidate)&&candidate.enablement?.status==='enabled'&&candidate.enablement.version===candidate.package_version&&<button disabled={busy} onClick={()=>void use(candidate)}>Use this view</button>}{candidate.enablement?.status==='enabled'&&candidate.enablement.version===candidate.package_version&&<button disabled={busy} onClick={()=>void disable(candidate)}>Disable exact package</button>}</li>)}</ul>}</>}
  {proposal&&<div className="settings-card"><h3>Review Project activation</h3><p>Project <strong>{projectId}</strong> · <code>{proposal.candidate.package_id}@{proposal.candidate.package_version}</code> · <code>{proposal.candidate.application_id}</code></p><p>Publisher fingerprint <code>{proposal.candidate.publisher_key_fingerprint}</code></p><p>Manifest <code>{proposal.candidate.manifest_digest}</code> · content <code>{proposal.candidate.content_digest}</code></p><p>Environment revision {proposal.environment.revision} → proposed digest <code>{proposal.preview.proposed_definition_digest}</code></p><p>{proposal.preview.activatable?'Preview is activatable. Core runtime health remains unavailable.':`Not activatable: ${proposal.preview.requirements.join(', ')}`}</p><button disabled={busy||!proposal.preview.activatable} onClick={()=>void apply()}>Apply and use this view</button><button disabled={busy} onClick={()=>setProposal(undefined)}>Cancel preview</button></div>}
  <button disabled={busy} onClick={()=>void dialogue()}>Switch my workspace to Dialogue</button>{activated&&<button disabled={busy} onClick={()=>void restore()}>Restore previous Project configuration</button>}
  <p>Switching views changes your preference. Disabling removes package authorization but preserves the saved Project configuration and does not claim to stop a process.</p><Link to={`/project/${encodeURIComponent(projectId)}`}>Open Project workspace</Link>
 </section>
}
