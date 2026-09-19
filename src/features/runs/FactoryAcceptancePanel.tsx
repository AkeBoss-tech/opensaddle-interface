import React, { useEffect, useRef, useState } from 'react'
import type { FactoryAcceptance, FactoryCodingClient, FactoryRunBinding } from '../../services/factoryCoding'
import type { CodingResult, CodingResultAuthority } from '../../services/codingResultReview'
void React

export function FactoryAcceptancePanel({client,codingResults,projectId,runId}:{client:FactoryCodingClient;codingResults:CodingResultAuthority;projectId:string;runId:string}) {
  const generation = useRef(0), operation = useRef(false)
  const [state,setState] = useState<{binding:FactoryRunBinding|null;result?:CodingResult;acceptance?:FactoryAcceptance|null}|null>(null)
  const [reviewed,setReviewed] = useState<string[]>([]), [error,setError] = useState(''), [busy,setBusy] = useState(false)
  const refresh = async () => {
    const current=++generation.current
    setState(null);setReviewed([]);setError('')
    try {
      const binding=await client.runBinding(projectId,runId)
      if (!binding) { if(generation.current===current)setState({binding:null});return }
      const [acceptance,result]=await Promise.all([client.acceptance(projectId,runId),codingResults.read(projectId,runId)])
      if(acceptance&&(acceptance.compileDigest!==binding.compileDigest||acceptance.artifactId!==result.artifactId||acceptance.artifactDigest!==result.artifactDigest))throw Error('Factory acceptance no longer matches the exact coding evidence')
      if(generation.current===current)setState({binding,acceptance,result})
    } catch(reason) { if(generation.current===current)setError(reason instanceof Error?reason.message:String(reason)) }
  }
  useEffect(()=>{void refresh();return()=>{generation.current++}},[client,codingResults,projectId,runId]) // eslint-disable-line react-hooks/exhaustive-deps
  const accept=async()=>{
    if(operation.current||!state?.binding||!state.result)return
    operation.current=true;setBusy(true);setError('')
    const current=generation.current
    try { const accepted=await client.accept(projectId,runId,state.binding.compileDigest,state.result,state.binding.criteria);if(generation.current===current)setState(previous=>previous?{...previous,acceptance:accepted}:previous) }
    catch(reason){if(generation.current===current)setError(reason instanceof Error?reason.message:String(reason))}
    finally{operation.current=false;setBusy(false)}
  }
  if(state?.binding===null)return null
  return <section className="cc-panel" aria-label="Factory acceptance"><h2>Factory acceptance</h2><button disabled={busy} onClick={()=>void refresh()}>Refresh exact Factory evidence</button>
    {error&&<p role="alert">{error}</p>}
    {!state?<p role="status">Checking Factory lineage and current evidence…</p>:<>
      <p>Factory {state.binding?.factoryId}@{state.binding?.factoryVersion} · Goal {state.binding?.goalId}</p>
      <p>Compile digest <code>{state.binding?.compileDigest}</code></p>
      {state.acceptance?.state==='applied'?<p role="status">Factory acceptance applied · receipt <code>{state.acceptance.receiptDigest}</code>. Goal completion records evidence verified at Run time; it does not attest the current workspace.</p>:state.acceptance?.state==='pending'?<>
        <p role="status">Factory acceptance is pending · receipt <code>{state.acceptance.receiptDigest}</code>. Core has not confirmed Goal completion. Retry only this exact reviewed evidence.</p>
        <button className="primary-btn" disabled={busy||state.result?.review?.decision!=='accepted'||state.result.checksStatus!=='passed'||state.result.executionStatus!=='completed'||Boolean(state.result.limitations.length)} onClick={()=>void accept()}>Retry exact Factory acceptance</button>
      </>:<>
        <p>Review the exact coding result above first. Accepting a Factory Goal is a separate human decision on every fixed criterion.</p>
        {state.result?.review?.decision==='accepted'&&state.result.checksStatus==='passed'&&state.result.executionStatus==='completed'&&!state.result.limitations.length?<>
          <p>Evidence artifact <code>{state.result.artifactId}</code> · digest <code>{state.result.artifactDigest}</code></p>
          <fieldset><legend>Confirm each criterion against that artifact</legend>{state.binding?.criteria.map(item=><label key={item.criterionId}><input type="checkbox" disabled={busy} checked={reviewed.includes(item.criterionId)} onChange={event=>setReviewed(current=>event.target.checked?[...current,item.criterionId]:current.filter(id=>id!==item.criterionId))}/>{item.criterion}</label>)}</fieldset>
          <button className="primary-btn" disabled={busy||reviewed.length!==state.binding?.criteria.length} onClick={()=>void accept()}>Accept exact Factory criteria and complete Goal</button>
        </>:<p role="status">The exact coding artifact must have a current accepted human review and passing checks before criterion acceptance.</p>}
      </>}
    </>}
  </section>
}
