import React, { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../../data/store'
import type { CodingResult, CodingResultAuthority } from '../../services/codingResultReview'
import type { FactoryRunBinding } from '../../services/factoryCoding'
import type { FactoryExecution, FactoryExecutionClient } from '../../services/factoryExecution'
void React

export function FactoryExecutionPage() {
  const { projectId = '', executionId = '' } = useParams()
  const { services, data } = useStore()
  return <FactoryExecutionSurface key={`${data.currentUserId}:${projectId}:${executionId}`} projectId={projectId} executionId={executionId}
    client={services?.factoryExecution} codingResults={services?.codingResults}/>
}

export function FactoryExecutionSurface({projectId,executionId,client,codingResults}:{
  projectId:string;executionId:string;client?:FactoryExecutionClient;codingResults?:CodingResultAuthority
}) {
  const generation = useRef(0), operation = useRef(false)
  const [cursor,setCursor] = useState<FactoryExecution>(), [result,setResult] = useState<CodingResult>()
  const [binding,setBinding] = useState<FactoryRunBinding>(), [checked,setChecked] = useState<string[]>([])
  const [error,setError] = useState(''), [evidenceError,setEvidenceError] = useState(''), [busy,setBusy] = useState(false)
  const refresh = async () => {
    if (!client) return
    const at = ++generation.current
    setCursor(undefined);setResult(undefined);setBinding(undefined);setChecked([]);setError('');setEvidenceError('')
    try {
      const value = await client.read(projectId,executionId)
      if (generation.current !== at) return
      setCursor(value)
      const activeRunId = value.state === 'awaiting_a' ? value.aRunId : value.bRunId
      if (!activeRunId || !codingResults) return
      try {
        const [evidence,runBinding] = await Promise.all([codingResults.read(projectId,activeRunId),
          value.state === 'awaiting_b' ? client.binding(value) : Promise.resolve(null)])
        if (generation.current !== at) return
        if (evidence.projectId !== projectId || evidence.runId !== activeRunId) throw Error('Factory result identity changed')
        if (value.state === 'awaiting_b') {
          if (!runBinding || runBinding.factoryId !== value.factoryId || runBinding.factoryVersion !== value.factoryVersion || runBinding.compileDigest !== value.compileDigest) throw Error('Factory criteria do not match this execution')
          setBinding(runBinding)
        }
        setResult(evidence)
      } catch (reason) { if (generation.current === at) setEvidenceError(reason instanceof Error ? reason.message : String(reason)) }
    } catch (reason) { if (generation.current === at) setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  useEffect(()=>{void refresh();return()=>{generation.current++}},[client,codingResults,projectId,executionId]) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (action: 'advance' | 'accept') => {
    if (!client || !cursor || !result || operation.current) return
    operation.current = true;setBusy(true);setError('')
    const at = generation.current
    try {
      if (action === 'advance') await client.advance(cursor,result)
      else {
        if (!binding || checked.length !== binding.criteria.length) throw Error('Review each fixed criterion before final acceptance')
        await client.accept(cursor,result,binding.criteria)
      }
      if (generation.current === at) await refresh()
    } catch(reason) { if (generation.current === at) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { operation.current = false;setBusy(false) }
  }
  if (!client) return <main className="content-page cc-page"><h1>Factory execution unavailable</h1><p>The connected runtime does not support two-step workflows.</p></main>
  const accepted = result?.review?.decision === 'accepted' && Boolean(result.review.reviewId) && result.executionStatus === 'completed' && result.checksStatus === 'passed' && !result.limitations.length && Boolean(result.patch)
  const originalRequester = cursor?.requestedBy === client.identity()
  return <main className="content-page cc-page"><header className="page-header"><div><span className="eyebrow">Factory execution</span><h1>Two reviewed coding steps</h1><p>Each step has its own Core Run and exact human result review.</p></div></header>
    <Link to={`/project/${encodeURIComponent(projectId)}/factory`}>Back to Factory</Link>
    <section className="cc-panel" aria-label="Factory execution"><button disabled={busy} onClick={()=>void refresh()}>Refresh execution and evidence</button>
      {error && <p role="alert">{error}</p>}
      {!cursor ? !error && <p role="status">Loading the authoritative Factory execution…</p> : <>
        <p role="status">{cursor.state === 'awaiting_a' ? 'Step A — waiting for completion, review, and explicit advance' : cursor.state === 'awaiting_b' ? 'Step B — waiting for completion, review, and final acceptance' : 'Factory Goal completed'}</p>
        <p>Factory {cursor.factoryId}@{cursor.factoryVersion} · execution <code>{cursor.executionId}</code></p>
        <p>Compile digest <code>{cursor.compileDigest}</code></p>
        <ol><li>Step A · <Link to={`/project/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(cursor.aRunId)}`}>Inspect Run {cursor.aRunId}</Link></li>
          <li>Step B · {cursor.bRunId ? <Link to={`/project/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(cursor.bRunId)}`}>Inspect Run {cursor.bRunId}</Link> : 'Not admitted; requires explicit advance'}</li></ol>
        {cursor.state !== 'completed' && <>
          {evidenceError ? <p role="status">Current step evidence is unavailable: {evidenceError} Inspect the Run, then refresh.</p> : !result ? <p role="status">Checking current step artifact and human review…</p> : <>
            <p>Current evidence: <code>{result.artifactId}</code> · <code>{result.artifactDigest}</code></p>
            <p>Worker checks: {result.checksStatus}. Human review: {result.review?.decision ?? 'pending'}.</p>
          </>}
          {cursor.state === 'awaiting_a' && <><p>Review and accept the exact step A coding result on its Run page. Advancing admits step B as a separate action.</p>
            {accepted && <button className="primary-btn" disabled={busy || !originalRequester} onClick={()=>void act('advance')}>Advance this exact result to step B</button>}
            {!originalRequester && <p>Only the original requester can advance this execution.</p>}</>}
          {cursor.state === 'awaiting_b' && accepted && binding && <><p>Final Goal acceptance is a separate decision after reviewing step B and its fixed criteria.</p>
            <fieldset><legend>Confirm every criterion against step B evidence</legend>{binding.criteria.map(item=><label key={item.criterionId}><input type="checkbox" disabled={busy} checked={checked.includes(item.criterionId)} onChange={event=>setChecked(current=>event.target.checked?[...current,item.criterionId]:current.filter(id=>id!==item.criterionId))}/>{item.criterion}</label>)}</fieldset>
            <button className="primary-btn" disabled={busy || checked.length !== binding.criteria.length} onClick={()=>void act('accept')}>Accept exact step B criteria and complete Goal</button></>}
        </>}
      </>}
    </section>
  </main>
}
