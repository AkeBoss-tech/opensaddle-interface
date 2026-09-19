import {RunApprovalPanel} from './RunApprovalPanel'
import type {RunApprovalReviewClient} from '../../services/runApprovalReview'
import {TaskResultPanel,type TaskResultAuthority} from './TaskResultPanel'
import React, { useEffect, useRef, useState } from 'react'
void React
import { Link } from 'react-router-dom'
import type { AuthorizedContextHandle, AuthorizedContextPacket } from '../onboarding/ConnectedJourneySurface'
import type { CodingResultAuthority } from '../../services/codingResultReview'
import { CodingResultPanel } from '../onboarding/CodingResultPanel'
import { ConnectorWriteReviewPanel } from './ConnectorWriteReviewPanel'
import type { ConnectorWriteReviewClient } from '../../services/connectorWriteReview'
export type AuthoritativeRunDetail = { runId:string;projectId:string;task:string;executionInstructions?:string;status:string;workerId?:string;updatedAt?:string;cancellationRequested:boolean;canCancel:boolean;codingTask:boolean;authorizedContext?:AuthorizedContextHandle }
export type ConnectorAuditItem = { sequence:number;timestamp:string;state:'requested'|'completed'|'unknown'|'denied';connector?:string;action?:string;requestDigest?:string;responseDigest?:string;outcome?:string }
export type ConnectorAudit = { runId:string;projectId:string;items:ConnectorAuditItem[];complete:boolean;mode?:'page'|'stream';nextAfterSequence?:number;truncated?:boolean;checkedAt?:string;runStatus?:string }
export interface AuthoritativeRunAuthority {
  review?:TaskResultAuthority['review']
  runDetail(runId:string):Promise<AuthoritativeRunDetail>
  cancel?(runId:string):Promise<unknown>
  authorizedContextPacket?(projectId:string,runId:string,handle:AuthorizedContextHandle):Promise<AuthorizedContextPacket>
  connectorAudit?(projectId:string,runId:string,signal?:AbortSignal,afterSequence?:number):Promise<ConnectorAudit>
}
const terminal = (status:string) => ['completed','failed','cancelled','interrupted'].includes(status)
export function AuthoritativeRunSurface({authority,runId,codingResults,projectId,approvalReview,connectorWriteReview}:{approvalReview?:RunApprovalReviewClient;connectorWriteReview?:ConnectorWriteReviewClient;projectId?:string;authority:AuthoritativeRunAuthority;runId:string;codingResults?:CodingResultAuthority}) {
  const [state,setState]=useState<{authority:AuthoritativeRunAuthority;runId:string;projectId?:string;detail?:AuthoritativeRunDetail;error?:string}>()
  const [packet,setPacket]=useState<{authority:AuthoritativeRunAuthority;runId:string;value?:AuthorizedContextPacket;error?:string}>()
  const [connectorAudit,setConnectorAudit]=useState<{authority:AuthoritativeRunAuthority;runId:string;value?:ConnectorAudit;error?:string}>()
  const auditAbort=useRef<AbortController|undefined>(undefined)
  const [busy,setBusy]=useState(false),generation=useRef(0),packetGeneration=useRef(0),operation=useRef<symbol|undefined>(undefined)
  const refresh=async()=>{
    const current=++generation.current
    try{const detail=await authority.runDetail(runId);if(detail.runId!==runId||(projectId!==undefined&&detail.projectId!==projectId))throw Error('Task does not belong to this project.');if(current===generation.current)setState({authority,runId,projectId,detail})}
    catch(reason){if(current===generation.current){packetGeneration.current++;auditAbort.current?.abort();setConnectorAudit(undefined);setPacket(undefined);setState({authority,runId,projectId,error:reason instanceof Error?reason.message:String(reason)})}}
  }
  useEffect(()=>{operation.current=undefined;setBusy(false);setPacket(undefined);setConnectorAudit(undefined);setState({authority,runId,projectId});void refresh();const timer=setInterval(()=>{if(!operation.current)void refresh()},2500);return()=>{generation.current++;packetGeneration.current++;auditAbort.current?.abort();auditAbort.current=undefined;operation.current=undefined;clearInterval(timer)}},[authority,runId,projectId])
  const owned=state?.authority===authority&&state.runId===runId&&state.projectId===projectId?state:undefined,detail=owned?.detail,currentPacket=packet?.authority===authority&&packet.runId===runId?packet:undefined
  const cancel=async()=>{
    if(!detail||!authority.cancel||operation.current)return
    const token=Symbol();operation.current=token;setBusy(true);const current=generation.current
    try{await authority.cancel(runId);if(current===generation.current)await refresh()}
    catch(reason){if(current===generation.current)setState({authority,runId,projectId,error:reason instanceof Error?reason.message:String(reason)})}
    finally{if(operation.current===token){operation.current=undefined;setBusy(false)}}
  }
  const inspect=async()=>{
    if(!detail?.authorizedContext||!authority.authorizedContextPacket)return
    const current=++packetGeneration.current;setPacket({authority,runId})
    try{const value=await authority.authorizedContextPacket(detail.projectId,runId,detail.authorizedContext);if(current===packetGeneration.current)setPacket({authority,runId,value})}
    catch(reason){if(current===packetGeneration.current)setPacket({authority,runId,error:reason instanceof Error?reason.message:String(reason)})}
  }
  const inspectConnectorAudit=async(append=false)=>{
    if(!detail||!authority.connectorAudit)return
    const previous=append&&connectorAudit?.authority===authority&&connectorAudit.runId===runId?connectorAudit.value:undefined
    const cursor=previous?.mode==='page'&&previous.nextAfterSequence!==undefined?previous.nextAfterSequence:-1
    auditAbort.current?.abort();const controller=new AbortController();auditAbort.current=controller
    setConnectorAudit({authority,runId})
    try{const value=await authority.connectorAudit(detail.projectId,runId,controller.signal,cursor);if(!controller.signal.aborted&&auditAbort.current===controller&&value.runId===runId&&value.projectId===detail.projectId){
      const merged=previous&&value.mode==='page'&&value.nextAfterSequence!==undefined&&value.nextAfterSequence>=cursor
        ? {...value,items:[...previous.items,...value.items]}:value
      setConnectorAudit({authority,runId,value:merged})
    }}
    catch(reason){if(!controller.signal.aborted&&auditAbort.current===controller)setConnectorAudit({authority,runId,error:reason instanceof Error?reason.message:String(reason)})}
  }
  const currentAudit=connectorAudit?.authority===authority&&connectorAudit.runId===runId?connectorAudit:undefined
  return <main className="content-page cc-page task-detail-page"><header className="page-header"><div><span className="eyebrow">Task</span><h1>{detail?.task??'Task status'}</h1></div><button className="secondary-btn" disabled={busy} onClick={()=>{packetGeneration.current++;setPacket(undefined);void refresh()}}>Refresh task status</button></header>
    {projectId&&<Link to={`/project/${encodeURIComponent(projectId)}`}>Back to workspace</Link>}
    {owned?.error?<p role="alert">Task unavailable: {owned.error}</p>:!detail?<p role="status">Loading the authoritative Run…</p>:<>
      <section className="cc-panel"><h2>Execution</h2><p role="status">{detail.status}</p><p>{detail.workerId?`Assigned worker: ${detail.workerId}`:'No worker assignment reported.'}</p>{detail.updatedAt&&<p>Updated {detail.updatedAt}</p>}
        {detail.status==='cancelled'?<p>Cancellation acknowledged · Core marks this Run cancelled. Previously dispatched effects may still have occurred.</p>:detail.cancellationRequested?<p>Cancellation requested · {terminal(detail.status)?'execution ended without a cancellation acknowledgment.':'waiting for the worker to acknowledge a stop.'}</p>:detail.canCancel&&authority.cancel&&!terminal(detail.status)?<button className="secondary-btn" disabled={busy} onClick={()=>void cancel()}>Request cancellation</button>:null}
        <Link to={`/project/${encodeURIComponent(detail.projectId)}/collaboration`}>Project tasks and knowledge</Link>
        {detail.executionInstructions&&<details><summary>Execution instructions</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'20rem',overflow:'auto'}}>{detail.executionInstructions}</pre></details>}
        <details><summary>Exact Run</summary><p>{detail.runId}</p><p>{detail.projectId}</p></details>
      </section>
      {detail.status==='awaiting_approval'&&!approvalReview&&<p role="status">Task approval review is unavailable on this connection.</p>}
      {detail.status==='awaiting_approval'&&approvalReview&&<RunApprovalPanel client={approvalReview} projectId={detail.projectId} runId={detail.runId} onApproved={()=>void refresh()}/>}
      {connectorWriteReview&&<ConnectorWriteReviewPanel client={connectorWriteReview} projectId={detail.projectId} runId={detail.runId}/>}
      {detail.authorizedContext&&authority.authorizedContextPacket&&<section className="cc-panel"><button className="secondary-btn" onClick={()=>void inspect()}>Inspect launch context</button>{currentPacket?.value?<><h2>Context used at launch</h2><p>Reauthorized {currentPacket.value.reauthorizedAt}</p><p><code>{currentPacket.value.packetDigest}</code></p>{currentPacket.value.citations.map((citation,index)=><article key={index}><p>{citation.content}</p><small>{citation.resourceId} · {citation.version} · {citation.locator}</small></article>)}</>:currentPacket?.error?<p role="alert">Launch context unavailable: {currentPacket.error}</p>:currentPacket?<p role="status">Checking current source authorization…</p>:null}</section>}
      {authority.connectorAudit&&<section className="cc-panel" aria-label="Connector activity"><h2>Connector activity</h2><p>Core audit events for this exact Run. Arguments, response bodies, credentials, and account identities are omitted.</p><button className="secondary-btn" onClick={()=>void inspectConnectorAudit()}>Inspect connector activity</button>{currentAudit?.error?<p role="alert">Connector activity unavailable: {currentAudit.error}</p>:currentAudit?.value?<><p role="status">{currentAudit.value.mode==='page'?`Checked ${currentAudit.value.checkedAt}. ${currentAudit.value.truncated?'More stored events are available.':currentAudit.value.complete?'All recorded events for this ended Run were read.':currentAudit.value.runStatus&&terminal(currentAudit.value.runStatus)?'Run ended after this page was read; check for final events.':'No more stored events at this check; an active Run may add events.'}`:currentAudit.value.complete?'Audit stream ended with this Run.':'Bounded audit snapshot from the beginning of this Run; later events may be omitted.'}</p>{currentAudit.value.items.length?<ol>{currentAudit.value.items.map(item=><li key={item.sequence}><strong>{item.state}</strong> · {item.connector??'connector'}{item.action?`/${item.action}`:''} · event {item.sequence} · {item.timestamp}{item.outcome?` · ${item.outcome}`:''}{item.requestDigest&&<small> {item.state==='requested'?'Invocation':'Receipt request'} SHA-256 <code>{item.requestDigest}</code></small>}{item.responseDigest&&<small> Response SHA-256 <code>{item.responseDigest}</code></small>}</li>)}</ol>:<p>{currentAudit.value.complete?'No connector events in this Run.':'No connector events in this snapshot.'}</p>}{currentAudit.value.mode==='page'&&<button className="secondary-btn" onClick={()=>void inspectConnectorAudit(true)}>{currentAudit.value.truncated?'Load more stored events':'Check for new events'}</button>}</>:currentAudit?<p role="status">Reading authorized connector events…</p>:null}</section>}
      {terminal(detail.status)?detail.codingTask?codingResults?<CodingResultPanel authority={codingResults} projectId={detail.projectId} runId={detail.runId}/>:<p>Coding result inspection is unavailable from this connection.</p>:<>{['completed','failed'].includes(detail.status)&&authority.review&&<TaskResultPanel authority={authority as AuthoritativeRunAuthority & TaskResultAuthority} projectId={detail.projectId} runId={detail.runId}/>}{['cancelled','interrupted'].includes(detail.status)&&<p role="status">This task was cancelled or interrupted. Inspect any recorded artifacts below.</p>}<section className="cc-panel"><p>Execution ended; this does not imply verification or human acceptance.</p><Link to={`/review?${new URLSearchParams({run:detail.runId,project:detail.projectId})}`}>Inspect result artifacts</Link></section></>:<p>The task is still active. Result verification and human review appear after execution ends.</p>}
    </>}
  </main>
}
