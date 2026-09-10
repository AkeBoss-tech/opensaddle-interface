import {RunApprovalPanel} from './RunApprovalPanel'
import type {RunApprovalReviewClient} from '../../services/runApprovalReview'
import {TaskResultPanel,type TaskResultAuthority} from './TaskResultPanel'
import React, { useEffect, useRef, useState } from 'react'
void React
import { Link } from 'react-router-dom'
import type { AuthorizedContextHandle, AuthorizedContextPacket } from '../onboarding/ConnectedJourneySurface'
import type { CodingResultAuthority } from '../../services/codingResultReview'
import { CodingResultPanel } from '../onboarding/CodingResultPanel'
export type AuthoritativeRunDetail = { runId:string;projectId:string;task:string;status:string;workerId?:string;updatedAt?:string;cancellationRequested:boolean;canCancel:boolean;codingTask:boolean;authorizedContext?:AuthorizedContextHandle }
export interface AuthoritativeRunAuthority {
  review?:TaskResultAuthority['review']
  runDetail(runId:string):Promise<AuthoritativeRunDetail>
  cancel?(runId:string):Promise<unknown>
  authorizedContextPacket?(projectId:string,runId:string,handle:AuthorizedContextHandle):Promise<AuthorizedContextPacket>
}
const terminal = (status:string) => ['completed','failed','cancelled','interrupted'].includes(status)
export function AuthoritativeRunSurface({authority,runId,codingResults,projectId,approvalReview}:{approvalReview?:RunApprovalReviewClient;projectId?:string;authority:AuthoritativeRunAuthority;runId:string;codingResults?:CodingResultAuthority}) {
  const [state,setState]=useState<{authority:AuthoritativeRunAuthority;runId:string;projectId?:string;detail?:AuthoritativeRunDetail;error?:string}>()
  const [packet,setPacket]=useState<{authority:AuthoritativeRunAuthority;runId:string;value?:AuthorizedContextPacket;error?:string}>()
  const [busy,setBusy]=useState(false),generation=useRef(0),packetGeneration=useRef(0),operation=useRef<symbol|undefined>(undefined),finished=useRef(false)
  const refresh=async()=>{
    const current=++generation.current
    try{const detail=await authority.runDetail(runId);if(detail.runId!==runId||(projectId!==undefined&&detail.projectId!==projectId))throw Error('Task does not belong to this project.');if(current===generation.current){finished.current=terminal(detail.status);setState({authority,runId,projectId,detail})}}
    catch(reason){if(current===generation.current){packetGeneration.current++;setPacket(undefined);setState({authority,runId,projectId,error:reason instanceof Error?reason.message:String(reason)})}}
  }
  useEffect(()=>{finished.current=false;operation.current=undefined;setBusy(false);setPacket(undefined);setState({authority,runId,projectId});void refresh();const timer=setInterval(()=>{if(!finished.current&&!operation.current)void refresh()},2500);return()=>{generation.current++;packetGeneration.current++;operation.current=undefined;clearInterval(timer)}},[authority,runId,projectId])
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
  return <main className="content-page cc-page"><header className="page-header"><h1>{detail?.task??'Task status'}</h1><button disabled={busy} onClick={()=>{packetGeneration.current++;setPacket(undefined);void refresh()}}>Refresh task status</button></header>
    {projectId&&<Link to={`/project/${encodeURIComponent(projectId)}`}>Back to workspace</Link>}
    {owned?.error?<p role="alert">Task unavailable: {owned.error}</p>:!detail?<p role="status">Loading the authoritative Run…</p>:<>
      <section className="cc-panel"><h2>Execution</h2><p role="status">{detail.status}</p><p>{detail.workerId?`Assigned worker: ${detail.workerId}`:'No worker assignment reported.'}</p>{detail.updatedAt&&<p>Updated {detail.updatedAt}</p>}
        {detail.status==='cancelled'?<p>Cancellation acknowledged · the Run is stopped.</p>:detail.cancellationRequested?<p>Cancellation requested · {terminal(detail.status)?'execution ended without a cancellation acknowledgment.':'waiting for the worker to acknowledge a stop.'}</p>:detail.canCancel&&authority.cancel&&!terminal(detail.status)?<button disabled={busy} onClick={()=>void cancel()}>Request cancellation</button>:null}
        <Link to={`/project/${encodeURIComponent(detail.projectId)}/collaboration`}>Project tasks and knowledge</Link>
        <details><summary>Exact Run</summary><p>{detail.runId}</p><p>{detail.projectId}</p></details>
      </section>
      {detail.status==='awaiting_approval'&&!approvalReview&&<p role="status">Task approval review is unavailable on this connection.</p>}
      {detail.status==='awaiting_approval'&&approvalReview&&<RunApprovalPanel client={approvalReview} projectId={detail.projectId} runId={detail.runId} onApproved={()=>void refresh()}/>}
      {detail.authorizedContext&&authority.authorizedContextPacket&&<section className="cc-panel"><button onClick={()=>void inspect()}>Inspect launch context</button>{currentPacket?.value?<><h2>Context used at launch</h2><p>Reauthorized {currentPacket.value.reauthorizedAt}</p><p><code>{currentPacket.value.packetDigest}</code></p>{currentPacket.value.citations.map((citation,index)=><article key={index}><p>{citation.content}</p><small>{citation.resourceId} · {citation.version} · {citation.locator}</small></article>)}</>:currentPacket?.error?<p role="alert">Launch context unavailable: {currentPacket.error}</p>:currentPacket?<p role="status">Checking current source authorization…</p>:null}</section>}
      {terminal(detail.status)?detail.codingTask?codingResults?<CodingResultPanel authority={codingResults} projectId={detail.projectId} runId={detail.runId}/>:<p>Coding result inspection is unavailable from this connection.</p>:<>{authority.review&&<TaskResultPanel authority={authority as AuthoritativeRunAuthority & TaskResultAuthority} projectId={detail.projectId} runId={detail.runId}/>}<section className="cc-panel"><p>Execution ended; this does not imply verification or human acceptance.</p><Link to={`/review?${new URLSearchParams({run:detail.runId,project:detail.projectId})}`}>Inspect result artifacts</Link></section></>:<p>The task is still active. Result verification and human review appear after execution ends.</p>}
    </>}
  </main>
}
