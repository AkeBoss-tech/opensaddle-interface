import React, { useEffect, useRef, useState } from 'react'
import type { PersonalRuntimeAction, PersonalRuntimeStatus } from '../../services/personalRuntime'

void React

export interface PersonalRuntimeAuthority {
  status(): Promise<PersonalRuntimeStatus>
  lifecycle(action: PersonalRuntimeAction, revision: number): Promise<PersonalRuntimeStatus>
  recover?(runId: string, leaseEpoch: number, revision: number): Promise<PersonalRuntimeStatus>
}

export function PersonalRuntimePanel({ authority }: { authority?: PersonalRuntimeAuthority }) {
  const [status, setStatus] = useState<PersonalRuntimeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    setStatus(null)
    setError(null)
    setBusy(false)
    if (!authority) return
    void authority.status()
      .then(value => { if (generation.current === current) setStatus(value) })
      .catch(cause => { if (generation.current === current) setError(cause instanceof Error ? cause.message : String(cause)) })
  }, [authority])

  const recover = async (runId: string, leaseEpoch: number) => {
    if (!authority?.recover || !status) return
    const current = generation.current
    setBusy(true)
    setError(null)
    try {
      const next = await authority.recover(runId, leaseEpoch, status.stateRevision)
      if (generation.current === current) setStatus(next)
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generation.current === current) setBusy(false)
    }
  }

  const act = async (action: PersonalRuntimeAction) => {
    if (!authority || !status) return
    const current = generation.current
    const currentAuthority = authority
    setBusy(true)
    setError(null)
    try {
      const next = await currentAuthority.lifecycle(action, status.stateRevision)
      if (generation.current === current) setStatus(next)
    } catch (cause) {
      if (generation.current !== current) return
      setError(cause instanceof Error ? cause.message : String(cause))
      try {
        const next = await currentAuthority.status()
        if (generation.current === current) setStatus(next)
      } catch { /* Keep the last known status and the mutation error. */ }
    } finally {
      if (generation.current === current) setBusy(false)
    }
  }

  if (!authority) return <section className="settings-card"><h2>Personal runtime</h2><p role="status">This server does not advertise the durable personal runtime.</p></section>
  if (!status) return <section className="settings-card"><h2>Personal runtime</h2><p role={error ? 'alert' : 'status'}>{error ?? 'Loading personal runtime…'}</p></section>

  const workerCleanupRequired = status.lifecycle === 'intervention_required' &&
    status.unresolvedAssignments.length === 0 &&
    status.workers.some(worker => worker.state === 'intervention_required')

  return <section className="settings-card">
    <h2>Personal runtime</h2>
    <dl>
      <dt>Service</dt><dd>{status.lifecycle}</dd>
      <dt>Project</dt><dd><code>{status.project.projectId}</code></dd>
      <dt>Knowledge</dt><dd>{status.knowledge.available ? 'Available' : status.knowledge.reason ?? 'Unavailable'}</dd>
      <dt>Recovery</dt><dd>{status.unresolvedAssignments.length
        ? status.unresolvedAssignments.map(row => `${row.runId} lease ${row.leaseEpoch}; resolve interrupted execution before starting new work`).join(', ')
        : workerCleanupRequired
          ? 'The prior worker process may still be running. Core has not confirmed cleanup; new work is blocked.'
          : 'No unresolved Runs'}</dd>
      <dt>Workers</dt><dd>{status.workers.length
        ? status.workers.map(worker => `${worker.adapterId}: ${worker.state}${worker.state === 'intervention_required' && worker.readiness.reason ? ` (${worker.readiness.reason})` : ''}`).join(', ')
        : 'None commissioned'}</dd>
      <dt>Updated</dt><dd><time dateTime={status.updatedAt}>{status.updatedAt}</time></dd>
    </dl>
    {status.unresolvedAssignments.map(row => <button key={`${row.runId}:${row.leaseEpoch}`} className="btn btn--secondary" disabled={busy || !authority.recover} onClick={() => void recover(row.runId, row.leaseEpoch)}>Resolve interrupted Run {row.runId}</button>)}
    {workerCleanupRequired && <p>Review the prior worker on this Mac. Once it has stopped, ask Core to verify the original process group and active Run assignments before starting again.</p>}
    <p>The server reports this runtime is owned by the local installation, independently of this window.</p>
    {error && <p role="alert">{error}</p>}
    <div className="setting-actions">
      {workerCleanupRequired && <button className="btn btn--primary" disabled={busy} onClick={() => void act('start')}>Verify cleanup and start</button>}
      <button className="btn btn--primary" disabled={busy || status.lifecycle === 'running' || status.lifecycle === 'intervention_required' || status.unresolvedAssignments.length > 0} onClick={() => void act('start')}>Start</button>
      <button className="btn btn--secondary" disabled={busy || status.lifecycle !== 'running'} onClick={() => void act('drain')}>Drain</button>
      <button className="btn btn--secondary" disabled={busy || status.lifecycle === 'stopped' || workerCleanupRequired} onClick={() => void act('stop')}>Stop worker</button>
    </div>
  </section>
}
