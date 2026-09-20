import React,{useEffect,useRef,useState} from 'react'
import {SafeMarkdown} from '../../ui/SafeMarkdown'
import type {AgentResult,AgentResultDecision,AgentResultReviewClient} from '../../services/agentResultReview'
void React

function readableJson(text:string):string|null {
  try {
    const value:unknown=JSON.parse(text)
    return value!==null&&typeof value==='object'?JSON.stringify(value,null,2):null
  } catch { return null }
}

/** Human judgment of exact published bytes, separate from execution and automated verification. */
export function AgentResultReviewPanel({client,projectId,runId}:{client:AgentResultReviewClient;projectId:string;runId:string}){
  const [state,setState]=useState<{client:AgentResultReviewClient;projectId:string;runId:string;result?:AgentResult;error?:string}>()
  const [busy,setBusy]=useState(false),[retryReady,setRetryReady]=useState(false),[revisionOpen,setRevisionOpen]=useState(false)
  const generation=useRef(0),operation=useRef<symbol|undefined>(undefined)
  const pending=useRef<{decision:AgentResultDecision;intent:string;artifactId:string;digest:string;revision:number}|undefined>(undefined)
  const refresh=async(background=false)=>{
    const current=++generation.current
    if(!background){setState({client,projectId,runId});setRetryReady(false)}
    try{
      const result=await client.read(projectId,runId)
      if(current!==generation.current)return
      const previous=pending.current
      if(previous){
        if(result.artifactId!==previous.artifactId||result.artifactDigest!==previous.digest||result.reviewRevision!==previous.revision){pending.current=undefined;setRevisionOpen(false)}
        else setRetryReady(true)
      }
      setState({client,projectId,runId,result})
    }catch(reason){if(current===generation.current)setState({client,projectId,runId,error:reason instanceof Error?reason.message:String(reason)})}
  }
  useEffect(()=>{
    const generationRef=generation,operationRef=operation,pendingRef=pending
    pending.current=undefined;operation.current=undefined;setBusy(false);setRevisionOpen(false);setState(undefined);void refresh()
    const timer=setInterval(()=>{if(!operation.current)void refresh(true)},5000)
    return()=>{generationRef.current++;operationRef.current=undefined;pendingRef.current=undefined;clearInterval(timer)}
  },[client,projectId,runId]) // eslint-disable-line react-hooks/exhaustive-deps
  const owned=state?.client===client&&state.projectId===projectId&&state.runId===runId?state:undefined,result=owned?.result
  const json=result?readableJson(result.text):null
  const decide=async(decision:AgentResultDecision,retry=false)=>{
    if(!result||!result.canReview||operation.current)return
    let request=pending.current
    if(retry){if(!retryReady||!request||request.decision!==decision||request.artifactId!==result.artifactId||request.digest!==result.artifactDigest||request.revision!==result.reviewRevision)return}
    else{request={decision,intent:crypto.randomUUID(),artifactId:result.artifactId,digest:result.artifactDigest,revision:result.reviewRevision};pending.current=request}
    const token=Symbol();operation.current=token;setBusy(true);setRetryReady(false)
    const current=generation.current
    try{await client.decide(result,decision,request.intent);if(current===generation.current){setRevisionOpen(false);await refresh()}}
    catch(reason){if(current===generation.current){setState({client,projectId,runId,error:`Decision outcome is not confirmed: ${reason instanceof Error?reason.message:String(reason)}. Check the persisted decision before retrying.`})}}
    finally{if(operation.current===token){operation.current=undefined;setBusy(false)}}
  }
  return <section className="cc-panel task-result-panel" aria-label="Agent result human review">
    <h2>Agent result</h2>
    <p>Review whether this result meets your needs. The Run completed; your decision is recorded separately.</p>
    <button className="secondary-btn" disabled={busy} onClick={()=>void refresh()}>Check exact result and decision</button>
    {owned?.error?<p role="alert">{owned.error}</p>:!result?<p role="status">Checking current access and exact published bytes…</p>:<>
      <div className="task-result-reading">{json===null?<SafeMarkdown text={result.text}/>:<pre className="task-result-json">{json}</pre>}</div>
      <details><summary>Original text</summary><pre className="task-result-source">{result.text}</pre></details>
      <details><summary>Exact artifact</summary><p>{result.artifactId}</p><code>{result.artifactDigest}</code><p>Review revision {result.reviewRevision}</p></details>
      <p>Human decision: {result.review&&result.review.isCurrent?`${result.review.decision} by ${result.review.reviewedBy} at ${result.review.reviewedAt}`:'Not decided'}</p>
      {result.review?.note&&<p>Review note: {result.review.note}</p>}
      {!result.canReview&&<p>This account can inspect the result but cannot record a decision.</p>}
      {result.canReview&&result.review&&!revisionOpen&&!pending.current&&<button className="secondary-btn" disabled={busy} onClick={()=>setRevisionOpen(true)}>Revise decision</button>}
      {result.canReview&&(revisionOpen||!result.review)&&!pending.current&&<><p>{result.review?'A new decision will replace the current one at this review revision.':'Your decision applies only to this exact published result.'} Request changes records a rejection; it does not send instructions to the agent.</p><div className="page-actions"><button disabled={busy} onClick={()=>void decide('accepted')}>Accept result</button><button disabled={busy} onClick={()=>void decide('rejected')}>Request changes</button>{revisionOpen&&<button className="secondary-btn" disabled={busy} onClick={()=>setRevisionOpen(false)}>Keep current decision</button>}</div></>}
      {result.canReview&&pending.current&&retryReady&&<button className="secondary-btn" disabled={busy} onClick={()=>void decide(pending.current!.decision,true)}>Retry the same decision request</button>}
    </>}
  </section>
}
