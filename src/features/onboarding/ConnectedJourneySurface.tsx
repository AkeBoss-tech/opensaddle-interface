import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
void React

export type JourneySnapshot = {
  projectId: string
  members: Array<{ subject: string; role: string; status: string }>
  workers: Array<{ workerId: string; status: string; runtimeKind: string }>
  invitations?: Array<{ invitationId: string; recipientSubject: string; status: string; revision: number; expiresAt: string }>
  rosterAvailable?: boolean
  canManage?: boolean
  currentSubject?: string
  results?: Array<{ runId: string; title: string; verified: boolean; workerId?: string; status?: string; updatedAt?: string }>
  participantDiscoveryAvailable?: boolean
  participants?: Array<{ participantId: string; title: string; lifecycle: string }>
  sourceDiscoveryAvailable?: boolean
  sources?: Array<{ sourceId: string; label: string }>
  activeRuns?: Array<{ runId: string; task: string; status: string }>
  capacityAvailable?: boolean
  capacity?: ProjectCapacityStatus
  capacityError?: string
}

type CapacityValues = { cpuMillicores: number; memoryMiB: number; concurrency: number }
export type ProjectCapacityStatus = {
  accountingEnforced: boolean
  state: 'unbounded_legacy' | 'configured' | 'overcommitted'
  reason?: string
  admissionState?: 'blocked' | 'available' | 'idle'
  limits?: { cpuMillicores: number; memoryMiB: number; maxConcurrency: number }
  usage?: CapacityValues
  available?: CapacityValues
  revision?: number
  generatedAt?: string
  overcommit?: { reason: string; project: CapacityValues; workers: Array<{ workerId: string } & CapacityValues> }
  workers?: Array<{ workerId: string; snapshotState: 'missing' | 'stale' | 'current'; observedAt?: string; expiresAt?: string; authority?: 'worker_self_reported'; hardwareAttested: false }>
  queuedAdmission?: Array<{ runId: string; state: 'admissible' | 'blocked'; blockers: Array<{ code: string }> }>
  reservationCount?: number
  recentReleaseCount?: number
  pendingPhases: string[]
}

export interface JourneyAuthority {
  snapshot(projectId: string): Promise<JourneySnapshot>
  invite(projectId: string, subject: string): Promise<void>
  enroll(projectId: string, workerId: string): Promise<void>
  acceptInvitation?(projectId: string, id: string, revision: number): Promise<unknown>
  revokeInvitation?(projectId: string, id: string, revision: number): Promise<unknown>
  review?(projectId: string, runId: string): Promise<{ runId: string; status: string; workerId: string; resource: { artifact_id: string; digest: string }; text: string }>
  createProject?(projectId: string): Promise<unknown>
  delegate?(projectId: string, sourceId: string, task: string): Promise<unknown>
  cancel?(runId: string): Promise<unknown>
  configureCapacity?(projectId: string, limits: { cpuMillicores: number; memoryMiB: number; maxConcurrency: number }): Promise<unknown>
}

type State = { authority: JourneyAuthority; projectId: string; value?: JourneySnapshot; error?: string }

export function ConnectedJourneySurface({ authority, projectId }: { authority: JourneyAuthority; projectId: string }) {
  const generation = useRef(0)
  const operation = useRef<symbol | undefined>(undefined)
  const [state, setState] = useState<State>({ authority, projectId })
  const [subject, setSubject] = useState('')
  const [worker, setWorker] = useState('')
  const [result, setResult] = useState<Awaited<ReturnType<NonNullable<JourneyAuthority['review']>>>>()
  const [sourceId, setSourceId] = useState('')
  const [task, setTask] = useState('')
  const [capacityDraft, setCapacityDraft] = useState<{ cpuMillicores?: string; memoryMiB?: string; maxConcurrency?: string }>({})

  const load = async () => {
    const current = ++generation.current
    try {
      const value = await authority.snapshot(projectId)
      if (current === generation.current) setState({ authority, projectId, value })
    } catch (reason) {
      if (current === generation.current) setState({ authority, projectId, error: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  useEffect(() => {
    setResult(undefined)
    setSourceId('')
    setTask('')
    setCapacityDraft({})
    void load()
    return () => { generation.current++; operation.current = undefined }
  }, [authority, projectId])

  const act = async (action: () => Promise<unknown>) => {
    if (operation.current) return
    const token = Symbol('journey-operation')
    operation.current = token
    const currentAuthority = authority
    const currentProject = projectId
    try {
      await action()
      if (authority !== currentAuthority || projectId !== currentProject) return
      await load()
    } catch (reason) {
      if (authority === currentAuthority && projectId === currentProject) {
        setState(value => value.authority === authority && value.projectId === projectId
          ? { ...value, error: reason instanceof Error ? reason.message : String(reason) }
          : value)
      }
    } finally {
      if (operation.current === token) operation.current = undefined
    }
  }

  if (state.authority !== authority || state.projectId !== projectId || !state.value) {
    return <main className="content-page cc-page" aria-busy="true"><h1>Set up collaboration</h1>{state.error ? <><p role="alert">{state.error}</p><button onClick={() => void load()}>Retry</button></> : <p role="status">Loading current Project access…</p>}</main>
  }

  const value = state.value
  const capacity = value.capacity
  const configuredLimits = capacity?.limits
  const draft = {
    cpuMillicores: capacityDraft.cpuMillicores !== undefined ? capacityDraft.cpuMillicores : String(configuredLimits?.cpuMillicores ?? ''),
    memoryMiB: capacityDraft.memoryMiB !== undefined ? capacityDraft.memoryMiB : String(configuredLimits?.memoryMiB ?? ''),
    maxConcurrency: capacityDraft.maxConcurrency !== undefined ? capacityDraft.maxConcurrency : String(configuredLimits?.maxConcurrency ?? ''),
  }
  const capacityInput = { cpuMillicores: Number(draft.cpuMillicores), memoryMiB: Number(draft.memoryMiB), maxConcurrency: Number(draft.maxConcurrency) }
  const capacityInputValid = Number.isSafeInteger(capacityInput.cpuMillicores) && capacityInput.cpuMillicores > 0 && capacityInput.cpuMillicores <= 1_000_000 && Number.isSafeInteger(capacityInput.memoryMiB) && capacityInput.memoryMiB > 0 && capacityInput.memoryMiB <= 67_108_864 && Number.isSafeInteger(capacityInput.maxConcurrency) && capacityInput.maxConcurrency > 0 && capacityInput.maxConcurrency <= 10_000
  const projectOvercommitted = capacity?.overcommit ? Object.values(capacity.overcommit.project).some(value => value > 0) : false
  const primaryBlocker = capacity?.admissionState === 'blocked' ? capacity.queuedAdmission?.find(item => item.state === 'blocked')?.blockers[0]?.code ?? (projectOvercommitted ? capacity.overcommit?.reason : 'no_eligible_worker') : undefined
  const selectedSource = value.sources?.some(source => source.sourceId === sourceId)
    ? sourceId
    : value.sources?.[0]?.sourceId ?? ''
  const review = async (runId: string) => {
    if (!authority.review || operation.current) return
    const token = Symbol('journey-review')
    operation.current = token
    const current = generation.current
    try {
      const next = await authority.review(projectId, runId)
      if (operation.current === token && generation.current === current && state.authority === authority && state.projectId === projectId) setResult(next)
    } catch (reason) {
      if (operation.current === token && generation.current === current) setState(previous => ({ ...previous, error: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      if (operation.current === token) operation.current = undefined
    }
  }
  return <main className="content-page cc-page">
    <header className="page-header"><div><span className="eyebrow">Connected Project</span><h1>People and machines</h1><p>Invite only the teammate and machine needed for this Project. Private accounts and files remain separate.</p></div></header>
    {state.error && <p role="alert">{state.error}</p>}
    <section className="cc-panel"><h2>Invitations</h2>
      {value.invitations?.map(item => <article key={item.invitationId}><p><strong>{item.recipientSubject}</strong> · invitation {item.status}{item.status === 'pending' ? ` · expires ${new Date(item.expiresAt).toLocaleString()}` : ''}</p>{item.status === 'pending' && <div className="page-actions">{authority.acceptInvitation && (value.rosterAvailable === false || item.recipientSubject === value.currentSubject) && <button className="primary-btn" onClick={() => void act(() => authority.acceptInvitation!(projectId, item.invitationId, item.revision))}>Accept invitation</button>}{authority.revokeInvitation && value.canManage && <button className="tiny-btn" onClick={() => void act(() => authority.revokeInvitation!(projectId, item.invitationId, item.revision))}>Revoke invitation</button>}</div>}</article>)}
      {value.canManage && <div className="form-row"><label>Teammate identity<input value={subject} onChange={event => setSubject(event.target.value)} /></label><button className="primary-btn" disabled={!subject.trim()} onClick={() => void act(() => authority.invite(projectId, subject.trim()))}>Invite teammate</button></div>}
    </section>
    {value.rosterAvailable !== false && <><section className="cc-panel"><h2>People</h2>{value.members.map(item => <p key={item.subject}><strong>{item.subject}</strong> · {item.role} · {item.status}</p>)}</section><section className="cc-panel"><h2>Machines</h2>{value.workers.length ? value.workers.map(item => <p key={item.workerId}><strong>{item.workerId}</strong> · {item.runtimeKind.replaceAll('_', ' ')} · {item.status}</p>) : <p>No machine is registered for this Project.</p>}{value.canManage && <><p>Registering a machine creates its Project assignment. The worker still connects separately with its issued credential.</p><div className="form-row"><label>Machine name<input value={worker} onChange={event => setWorker(event.target.value)} /></label><button className="primary-btn" disabled={!worker.trim()} onClick={() => void act(() => authority.enroll(projectId, worker.trim()))}>Register machine</button></div></>}</section></>}
    {value.rosterAvailable !== false && <section className="cc-panel"><span className="eyebrow">Admission control</span><h2>Project capacity</h2>
      {value.capacityAvailable === false ? <p>Resource capacity is unavailable from this server. Runs use the server's existing admission behavior.</p> : !capacity ? <p role="status">Capacity status is unavailable{value.capacityError ? `: ${value.capacityError}` : '.'}</p> : !capacity.accountingEnforced ? <><p>No Project capacity limits are configured. Resource accounting is not enforced for new Runs.</p><p>Monetary budgets, account quotas, interactive reservations, and fairness are unavailable.</p></> : <>
        <p><strong>{capacity.admissionState === 'blocked' ? 'New Run admission blocked' : capacity.admissionState === 'available' ? 'Queued Runs can be admitted' : 'No Runs are waiting for admission'}</strong>{capacity.state === 'overcommitted' ? ' · existing work keeps its reservations until release' : ''}</p>
        {primaryBlocker && <p role="alert">{primaryBlocker.replaceAll('_', ' ')}. {projectOvercommitted ? 'Wait for active reservations to release or raise the Project limits.' : 'Check the affected Run and current worker snapshots for an eligible placement.'}</p>}
        <table><thead><tr><th>Resource</th><th>Reserved</th><th>Limit</th><th>Available</th></tr></thead><tbody>
          <tr><th>CPU</th><td>{capacity.usage!.cpuMillicores} mCPU</td><td>{capacity.limits!.cpuMillicores} mCPU</td><td>{capacity.available!.cpuMillicores} mCPU</td></tr>
          <tr><th>Memory</th><td>{capacity.usage!.memoryMiB} MiB</td><td>{capacity.limits!.memoryMiB} MiB</td><td>{capacity.available!.memoryMiB} MiB</td></tr>
          <tr><th>Concurrency</th><td>{capacity.usage!.concurrency}</td><td>{capacity.limits!.maxConcurrency}</td><td>{capacity.available!.concurrency}</td></tr>
        </tbody></table>
        <h3>Worker snapshots</h3>{capacity.workers?.length ? capacity.workers.map(item => <p key={item.workerId}><strong>{item.workerId}</strong> · {item.snapshotState}{item.observedAt ? ` · observed ${new Date(item.observedAt).toLocaleString()}` : ''} · {item.authority === 'worker_self_reported' ? 'worker self-reported' : 'no report'} · hardware not attested</p>) : <p>No Project worker snapshots were returned.</p>}
        <details><summary>Exact admission detail</summary><p>Status generated {capacity.generatedAt ? new Date(capacity.generatedAt).toLocaleString() : 'at an unavailable time'} · revision {capacity.revision ?? 'unavailable'} · {capacity.reservationCount} active reservations · {capacity.recentReleaseCount} recent releases.</p>{capacity.queuedAdmission?.map(item => <p key={item.runId}><code>{item.runId}</code> · {item.state}{item.blockers.length ? ` · ${item.blockers.map(blocker => blocker.code).join(', ')}` : ''}</p>)}{capacity.overcommit?.workers.map(item => <p key={item.workerId}><code>{item.workerId}</code> exceeds CPU by {item.cpuMillicores} mCPU, memory by {item.memoryMiB} MiB, concurrency by {item.concurrency}.</p>)}</details>
        <p>Monetary budgets, account quotas, interactive reservations, and fairness are unavailable. Worker capacity is self-reported and is not hardware attestation.</p>
      </>}
      {value.canManage && value.capacityAvailable !== false && authority.configureCapacity && <div className="form-row"><label>CPU limit (mCPU)<input type="number" min="1" max="1000000" step="1" value={draft.cpuMillicores} onChange={event => setCapacityDraft(current => ({ ...current, cpuMillicores: event.target.value }))} /></label><label>Memory limit (MiB)<input type="number" min="1" max="67108864" step="1" value={draft.memoryMiB} onChange={event => setCapacityDraft(current => ({ ...current, memoryMiB: event.target.value }))} /></label><label>Concurrent Runs<input type="number" min="1" max="10000" step="1" value={draft.maxConcurrency} onChange={event => setCapacityDraft(current => ({ ...current, maxConcurrency: event.target.value }))} /></label><button className="primary-btn" disabled={!capacityInputValid} onClick={() => void act(async () => { await authority.configureCapacity!(projectId, capacityInput); setCapacityDraft({}) })}>Save capacity limits</button></div>}
    </section>}
    {value.rosterAvailable !== false && authority.delegate && <section className="cc-panel"><h2>Delegate work</h2><p>Choose an authorized Project source. An available worker will claim the task.</p>{value.sources?.length ? <div className="form-row"><label>Project source<select value={selectedSource} onChange={event => setSourceId(event.target.value)}>{value.sources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.label}</option>)}</select></label><label>Task<textarea value={task} onChange={event => setTask(event.target.value)} /></label><button className="primary-btn" disabled={!selectedSource || !task.trim()} onClick={() => void act(async () => { await authority.delegate!(projectId, selectedSource, task.trim()); setTask('') })}>Delegate task</button></div> : <p>{value.sourceDiscoveryAvailable === false ? 'Project source discovery is unavailable from this server.' : 'Add a Project source before delegating work.'}</p>}{value.activeRuns?.length ? <div><h3>In progress</h3>{value.activeRuns.map(run => <article key={run.runId}><p><strong>{run.task}</strong> · {run.status}</p>{authority.cancel && <button className="tiny-btn" onClick={() => void act(() => authority.cancel!(run.runId))}>Cancel run</button>}</article>)}</div> : null}<p>Pausing and resuming are unavailable for these Runs.</p></section>}
    {value.rosterAvailable !== false && authority.review && <section className="cc-panel"><h2>Results</h2>{value.results?.length ? value.results.map(item => <article key={item.runId}><h3>{item.title}</h3><p>{item.workerId ? `${item.status ?? 'completed'} on ${item.workerId}` : 'Completed Run'}{item.updatedAt ? ` · ${new Date(item.updatedAt).toLocaleString()}` : ''}</p><p>{item.verified ? 'Verified' : 'Artifact available · facts not independently verified'}</p><button className="primary-btn" onClick={() => void review(item.runId)}>Review result</button></article>) : <p>No completed machine result is available.</p>}{result && <article><p><strong>{result.status}</strong> on {result.workerId}</p><h3>Result</h3><pre>{result.text}</pre>{value.participants?.map(participant => <Link key={participant.participantId} className="primary-btn" to={`/participants/review?${new URLSearchParams({ project: projectId, participant: participant.participantId, run: result.runId, artifact: result.resource.artifact_id, digest: result.resource.digest })}`}>Ask {participant.title} to review this result</Link>)}<details><summary>Exact evidence</summary><p><code>{result.runId}/{result.resource.artifact_id}</code></p><p><code>{result.resource.digest}</code></p></details></article>}</section>}
    {value.rosterAvailable !== false && <section className="cc-panel"><h2>Reviewers</h2>{value.participants?.length ? value.participants.map(item => <article key={item.participantId}><h3>{item.title}</h3><p>{item.lifecycle}</p><Link className="primary-btn" to={`/participants/review?${new URLSearchParams({ project: projectId, participant: item.participantId })}`}>Open reviewer inbox</Link></article>) : <p>{value.participantDiscoveryAvailable === false ? 'Reviewer discovery is unavailable from this server.' : 'No reviewer participant is registered for this Project.'}</p>}</section>}
  </main>
}
