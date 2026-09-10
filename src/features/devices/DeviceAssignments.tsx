import React, { useEffect, useRef, useState } from 'react'
import { PersonalDevicesClient, type AssignmentPolicy, type DeviceAssignment } from '../../services/personalDevices'

type Project = {id:string;name:string}
export function DeviceAssignments({authority,deviceId,paired,projects}:{authority:PersonalDevicesClient;deviceId:string;paired:boolean;projects:Project[]}) {
  const [open,setOpen]=useState(false)
  return authority.assignmentsAvailable ? <div className="device-assignments"><button onClick={()=>setOpen(!open)} aria-expanded={open}>Project access</button>{open && <AssignmentList key={authority.identity()} authority={authority} deviceId={deviceId} paired={paired} projects={projects}/>}</div> : null
}
function AssignmentList({authority,deviceId,paired,projects}:{authority:PersonalDevicesClient;deviceId:string;paired:boolean;projects:Project[]}) {
  const [items,setItems]=useState<DeviceAssignment[]>()
  const [error,setError]=useState('')
  const [selected,setSelected]=useState('')
  const [refresh,setRefresh]=useState(0)
  useEffect(()=>{let active=true;setItems(undefined);setError('');authority.assignments(deviceId).then(value=>{if(active)setItems(value)}).catch(()=>{if(active)setError('Could not load project access. Refresh to try again.')});return()=>{active=false}},[authority,deviceId,refresh])
  const choices=[...projects,...(items??[]).filter(item=>!projects.some(p=>p.id===item.project_id)).map(item=>({id:item.project_id,name:item.project_id}))]
  return <div><h4>Project access</h4><p>Choose a project to propose task access. A project owner or admin must accept each policy change.</p>{error && <p role="alert">{error}</p>}{!items && !error && <p role="status">Loading access…</p>}<button onClick={()=>{setSelected('');setRefresh(value=>value+1)}}>Refresh access</button>
    {items && <React.Fragment><label>Project for this device<select value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Choose a project</option>{choices.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label>{!choices.length && <p>Add a project to configure task access.</p>}{selected && <AssignmentEditor key={selected} authority={authority} deviceId={deviceId} projectId={selected} paired={paired} initial={items.find(item=>item.project_id===selected)} onChanged={value=>setItems(previous=>[...(previous??[]).filter(item=>item.project_id!==value.project_id),value])}/>}</React.Fragment>}
  </div>
}
function AssignmentEditor({authority,deviceId,projectId,paired,initial,onChanged}:{authority:PersonalDevicesClient;deviceId:string;projectId:string;paired:boolean;initial?:DeviceAssignment;onChanged:(value:DeviceAssignment)=>void}) {
  const [current,setCurrent]=useState(initial)
  const [context,setContext]=useState<Awaited<ReturnType<PersonalDevicesClient['assignmentContext']>>>()
  const [audience,setAudience]=useState<AssignmentPolicy['audience']>(initial?.audience??'owner_only')
  const [subjects,setSubjects]=useState(initial?.subjects??[])
  const [sources,setSources]=useState(initial?.source_ids??[])
  const [adapters,setAdapters]=useState(initial?.adapter_ids??[])
  const [busy,setBusy]=useState(false), [error,setError]=useState('')
  const [review,setReview]=useState<'accept'|'revoke'|null>(null)
  const live=useRef(true),locked=useRef(false)
  useEffect(()=>{live.current=true;authority.assignmentContext(projectId).then(value=>{if(live.current)setContext(value)}).catch(()=>{if(live.current)setError('Project details are unavailable. You can still revoke your existing access policy.')});return()=>{live.current=false}},[authority,projectId])
  async function run(operation:()=>Promise<DeviceAssignment>) {
    if(locked.current)return
    locked.current=true;setBusy(true);setError('')
    try {const value=await operation();if(live.current){setCurrent(value);onChanged(value);setReview(null)}}catch{if(live.current)setError('Access change failed. Refresh access before trying again; another person may have changed it.')}
    finally{if(live.current){locked.current=false;setBusy(false)}}
  }
  const toggle=(values:string[],value:string)=>values.includes(value)?values.filter(item=>item!==value):[...values,value]
  const dirty=audience!==(current?.audience??'owner_only') || JSON.stringify([...subjects].sort())!==JSON.stringify([...(current?.subjects??[])].sort()) || JSON.stringify([...sources].sort())!==JSON.stringify([...(current?.source_ids??[])].sort()) || JSON.stringify([...adapters].sort())!==JSON.stringify([...(current?.adapter_ids??[])].sort())
  return <section className="device-assignment-editor"><p role="status">{current ? `Access policy: ${current.state}` : 'No project access configured'}</p>{current?.state==='accepted' && <p>{current.consent_allows_requester?'Your task-use consent is active.':'This policy does not currently authorize your tasks.'} A connected, configured worker is also required.</p>}{error && <p role="alert">{error}</p>}
    {context && <fieldset disabled={busy || !paired}><legend>Owner’s task-use policy</legend><label>Who may use this device?<select value={audience} onChange={event=>{setAudience(event.target.value as AssignmentPolicy['audience']);setSubjects([]);setReview(null)}}><option value="owner_only">Only me</option>{current?.team_id&&<option value="team_members">Members of team {current.team_id}</option>}<option value="selected_members">Selected project members</option><option value="project_members">All current project members</option></select></label>
      {audience==='selected_members' && <fieldset><legend>Allowed people</legend>{context.members.map(member=><label key={member.subject}><input type="checkbox" checked={subjects.includes(member.subject)} onChange={()=>{setSubjects(toggle(subjects,member.subject));setReview(null)}}/>{member.subject}</label>)}</fieldset>}
      <fieldset><legend>Allowed sources</legend>{context.sources.map(source=><label key={source.id}><input type="checkbox" checked={sources.includes(source.id)} onChange={()=>{setSources(toggle(sources,source.id));setReview(null)}}/>{source.label}</label>)}{!context.sources.length && <p>Register a project source before proposing access.</p>}</fieldset>
      <fieldset><legend>Allowed coding agents</legend>{[['codex-app-server','Codex'],['claude-code-stream-json','Claude Code']].map(([id,label])=><label key={id}><input type="checkbox" checked={adapters.includes(id)} onChange={()=>{setAdapters(toggle(adapters,id));setReview(null)}}/>{label}</label>)}</fieldset>
      <button disabled={!sources.length || !adapters.length || (audience==='selected_members'&&!subjects.length)} onClick={()=>void run(()=>authority.proposeAssignment(deviceId,projectId,{expected_revision:current?.revision??0,audience,...(audience==='team_members'?{team_id:current?.team_id}:{}),subjects,source_ids:sources,adapter_ids:adapters}))}>Propose access</button>
    </fieldset>}
    {!paired && <p>Pair this device before proposing access.</p>}
    {current?.state==='proposed' && context?.canManage && !dirty && <button disabled={busy} onClick={()=>setReview('accept')}>Review project acceptance</button>}
    {current && !['revoked','removed'].includes(current.state) && <button disabled={busy} onClick={()=>setReview('revoke')}>Revoke project access</button>}
    {review && current && <div className="device-access-review"><p>{review==='accept'?'Accept the saved owner policy for this project?':'Revoke task-use consent for this project?'} This does not change access for other projects.</p><button disabled={busy} onClick={()=>void run(()=>review==='accept'?authority.decideAssignment(deviceId,projectId,current.revision,true):authority.revokeAssignment(deviceId,projectId,current.revision))}>{review==='accept'?'Accept policy':'Confirm revocation'}</button><button disabled={busy} onClick={()=>setReview(null)}>Cancel</button></div>}
  </section>
}
