import type { AuthoritativeRunDetail } from '../runs/AuthoritativeRunSurface'
import { CodingTaskOptions, codingTaskSpec, emptyCodingTaskDraft, type CodingTaskSpec } from './CodingTaskOptions'
import { CodingResultPanel } from './CodingResultPanel'
import type { CodingResultAuthority } from '../../services/codingResultReview'
import { ProjectKnowledgePanel, type ProjectKnowledgeAuthority } from '../projects/ProjectKnowledgePanel'
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
  results?: Array<{ runId: string; title: string; verified: boolean; artifactAvailable?: boolean; workerId?: string; status?: string; updatedAt?: string; nativeAdapterId?: NativeAdapterId; nativeModel?: string; authorizedContext?: AuthorizedContextHandle }>
  participantDiscoveryAvailable?: boolean
  participants?: Array<{ participantId: string; title: string; lifecycle: string }>
  sourceDiscoveryAvailable?: boolean
  sources?: Array<{ sourceId: string; label: string }>
  activeRuns?: Array<{ runId: string; task: string; status: string; leaseEpoch: number; requestedBy: string; cancellationRequested: boolean; nativeAdapterId?: NativeAdapterId; nativeModel?: string; checkpoints?: PortableCheckpoint[]; checkpointError?: string; pendingContinuation?: PortableContinuationIntent }>
  portableContinuationAvailable?: boolean
  portableContinuationError?: string
  nativeSessionResume?: boolean
  nativeAdaptersAvailable?: boolean
  nativeAdapters?: NativeAdapterReadiness[]
  nativeAdaptersError?: string
  capacityAvailable?: boolean
  capacity?: ProjectCapacityStatus
  capacityError?: string
  authorizedContextAvailable?: boolean
  authorizedContextSourcesAvailable?: boolean
  authorizedContextSources?: Array<{ sourceId: string; label: string; version: string; classification: string }>
  authorizedContextSourcesError?: string
}

export type NativeAdapterId = 'codex-app-server' | 'claude-code-stream-json'
export type PortableCheckpoint = { checkpointId: string; checkpointDigest: string; sourceLeaseEpoch: number; sourceWorkerId: string; createdAt: string }
export type PortableContinuationIntent = { checkpointId: string; checkpointDigest: string; targetWorkerId: string; idempotencyKey: string }
export type AuthorizedContextHandle = { packetDigest: string; requestDigest: string; capabilityId: string; capabilityVersion: string; capabilityDescriptorDigest: string }
export type AuthorizedContextPacket = AuthorizedContextHandle & { packetId: string; reauthorizedAt: string; currentAuthorizationDigest: string; decisionDigest: string; purpose: string; scope: string; truncated: boolean; assertions: Array<{ text: string; locator: string; resourceId: string; version: string }>; citations: Array<{ content?: string; locator: string; resourceId: string; version: string }> }
export type NativeAdapterReadiness = {
  workerId: string; adapterId: NativeAdapterId; sourceId: string; revision: string; digest: string
  executableState: 'installed'|'missing'|'version_unsupported'|'probe_failed'; executableVersion?: string
  authenticationState: 'authenticated'|'unauthenticated'|'unknown'|'probe_failed'; accountMode?: string
  protocolState: 'compatible'|'incompatible'|'unknown'; protocolVersion?: string
  workspaceState: 'configured'|'unavailable'|'stale'; ready: boolean; reason?: string
  observedAt: string; expiresAt: string; reportedAt: string
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
  runDetail?(runId: string): Promise<AuthoritativeRunDetail>
  snapshot(projectId: string): Promise<JourneySnapshot>
  invite(projectId: string, subject: string): Promise<void>
  enroll(projectId: string, workerId: string): Promise<void>
  acceptInvitation?(projectId: string, id: string, revision: number): Promise<unknown>
  revokeInvitation?(projectId: string, id: string, revision: number): Promise<unknown>
  review?(projectId: string, runId: string): Promise<{ runId: string; status: string; workerId: string; resource: { artifact_id: string; digest: string }; text: string; codingTask?: boolean }>
  createProject?(projectId: string): Promise<unknown>
  delegate?(projectId: string, sourceId: string, task: string, nativeAdapterId?: NativeAdapterId, authorizedContextSourceIds?: string[], codingTask?: CodingTaskSpec): Promise<unknown>
  cancel?(runId: string): Promise<unknown>
  preparePortableContinuation?(projectId: string, runId: string, checkpoint: PortableCheckpoint, targetWorkerId: string): PortableContinuationIntent
  continuePortable?(projectId: string, runId: string, intent: PortableContinuationIntent): Promise<unknown>
  configureCapacity?(projectId: string, limits: { cpuMillicores: number; memoryMiB: number; maxConcurrency: number }): Promise<unknown>
  authorizedContextPacket?(projectId: string, runId: string, handle: AuthorizedContextHandle): Promise<AuthorizedContextPacket>
}

type State = { authority: JourneyAuthority; projectId: string; value?: JourneySnapshot; error?: string }

export function ConnectedJourneySurface({ authority, projectId, projectKnowledge, codingResults }: { authority: JourneyAuthority; projectId: string; projectKnowledge?: ProjectKnowledgeAuthority; codingResults?: CodingResultAuthority }) {
  const generation = useRef(0)
  const operation = useRef<symbol | undefined>(undefined)
  const [state, setState] = useState<State>({ authority, projectId })
  const [subject, setSubject] = useState('')
  const [worker, setWorker] = useState('')
  const [result, setResult] = useState<Awaited<ReturnType<NonNullable<JourneyAuthority['review']>>>>()
  const [sourceId, setSourceId] = useState('')
  const [task, setTask] = useState('')
  const [submissionPending, setSubmissionPending] = useState(false)
  const [codingDraft, setCodingDraft] = useState(emptyCodingTaskDraft)
  const [nativeAdapterId, setNativeAdapterId] = useState<NativeAdapterId | '' | undefined>(undefined)
  const [authorizedContextSourceIds, setAuthorizedContextSourceIds] = useState<string[]>([])
  const [continuationTargets, setContinuationTargets] = useState<Record<string, string>>({})
  const [localContinuationIntents, setLocalContinuationIntents] = useState<Record<string, PortableContinuationIntent>>({})
  const [capacityDraft, setCapacityDraft] = useState<{ cpuMillicores?: string; memoryMiB?: string; maxConcurrency?: string }>({})
  const [packetState, setPacketState] = useState<{ authority: JourneyAuthority; projectId: string; runId: string; packet?: AuthorizedContextPacket; unavailable?: string }>()

  const load = async () => {
    const current = ++generation.current
    setResult(undefined)
    setPacketState(undefined)
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
    setSubmissionPending(false)
    setCodingDraft(emptyCodingTaskDraft)
    setNativeAdapterId(undefined)
    setAuthorizedContextSourceIds([])
    setContinuationTargets({})
    setLocalContinuationIntents({})
    setCapacityDraft({})
    setPacketState(undefined)
    void load()
    return () => { generation.current++; operation.current = undefined }
  }, [authority, projectId])

  const act = async (action: () => Promise<unknown>) => {
    if (operation.current) return
    const token = Symbol('journey-operation')
    operation.current = token
    setSubmissionPending(true)
    const currentGeneration = generation.current
    try {
      await action()
      if (operation.current !== token || generation.current !== currentGeneration) return
      await load()
    } catch (reason) {
      if (operation.current === token && generation.current === currentGeneration) {
        setState(value => value.authority === authority && value.projectId === projectId
          ? { ...value, error: reason instanceof Error ? reason.message : String(reason) }
          : value)
      }
    } finally {
      if (operation.current === token) { operation.current = undefined; setSubmissionPending(false) }
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
  const sourceAdapters = value.nativeAdapters?.filter(item => item.sourceId === selectedSource) ?? []
  const adapterGroups = (['codex-app-server','claude-code-stream-json'] as const).flatMap(adapterId => { const items=sourceAdapters.filter(item=>item.adapterId===adapterId); return items.length ? [{ adapterId, items, ready:items.some(item=>item.ready) }] : [] })
  const selectableContextIds = new Set(value.authorizedContextSources?.map(source=>source.sourceId) ?? [])
  const selectedAuthorizedContextSourceIds = authorizedContextSourceIds.filter(id=>selectableContextIds.has(id))
  const selectedAdapter = nativeAdapterId === undefined ? adapterGroups.find(item=>item.ready)?.adapterId ?? '' : adapterGroups.some(item=>item.adapterId===nativeAdapterId && item.ready) ? nativeAdapterId : ''
  let codingSpec: CodingTaskSpec | undefined
  try { codingSpec = codingTaskSpec(codingDraft) } catch { /* The options panel explains the invalid scope. */ }
  const codingArgs: [CodingTaskSpec] | [] = codingSpec ? [codingSpec] : []
  const review = async (runId: string) => {
    if (!authority.review || operation.current) return
    const token = Symbol('journey-review')
    operation.current = token
    setResult(undefined)
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
  const inspectPacket = async (runId: string, handle: AuthorizedContextHandle) => {
    if (!authority.authorizedContextPacket) return
    const current = ++generation.current
    setPacketState({ authority, projectId, runId })
    try {
      const packet = await authority.authorizedContextPacket(projectId, runId, handle)
      if (current === generation.current) setPacketState({ authority, projectId, runId, packet })
    } catch (reason) {
      if (current === generation.current) setPacketState({ authority, projectId, runId, unavailable: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  const continuePortable = async (runId: string, checkpoint: PortableCheckpoint, targetWorkerId: string, existing?: PortableContinuationIntent) => {
    if ((!existing && !authority.preparePortableContinuation) || !authority.continuePortable || operation.current) return
    let intent: PortableContinuationIntent
    try { intent = existing ?? authority.preparePortableContinuation!(projectId, runId, checkpoint, targetWorkerId) }
    catch (reason) { setState(current=>({...current,error:reason instanceof Error?reason.message:String(reason)}));return }
    setLocalContinuationIntents(current => ({ ...current, [runId]: intent }))
    await act(async () => {
      try { await authority.continuePortable!(projectId, runId, intent);setLocalContinuationIntents(current => { const next={...current};delete next[runId];return next }) }
      catch(reason){if((reason as {definitive?:unknown})?.definitive===true)setLocalContinuationIntents(current=>{const next={...current};delete next[runId];return next});throw reason}
    })
  }
  return <main className="content-page cc-page">
    <header className="page-header"><div><span className="eyebrow">Connected Project</span><h1>People and machines</h1><p>Invite only the teammate and machine needed for this Project. Private accounts and files remain separate.</p></div><button disabled={submissionPending} onClick={() => void load()}>Refresh project work</button></header>
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
    {projectKnowledge && <ProjectKnowledgePanel authority={projectKnowledge} projectId={projectId} onReviewed={() => void load()} />}
    {value.rosterAvailable !== false && authority.delegate && <section className="cc-panel"><h2>Delegate work</h2><p>Choose a source and coding agent for this task.</p>{value.sources?.length ? <div className="form-row"><label>Project source<select value={selectedSource} onChange={event => { setSourceId(event.target.value); setNativeAdapterId(undefined) }}>{value.sources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.label}</option>)}</select></label>{value.authorizedContextAvailable && value.authorizedContextSourcesAvailable && value.authorizedContextSources?.length ? <fieldset><legend>Launch context</legend><p>Select authorized Knowledge source versions this task may use. Authorization is checked again when the packet is inspected.</p>{value.authorizedContextSources.map(source=><label key={`context:${source.sourceId}`}><input type="checkbox" checked={selectedAuthorizedContextSourceIds.includes(source.sourceId)} onChange={event=>setAuthorizedContextSourceIds(current=>event.target.checked?[...current,source.sourceId]:current.filter(id=>id!==source.sourceId))}/>{source.label} · {source.version} · {source.classification}</label>)}</fieldset> : value.authorizedContextAvailable && value.authorizedContextSourcesAvailable ? <p>No reviewed project knowledge is available yet. Capture and review a project document before selecting it for a task.</p> : <p>Authorized launch context selection is unavailable{value.authorizedContextSourcesError ? `: ${value.authorizedContextSourcesError}` : '.'}</p>}{value.nativeAdaptersAvailable === false ? <p>Native coding-agent selection is unavailable from this server.</p> : value.nativeAdaptersError ? <p role="status">Coding-agent readiness is unavailable: {value.nativeAdaptersError}</p> : <label>Coding agent<select value={selectedAdapter} onChange={event => setNativeAdapterId(event.target.value as NativeAdapterId)}><option value="">Choose an available agent</option>{adapterGroups.map(group => <option key={group.adapterId} value={group.adapterId} disabled={!group.ready}>{group.adapterId === 'codex-app-server' ? 'Codex' : 'Claude Code'}{group.ready ? '' : ` — unavailable: ${(group.items[0].reason ?? group.items[0].authenticationState).replaceAll('_',' ')}`}</option>)}</select></label>}<CodingTaskOptions disabled={submissionPending} value={codingDraft} onChange={setCodingDraft} available={Boolean(codingResults) && selectedAdapter === 'codex-app-server'} /><label>Task<textarea disabled={submissionPending} value={task} onChange={event => setTask(event.target.value)} /></label><button className="primary-btn" disabled={submissionPending || !selectedSource || !task.trim() || !selectedAdapter || selectedAuthorizedContextSourceIds.length > 32 || (codingDraft.enabled && (!codingSpec || !codingResults || selectedAdapter !== 'codex-app-server'))} onClick={() => void act(async () => { const submissionGeneration = generation.current; if (selectedAdapter) await authority.delegate!(projectId, selectedSource, task.trim(), selectedAdapter, selectedAuthorizedContextSourceIds, ...codingArgs); else await authority.delegate!(projectId, selectedSource, task.trim(), undefined, selectedAuthorizedContextSourceIds, ...codingArgs); if (generation.current === submissionGeneration) setTask(current => current === task ? '' : current) })}>Delegate task</button></div> : <p>{value.sourceDiscoveryAvailable === false ? 'Project source discovery is unavailable from this server.' : 'Add a Project source before delegating work.'}</p>}{value.nativeAdaptersAvailable && sourceAdapters.length ? <details><summary>Coding-agent readiness</summary>{sourceAdapters.map(item => <p key={`${item.workerId}:${item.adapterId}:detail`}><strong>{item.adapterId === 'codex-app-server' ? 'Codex' : 'Claude Code'}</strong> on {item.workerId} · {item.ready ? 'available' : (item.reason ?? 'unavailable').replaceAll('_',' ')} · executable {item.executableState}{item.executableVersion ? ` ${item.executableVersion}` : ''} · authentication {item.authenticationState}{item.accountMode ? ` (${item.accountMode})` : ''} · protocol {item.protocolState}{item.protocolVersion ? ` ${item.protocolVersion}` : ''} · workspace {item.workspaceState} at {item.revision} · worker self-reported {new Date(item.observedAt).toLocaleString()}, expires {new Date(item.expiresAt).toLocaleString()}</p>)}</details> : null}{value.activeRuns?.length ? <div><h3>In progress</h3>{value.activeRuns.map(run => { const checkpoint=run.checkpoints?.find(item=>item.sourceLeaseEpoch===run.leaseEpoch-1),pending=localContinuationIntents[run.runId] ?? run.pendingContinuation,target=pending?.targetWorkerId ?? continuationTargets[run.runId] ?? ''; return <article key={run.runId}><p><strong>{authority.runDetail ? <Link to={`/runs?${new URLSearchParams({run:run.runId})}`}>{run.task}</Link> : run.task}</strong> · {run.status}{run.nativeAdapterId ? ` · requested ${run.nativeAdapterId === 'codex-app-server' ? 'Codex' : 'Claude Code'}${run.nativeModel ? ` (${run.nativeModel})` : ''}` : ''}</p>{run.cancellationRequested ? <p role="status">Cancellation requested</p> : authority.cancel && (value.canManage || run.requestedBy === value.currentSubject) ? <button className="tiny-btn" onClick={() => void act(() => authority.cancel!(run.runId))}>Cancel run</button> : null}{pending && !run.cancellationRequested ? !value.portableContinuationAvailable ? <p role="status">The pending continuation cannot be reconciled because portable continuation is unavailable.</p> : !value.canManage ? <p role="status">A Project owner or admin must reconcile this pending continuation.</p> : <><p role="status">Continuation delivery is unconfirmed for {pending.targetWorkerId}.</p><button className="secondary-btn" onClick={() => void continuePortable(run.runId,{checkpointId:pending.checkpointId,checkpointDigest:pending.checkpointDigest,sourceLeaseEpoch:Math.max(1,run.leaseEpoch-1),sourceWorkerId:'pending',createdAt:new Date(0).toISOString()},pending.targetWorkerId,pending)}>Retry same continuation</button></> : run.status === 'paused' && !run.cancellationRequested ? !value.portableContinuationAvailable ? <p role="status">Portable continuation is unavailable from this server.</p> : !value.canManage ? <p role="status">A Project owner or admin can continue this paused Run.</p> : run.checkpointError ? <p role="status">Portable checkpoint is unavailable: {run.checkpointError}</p> : !checkpoint ? <p role="status">No portable checkpoint is available.</p> : !value.workers.length ? <p role="status">No Project machine is available as a continuation target.</p> : <div className="form-row"><label>Target machine<select value={target} onChange={event=>setContinuationTargets(current=>({...current,[run.runId]:event.target.value}))}><option value="">Choose a Project machine</option>{value.workers.map(worker=><option key={worker.workerId} value={worker.workerId}>{worker.workerId} · {worker.status}</option>)}</select></label><button className="secondary-btn" disabled={!target} onClick={() => void continuePortable(run.runId,checkpoint,target)}>Continue from portable checkpoint</button></div> : null}</article>})}</div> : null}{value.portableContinuationError ? <p role="status">A saved continuation could not be reconciled: {value.portableContinuationError}</p> : null}<p>Native coding-agent sessions cannot be resumed. Portable continuation starts a new worker attempt from a verified checkpoint.</p></section>}
    {value.rosterAvailable !== false && authority.review && <section className="cc-panel"><h2>Results</h2>{value.results?.length ? value.results.map(item => <article key={item.runId}><h3>{item.title}</h3><p>{item.workerId ? `${item.status ?? 'completed'} on ${item.workerId}` : `${item.status ?? 'terminal'} Run`}{item.nativeAdapterId ? ` · requested ${item.nativeAdapterId === 'codex-app-server' ? 'Codex' : 'Claude Code'}${item.nativeModel ? ` (${item.nativeModel})` : ''}` : ''}{item.updatedAt ? ` · ${new Date(item.updatedAt).toLocaleString()}` : ''}</p><p>{item.artifactAvailable ? item.verified ? 'Verified' : 'Artifact available · facts not independently verified' : 'No result artifact was published'}{item.nativeAdapterId ? ' · admitted by Core policy on the assigned worker; provider-reported execution provenance is unavailable' : ''}</p><div className="page-actions">{item.artifactAvailable ? <button className="primary-btn" onClick={() => void review(item.runId)}>Review result</button> : <p role="status">This {item.status ?? 'terminal'} Run has no reviewable result.</p>}{value.authorizedContextAvailable && item.authorizedContext && authority.authorizedContextPacket && <button className="secondary-btn" onClick={() => void inspectPacket(item.runId, item.authorizedContext!)}>Inspect launch context</button>}</div>{packetState?.authority === authority && packetState.projectId === projectId && packetState.runId === item.runId && <section aria-label="Authorized launch context"><h4>Context used at launch</h4>{packetState.packet ? <><p>Currently authorized · reauthorized {new Date(packetState.packet.reauthorizedAt).toLocaleString()}</p><p><code>{packetState.packet.packetDigest}</code></p><p>{packetState.packet.purpose} · {packetState.packet.scope}{packetState.packet.truncated ? ' · bounded packet may omit context' : ''}</p>{packetState.packet.assertions.map((entry,index)=><blockquote key={`${entry.resourceId}:${entry.locator}:${index}`}><p>{entry.text}</p><cite>{entry.resourceId} · {entry.version} · {entry.locator}</cite></blockquote>)}{packetState.packet.citations.map((entry,index)=><article key={`${entry.resourceId}:${entry.locator}:${index}`}><p>{entry.content ?? 'Citation content was not included.'}</p><small>{entry.resourceId} · {entry.version} · {entry.locator}</small></article>)}<details><summary>Authorization evidence</summary><p>Request <code>{packetState.packet.requestDigest}</code></p><p>Current authorization <code>{packetState.packet.currentAuthorizationDigest}</code></p><p>Decision <code>{packetState.packet.decisionDigest}</code></p><p>Capability {packetState.packet.capabilityId} {packetState.packet.capabilityVersion} · <code>{packetState.packet.capabilityDescriptorDigest}</code></p></details></> : packetState.unavailable ? <p role="status">Launch context unavailable: {packetState.unavailable}</p> : <p role="status">Checking current authorization…</p>}</section>}</article>) : <p>No terminal machine result is available.</p>}{result && <article><p><strong>{result.status}</strong> on {result.workerId}</p><h3>Result</h3>{result.codingTask ? codingResults ? <CodingResultPanel authority={codingResults} projectId={projectId} runId={result.runId} /> : <p>Coding verification and exact review are unavailable from this server.</p> : <pre>{result.text}</pre>}{value.participants?.map(participant => <Link key={participant.participantId} className="primary-btn" to={`/participants/review?${new URLSearchParams({ project: projectId, participant: participant.participantId, run: result.runId, artifact: result.resource.artifact_id, digest: result.resource.digest })}`}>Ask {participant.title} to review this result</Link>)}<details><summary>Exact evidence</summary><p><code>{result.runId}/{result.resource.artifact_id}</code></p><p><code>{result.resource.digest}</code></p></details></article>}</section>}
    {value.rosterAvailable !== false && <section className="cc-panel"><h2>Reviewers</h2>{value.participants?.length ? value.participants.map(item => <article key={item.participantId}><h3>{item.title}</h3><p>{item.lifecycle}</p><Link className="primary-btn" to={`/participants/review?${new URLSearchParams({ project: projectId, participant: item.participantId })}`}>Open reviewer inbox</Link></article>) : <p>{value.participantDiscoveryAvailable === false ? 'Reviewer discovery is unavailable from this server.' : 'No reviewer participant is registered for this Project.'}</p>}</section>}
  </main>
}
