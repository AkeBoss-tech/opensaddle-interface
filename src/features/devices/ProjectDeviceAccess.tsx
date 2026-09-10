import { ConsentDeadline } from './ConsentDeadline'
import React, { useEffect, useRef, useState } from 'react'
import { PersonalDevicesClient, type DeviceAssignment } from '../../services/personalDevices'

export function ProjectDeviceAccess({authority,projectId}:{authority:PersonalDevicesClient;projectId:string}) {
  const identity=authority.identity()
  const [snapshot,setSnapshot]=useState<{authority:PersonalDevicesClient;identity:string;projectId:string;items:DeviceAssignment[];context:Awaited<ReturnType<PersonalDevicesClient['assignmentContext']>>}>()
  const [error,setError]=useState(''), [busy,setBusy]=useState(false)
  const [review,setReview]=useState<{item:DeviceAssignment;accept:boolean}>()
  const [refresh,setRefresh]=useState(0)
  const generation=useRef(0),locked=useRef(false)
  const current=snapshot?.authority===authority && snapshot.identity===identity && snapshot.projectId===projectId?snapshot:undefined
  useEffect(()=>{
    const version=++generation.current
    locked.current=true;setBusy(true);setSnapshot(undefined);setReview(undefined);setError('')
    Promise.all([authority.projectAssignments(projectId),authority.assignmentContext(projectId)]).then(([items,context])=>{if(generation.current===version)setSnapshot({authority,identity,projectId,items,context})}).catch(()=>{if(generation.current===version)setError('Project device access is unavailable. Refresh to check your connection and membership.')}).finally(()=>{if(generation.current===version){locked.current=false;setBusy(false)}})
    return()=>{generation.current++}
  },[authority,identity,projectId,refresh])
  async function decide() {
    if(!review || !current?.context.canManage || locked.current)return
    const version=generation.current
    locked.current=true;setBusy(true);setError('')
    try {
      await authority.decideAssignment(review.item.device_id,projectId,review.item.revision,review.accept)
      if(generation.current===version){setReview(undefined);setRefresh(value=>value+1)}
    } catch {
      if(generation.current===version){setReview(undefined);setSnapshot(undefined);setError('Decision failed. Refresh before retrying; the owner may have changed the policy or your role may have changed.')}
    } finally {if(generation.current===version){locked.current=false;setBusy(false)}}
  }
  return <React.Fragment><button disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Refresh project devices</button>{error && <p role="alert">{error}</p>}{busy && !current && <p role="status">Loading project devices…</p>}{current && <>
    {!current.context.canManage && <p>Only project owners and admins can accept or remove device access.</p>}
    {!current.items.length && <p>No device owners have proposed access to this project.</p>}
    <ul className="devices-list">{current.items.map(item=><li key={item.device_id}><div><h3>{typeof item.display_name==='string'?item.display_name:item.device_id}</h3><p>Owner: {item.owner_subject}</p><p>Access policy: {item.state}</p><PolicySummary item={item} sources={current.context.sources}/>{current.context.canManage && <div>{item.state==='proposed' && <button disabled={busy} onClick={()=>setReview({item,accept:true})}>Review acceptance</button>}{['proposed','accepted'].includes(item.state) && <button disabled={busy} onClick={()=>setReview({item,accept:false})}>{item.state==='proposed'?'Decline proposal':'Remove project access'}</button>}</div>}</div></li>)}</ul>
    {review && <section className="device-access-review" aria-label="Review device policy"><h2>{review.accept?'Accept device policy':'Remove device access'}</h2><p>Project: {projectId}</p><p>{review.item.owner_subject} · {review.item.device_id} · Revision {review.item.revision}</p><PolicySummary item={review.item} sources={current.context.sources}/><p>{review.accept?'Accept exactly this owner-proposed scope for this project. A configured worker is still required to run tasks.':'Remove this project’s acceptance. The device remains owned by its owner and other project assignments stay unchanged.'}</p><button disabled={busy} onClick={()=>void decide()}>{review.accept?'Accept policy':'Confirm removal'}</button><button disabled={busy} onClick={()=>setReview(undefined)}>Cancel</button></section>}
    <p>Device ownership and pairing stay with the owner. Project acceptance cannot expand the owner’s policy.</p>
  </>}</React.Fragment>
}
function PolicySummary({item,sources}:{item:DeviceAssignment;sources:{id:string;label:string}[]}) {
 return <><ConsentDeadline item={item}/><dl><dt>Who may use it</dt><dd>{item.audience==='owner_only'?`Only the owner (${item.owner_subject})`:item.audience==='project_members'?'All current project members':item.audience==='team_members'?`Current members of team ${item.team_id} who also belong to this project`:item.subjects.join(', ')}</dd><dt>Allowed sources</dt><dd>{item.source_ids.map(id=>sources.find(source=>source.id===id)?.label??id).join(', ')}</dd><dt>Allowed agents</dt><dd>{item.adapter_ids.map(id=>id==='codex-app-server'?'Codex':id==='claude-code-stream-json'?'Claude Code':id).join(', ')}</dd></dl></>
}
