import type { AuthoritativeRunDetail } from '../features/runs/AuthoritativeRunSurface'
import type { CodingTaskSpec } from '../features/onboarding/CodingTaskOptions'
import { RemoteMalleableShellClient } from './remoteMalleableShell'
import type { AuthorizedContextHandle, PortableCheckpoint, PortableContinuationIntent } from '../features/onboarding/ConnectedJourneySurface'

type Json = Record<string, unknown>
const submissionErrorMessages: Record<string, string> = {
  run_submission_pending: 'The earlier submission is still pending. Retry the same task to reconcile it; a replacement run will not be created.',
  run_idempotency_conflict: 'This submission key is already bound to different arguments. Refresh the task state before submitting a changed task.',
  selected_context_budget_exceeded: 'The selected knowledge exceeds the context budget. Select fewer documents or shorten the task so every selected source can be included.',
  coding_execution_unavailable: 'Workspace changes are unavailable for this runtime or adapter. Select the supported personal Codex workspace-write adapter.',
  authorized_context_packet_access_denied: 'The selected project knowledge is unavailable or no longer authorized. Refresh source access before retrying.',
  context_packet_unavailable: 'The admitted context packet is unavailable. Refresh current source access before retrying.',
}
function journeyErrorMessage(detail: unknown, status: number): string {
  if (typeof detail === 'string') return detail.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 512) || `Connected journey request failed (${status})`
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const code = (detail as Json).code
    if (typeof code === 'string' && Object.hasOwn(submissionErrorMessages, code)) return `${submissionErrorMessages[code]} (${code}; HTTP ${status})`
  }
  return `Connected journey request failed (${status})`
}
class RemoteJourneyRequestError extends Error { readonly status:number;constructor(message:string,status:number){super(message);this.status=status} get definitive(){return [400,401,403,404,409,422].includes(this.status)} }

export class RemoteJourneyClient {
  private readonly baseUrl: string
  private readonly user: () => string
  private readonly token?: string
  private readonly capacityAvailable: boolean
  private readonly nativeAdaptersAvailable: boolean
  private readonly authorizedContextAvailable: boolean
  private readonly portableContinuationAvailable: boolean
  private readonly nativeSessionResume: boolean
  private readonly delegationIntents = new Map<string, string>()
  private readonly storage?: Storage
  constructor(baseUrl: string, user: () => string, token?: string, capacityAvailable = false, nativeAdaptersAvailable = false, authorizedContextAvailable = false, portableContinuationAvailable = false, nativeSessionResume = false, storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage) { this.baseUrl = baseUrl; this.user = user; this.token = token; this.capacityAvailable = capacityAvailable; this.nativeAdaptersAvailable = nativeAdaptersAvailable; this.authorizedContextAvailable = authorizedContextAvailable; this.portableContinuationAvailable=portableContinuationAvailable;this.nativeSessionResume=nativeSessionResume;this.storage=storage }

  private async request(path: string, method: string, body?: unknown): Promise<Json> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-OpenSaddle-User': this.user(), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!response.ok) { const value = await response.json().catch(() => null) as { detail?: unknown } | null; throw new RemoteJourneyRequestError(journeyErrorMessage(value?.detail, response.status),response.status) }
    return await response.json() as Json
  }

  createProject(projectId: string) { return this.request('/api/v2/projects', 'POST', { project_id: projectId }) }
  invitations(projectId: string) { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/invitations`, 'GET') }
  async invite(projectId: string, subject: string) { await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/invitations`, 'POST', { recipient_subject: subject, role: 'member', ttl_seconds: 3600 }) }
  addMember(projectId: string, subject: string, role: 'admin' | 'member' | 'requester' | 'approver' | 'auditor') { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/members`, 'PUT', { subject, role }) }
  acceptInvitation(projectId: string, id: string, expectedRevision: number) { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(id)}/accept`, 'POST', { expected_revision: expectedRevision }) }
  revokeInvitation(projectId: string, id: string, expectedRevision: number) { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(id)}/revoke`, 'POST', { expected_revision: expectedRevision }) }
  async enroll(projectId: string, workerId: string) { await this.registerWorker({ workerId, organizationId: projectId, projectIds: [projectId], runtimeKind: 'remote_worker' }) }
  registerWorker(input: { workerId: string; organizationId: string; projectIds: string[]; runtimeKind: 'remote_worker' | 'aws_firecracker' | 'gcp_microvm' | 'azure_microvm' }) { return this.request('/api/v2/workers', 'POST', { worker_id: input.workerId, organization_id: input.organizationId, project_ids: input.projectIds, runtime_kind: input.runtimeKind }) }
  createRun(input: { projectId: string; sourceId: string; task: string }) { return this.request('/api/v2/runs', 'POST', { project_id: input.projectId, source_id: input.sourceId, task: input.task }) }
  async delegate(projectId: string, sourceId: string, task: string, nativeAdapterId?: 'codex-app-server'|'claude-code-stream-json', authorizedContextSourceIds: string[] = [], codingTask?: CodingTaskSpec) {
    if (authorizedContextSourceIds.length > 32 || new Set(authorizedContextSourceIds).size !== authorizedContextSourceIds.length || authorizedContextSourceIds.some(id => !id)) throw Error('Authorized context source selection is invalid')
    const subject = this.user()
    const body = { project_id: projectId, source_id: sourceId, task, ...(nativeAdapterId ? { native_adapter_id: nativeAdapterId } : {}), ...(authorizedContextSourceIds.length ? { authorized_context_source_ids: [...authorizedContextSourceIds] } : {}), ...(codingTask ? { coding_task: { schema_version: codingTask.schema_version, allowed_paths: [...codingTask.allowed_paths], verification_commands: codingTask.verification_commands.map(argv => [...argv]) } } : {}) }
    // Persist only a fingerprint and random intent key, never task or knowledge text.
    const fingerprintBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([this.baseUrl.replace(/\/$/, ''), subject, body])))
    const fingerprint = Array.from(new Uint8Array(fingerprintBytes), value => value.toString(16).padStart(2, '0')).join('')
    const storageKey = `opensaddle:delegation-intent:v1:${fingerprint}`
    let intentKey: string
    try {
      const previous = this.storage ? this.storage.getItem(storageKey) : this.delegationIntents.get(storageKey)
      if (previous && !/^[a-f0-9-]{36}$/.test(previous)) throw Error('Invalid saved intent')
      intentKey = previous || crypto.randomUUID()
      if (this.storage) {
        this.storage.setItem(storageKey, intentKey)
        if (this.storage.getItem(storageKey) !== intentKey) throw Error('Intent persistence failed')
      } else {
        if (typeof window !== 'undefined') throw Error('Intent storage unavailable')
        this.delegationIntents.set(storageKey, intentKey)
      }
    } catch { throw Error('Task submission intent could not be saved; nothing was submitted') }
    if (this.user() !== subject) throw Error('Task submission authority changed; nothing was submitted')
    // Unknown responses, including server pending conflicts, retain this exact key.
    const result = await this.request('/api/v2/runs', 'POST', { ...body, idempotency_key: intentKey })
    if (result.project_id !== projectId || typeof result.run_id !== 'string' || !result.run_id) throw Error('Task submission response identity is invalid; retry the same task to reconcile it')
    try {
      if (this.storage) {
        if (this.storage.getItem(storageKey) === intentKey) this.storage.removeItem(storageKey)
      } else if (this.delegationIntents.get(storageKey) === intentKey) this.delegationIntents.delete(storageKey)
    } catch { throw Error('Task was accepted, but its local submission receipt could not be cleared; retry the same task to reconcile it') }
    return result
  }

  run(runId: string) { return this.request(`/api/v2/runs/${encodeURIComponent(runId)}`, 'GET') }
  async runDetail(runId: string): Promise<AuthoritativeRunDetail> {
    const run = await this.run(runId)
    if (run.run_id !== runId || typeof run.project_id !== 'string' || !run.project_id || typeof run.task !== 'string' || typeof run.status !== 'string' || typeof run.cancellation_requested !== 'boolean') throw Error('Authoritative Run identity or status is invalid')
    const projectId = run.project_id, subject = this.user()
    let manager = false
    try {
      const roster = await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/members`, 'GET')
      if (roster.project_id !== projectId || !Array.isArray(roster.members)) throw Error('Project roster identity mismatch')
      manager = roster.members.some(raw => { const member = raw as Json; return member.subject === subject && member.status === 'active' && ['owner','admin'].includes(String(member.role)) })
    } catch { /* No manager controls are inferred when membership cannot be read. */ }
    if (subject !== this.user()) throw Error('Run authority changed during status read')
    return { runId, projectId, task: run.task, status: run.status, cancellationRequested: run.cancellation_requested, canCancel: manager || run.requested_by === subject, workerId: typeof run.assigned_worker_id === 'string' ? run.assigned_worker_id : undefined, updatedAt: typeof run.updated_at === 'string' ? run.updated_at : undefined, codingTask: (((run.policy as Json | undefined)?.obligations as Json | undefined)?.coding_task as Json | undefined)?.schema_version === 'opensaddle.coding-task.v1', ...this.authorizedContextSelection(run) }
  }
  cancel(runId: string) { return this.request(`/api/v2/runs/${encodeURIComponent(runId)}/cancel`, 'POST', {}) }
  private continuationKey(projectId:string,runId:string) { return `opensaddle:portable-continuation:v1:${encodeURIComponent(this.baseUrl)}:${encodeURIComponent(this.user())}:${encodeURIComponent(projectId)}:${encodeURIComponent(runId)}` }
  private pendingContinuations(projectId:string):{items:Array<{runId:string,intent:PortableContinuationIntent}>,error?:string} { const found:Array<{runId:string,intent:PortableContinuationIntent}>=[];try{const prefix=this.continuationKey(projectId,'');if(!this.storage)return{items:found};for(let index=0;index<this.storage.length;index++){const key=this.storage.key(index);if(!key?.startsWith(prefix))continue;let runId:string;try{runId=decodeURIComponent(key.slice(prefix.length))}catch{continue}const intent=this.pendingContinuation(projectId,runId);if(runId&&intent)found.push({runId,intent})}return{items:found}}catch{return{items:found,error:'Local continuation recovery storage is unavailable.'}} }
  private pendingContinuation(projectId:string,runId:string):PortableContinuationIntent|undefined { try { const raw=this.storage?.getItem(this.continuationKey(projectId,runId));if(!raw)return undefined;const value=JSON.parse(raw) as Record<string,unknown>;if(Object.keys(value).sort().join(',')!=='checkpointDigest,checkpointId,idempotencyKey,targetWorkerId'||typeof value.checkpointId!=='string'||!/^chk_[a-f0-9]{32}$/.test(value.checkpointId)||typeof value.checkpointDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.checkpointDigest)||typeof value.targetWorkerId!=='string'||!value.targetWorkerId||typeof value.idempotencyKey!=='string'||!value.idempotencyKey)return undefined;return{checkpointId:value.checkpointId,checkpointDigest:value.checkpointDigest,targetWorkerId:value.targetWorkerId,idempotencyKey:value.idempotencyKey} } catch { return undefined } }
  preparePortableContinuation(projectId:string,runId:string,checkpoint:PortableCheckpoint,targetWorkerId:string):PortableContinuationIntent { if(!this.portableContinuationAvailable||!targetWorkerId)throw Error('Portable continuation is unavailable');const prior=this.pendingContinuation(projectId,runId);if(prior)return prior;const intent={checkpointId:checkpoint.checkpointId,checkpointDigest:checkpoint.checkpointDigest,targetWorkerId,idempotencyKey:crypto.randomUUID()};try{if(!this.storage)throw Error('storage unavailable');this.storage.setItem(this.continuationKey(projectId,runId),JSON.stringify(intent));if(this.storage.getItem(this.continuationKey(projectId,runId))!==JSON.stringify(intent))throw Error('storage verification failed')}catch{throw Error('Portable continuation intent could not be saved; nothing was submitted')}return intent }
  async continuePortable(projectId:string,runId:string,intent:PortableContinuationIntent) { const key=this.continuationKey(projectId,runId),stored=this.pendingContinuation(projectId,runId);if(!stored||JSON.stringify(stored)!==JSON.stringify(intent))throw Error('Portable continuation intent is unavailable; nothing was submitted');try{const result=await this.request(`/api/v2/runs/${encodeURIComponent(runId)}/continuations`,'POST',{checkpoint_id:intent.checkpointId,checkpoint_digest:intent.checkpointDigest,target_worker_id:intent.targetWorkerId,idempotency_key:intent.idempotencyKey,mode:'portable_artifact'});if(this.storage?.getItem(key)===JSON.stringify(intent))this.storage.removeItem(key);return result}catch(reason){if(reason instanceof RemoteJourneyRequestError&&reason.definitive&&this.storage?.getItem(key)===JSON.stringify(intent))this.storage.removeItem(key);throw reason} }
  configureCapacity(projectId: string, limits: { cpuMillicores: number; memoryMiB: number; maxConcurrency: number }) { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/capacity-limits`, 'PUT', { cpu_millicores: limits.cpuMillicores, memory_mib: limits.memoryMiB, max_concurrency: limits.maxConcurrency }) }


  private async authorizedContextSources(projectId: string) {
    if (!this.authorizedContextAvailable) return undefined
    const value=await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/authorized-context-sources?limit=100`,'GET')
    if(value.schema_version!=='opensaddle.authorized-context-source-list.v1'||value.project_id!==projectId||!Array.isArray(value.items)||value.items.length>100)throw Error('Connected journey authorized context source list is invalid')
    const text=(input:unknown,label:string,max=2048)=>{if(typeof input!=='string'||!input||input.length>max)throw Error(`Connected journey authorized context source ${label} is invalid`);return input}
    const digest=(input:unknown)=>{const value=text(input,'digest',71);if(!/^sha256:[a-f0-9]{64}$/.test(value))throw Error('Connected journey authorized context source digest is invalid');return value}
    const ids=new Set<string>()
    return value.items.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Connected journey authorized context source is invalid');const item=raw as Json,ref=item.resource_ref;if(!ref||typeof ref!=='object'||Array.isArray(ref))throw Error('Connected journey authorized context source ResourceRef is invalid');const resource=ref as Json,sourceId=text(item.source_id,'ID',512),version=text(item.source_version,'version',512),classification=text(item.classification,'classification',128),authority=text(resource.authority,'authority',512),resourceType=text(resource.resource_type,'resource type',128),resourceId=text(resource.resource_id,'resource ID'),resourceVersion=text(resource.version,'resource version',512);digest(resource.digest);if(ids.has(sourceId)||item.immutable!==true||item.provider_freshness!=='rechecked_at_packet_create_and_read'||resourceVersion!==version||!['public','internal','confidential','restricted','private'].includes(classification)||!/^([a-z][a-z0-9+.-]*):[^\s?#]+$/.test(authority)||!/^[a-z][a-z0-9._-]*$/.test(resourceType)||['latest','current','head','working-tree'].includes(version.toLowerCase()))throw Error('Connected journey authorized context source contract is invalid');ids.add(sourceId);return{sourceId,label:resourceId,version,classification}})
  }
  private async checkpoints(projectId:string,runId:string):Promise<PortableCheckpoint[]> {
    if(!this.portableContinuationAvailable)return []
    const value=await this.request(`/api/v2/runs/${encodeURIComponent(runId)}/checkpoints`,'GET')
    if(value.schema_version!=='opensaddle.run-checkpoints.v1'||value.run_id!==runId||!Array.isArray(value.items)||value.items.length>100)throw Error('Connected journey checkpoint list is invalid')
    return value.items.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Connected journey checkpoint is invalid');const item=raw as Json;if(('run_id' in item&&item.run_id!==runId)||('project_id' in item&&item.project_id!==projectId)||typeof item.checkpoint_id!=='string'||!/^chk_[a-f0-9]{32}$/.test(item.checkpoint_id)||typeof item.checkpoint_digest!=='string'||!/^[a-f0-9]{64}$/.test(item.checkpoint_digest)||!Number.isSafeInteger(item.source_lease_epoch)||Number(item.source_lease_epoch)<1||typeof item.created_by_worker_id!=='string'||!item.created_by_worker_id||typeof item.created_at!=='string'||!Number.isFinite(Date.parse(item.created_at)))throw Error('Connected journey checkpoint is invalid');return{checkpointId:item.checkpoint_id,checkpointDigest:item.checkpoint_digest,sourceLeaseEpoch:Number(item.source_lease_epoch),sourceWorkerId:item.created_by_worker_id,createdAt:item.created_at}})
  }
  private async capacity(projectId: string) {
    if (!this.capacityAvailable) return undefined
    const value = await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/capacity`, 'GET')
    if (value.schema_version !== 'opensaddle.resource-capacity.v1' || value.project_id !== projectId) throw Error('Connected journey capacity Project identity mismatch')
    const object = (input: unknown, label: string) => { if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error(`Connected journey capacity ${label} is invalid`); return input as Json }
    const integer = (input: unknown, label: string, positive = false, maximum = Number.MAX_SAFE_INTEGER) => { if (!Number.isSafeInteger(input) || (positive ? Number(input) <= 0 : Number(input) < 0) || Number(input) > maximum) throw Error(`Connected journey capacity ${label} is invalid`); return Number(input) }
    const text = (input: unknown, label: string) => { if (typeof input !== 'string' || !input) throw Error(`Connected journey capacity ${label} is invalid`); return input }
    const list = (input: unknown, label: string) => { if (!Array.isArray(input)) throw Error(`Connected journey capacity ${label} is invalid`); return input }
    const values = (input: unknown) => { const item = object(input, 'values'); return { cpuMillicores: integer(item.cpu_millicores, 'CPU'), memoryMiB: integer(item.memory_mib, 'memory'), concurrency: integer(item.concurrency, 'concurrency') } }
    const pendingPhases = list(value.pending_phases, 'pending phases').map(item => text(item, 'pending phase'))
    if (value.accounting_enforced === false) {
      if (value.state !== 'unbounded_legacy' || value.reason !== 'project_capacity_limits_not_configured') throw Error('Connected journey capacity status is invalid')
      return { accountingEnforced: false, state: 'unbounded_legacy' as const, reason: value.reason, pendingPhases }
    }
    if (value.accounting_enforced !== true) throw Error('Connected journey capacity enforcement is invalid')
    if (!['configured', 'overcommitted'].includes(String(value.state)) || !['blocked', 'available', 'idle'].includes(String(value.admission_state))) throw Error('Connected journey capacity status is invalid')
    const limits = object(value.limits, 'limits'), overcommit = value.overcommit === null ? undefined : object(value.overcommit, 'overcommit')
    const workers = list(value.workers, 'workers').map(raw => { const item = object(raw, 'worker'); if (!['missing', 'stale', 'current'].includes(String(item.snapshot_state)) || item.hardware_attested !== false || ![null, 'worker_self_reported'].includes(item.authority as null|string)) throw Error('Connected journey capacity worker is invalid'); return { workerId: text(item.worker_id, 'worker id'), snapshotState: item.snapshot_state as 'missing'|'stale'|'current', observedAt: item.observed_at === null ? undefined : text(item.observed_at, 'observed time'), expiresAt: item.expires_at === null ? undefined : text(item.expires_at, 'expiry time'), authority: item.authority === 'worker_self_reported' ? 'worker_self_reported' as const : undefined, hardwareAttested: false as const } })
    const reservations = list(value.reservations, 'reservations').map(raw => { const item = object(raw, 'reservation'); text(item.run_id, 'reservation Run id'); text(item.worker_id, 'reservation worker id'); integer(item.attempt, 'reservation attempt', true); integer(item.lease_epoch, 'reservation lease epoch', true); values(item); text(item.reserved_at, 'reservation time'); text(item.expires_at, 'reservation expiry'); return item })
    const recentReleases = list(value.recent_releases, 'recent releases').map(raw => { const item = object(raw, 'recent release'); text(item.run_id, 'release Run id'); text(item.worker_id, 'release worker id'); integer(item.attempt, 'release attempt', true); integer(item.lease_epoch, 'release lease epoch', true); text(item.released_at, 'release time'); text(item.release_reason, 'release reason'); return item })
    const queuedAdmission = list(value.queued_admission, 'queued admission').map(raw => { const item = object(raw, 'queued admission item'); if (!['admissible', 'blocked'].includes(String(item.state))) throw Error('Connected journey capacity admission item is invalid'); const runId = text(item.run_id, 'Run id'); return { runId, state: item.state as 'admissible'|'blocked', blockers: list(item.blockers, 'blockers').map(rawBlocker => { const blocker = object(rawBlocker, 'blocker'); if (text(blocker.project_id, 'blocker Project id') !== projectId || text(blocker.run_id, 'blocker Run id') !== runId) throw Error('Connected journey capacity blocker identity mismatch'); return { code: text(blocker.code, 'blocker code') } }) } })
    return {
      accountingEnforced: true,
      state: String(value.state) as 'configured' | 'overcommitted',
      admissionState: String(value.admission_state) as 'blocked' | 'available' | 'idle',
      limits: { cpuMillicores: integer(limits.cpu_millicores, 'CPU limit', true, 1_000_000), memoryMiB: integer(limits.memory_mib, 'memory limit', true, 67_108_864), maxConcurrency: integer(limits.max_concurrency, 'concurrency limit', true, 10_000) },
      usage: values(value.usage), available: values(value.available), revision: integer(value.revision, 'revision'), generatedAt: text(value.generated_at, 'generation time'), pendingPhases,
      overcommit: overcommit ? { reason: text(overcommit.reason, 'overcommit reason'), project: values(overcommit.project), workers: list(overcommit.workers, 'overcommitted workers').map(raw => ({ workerId: text(object(raw, 'overcommitted worker').worker_id, 'worker id'), ...values(raw) })) } : undefined,
      workers, queuedAdmission, reservationCount: reservations.length, recentReleaseCount: recentReleases.length,
    }
  }

  private async nativeAdapters(projectId: string) {
    if (!this.nativeAdaptersAvailable) return undefined
    const value = await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/native-adapters`, 'GET')
    const object = (input: unknown, label: string) => { if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error(`Connected journey native ${label} is invalid`); return input as Json }
    const text = (input: unknown, label: string, nullable = false) => { if (nullable && input === null) return undefined; if (typeof input !== 'string' || !input || input.length > 200) throw Error(`Connected journey native ${label} is invalid`); return input }
    const known = <T extends string>(input: unknown, values: readonly T[], label: string) => { if (!values.includes(input as T)) throw Error(`Connected journey native ${label} is invalid`); return input as T }
    const timestamp = (input: unknown, label: string) => { const result = text(input,label); if (!result || !Number.isFinite(Date.parse(result))) throw Error(`Connected journey native ${label} is invalid`); return result }
    if (value.schema_version !== 'opensaddle.native-adapter-readiness.v1' || value.project_id !== projectId || !Array.isArray(value.items)) throw Error('Connected journey native adapter Project identity mismatch')
    timestamp(value.generated_at, 'generation time')
    return value.items.map(raw => { const item=object(raw,'adapter'); if (item.schema_version !== 'opensaddle.native-adapter-readiness.v1' || item.project_id !== projectId || typeof item.ready !== 'boolean') throw Error('Connected journey native adapter identity is invalid'); const digest=text(item.digest,'source digest'); if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw Error('Connected journey native source digest is invalid'); const executableState=known(item.executable_state,['installed','missing','version_unsupported','probe_failed'] as const,'executable state'), authenticationState=known(item.authentication_state,['authenticated','unauthenticated','unknown','probe_failed'] as const,'authentication state'), protocolState=known(item.protocol_state,['compatible','incompatible','unknown'] as const,'protocol state'), workspaceState=known(item.workspace_state,['configured','unavailable','stale'] as const,'workspace state'), observedAt=timestamp(item.observed_at,'observation time'), expiresAt=timestamp(item.expires_at,'expiry time'); if (Date.parse(expiresAt)<=Date.parse(observedAt) || item.ready && (executableState!=='installed'||authenticationState!=='authenticated'||protocolState!=='compatible'||workspaceState!=='configured')) throw Error('Connected journey native ready state is invalid'); return { workerId:text(item.worker_id,'worker id')!,adapterId:known(item.adapter_id,['codex-app-server','claude-code-stream-json'] as const,'adapter id'),sourceId:text(item.source_id,'source id')!,revision:text(item.revision,'revision')!,digest,executableState,executableVersion:text(item.executable_version,'executable version',true),authenticationState,accountMode:text(item.account_mode,'account mode',true),protocolState,protocolVersion:text(item.protocol_version,'protocol version',true),workspaceState,ready:item.ready,reason:text(item.reason,'reason',true),observedAt,expiresAt,reportedAt:timestamp(item.reported_at,'report time') } })
  }

  private nativeSelection(run: Json) {
    const policy = run.policy && typeof run.policy === 'object' && !Array.isArray(run.policy) ? run.policy as Json : undefined
    const obligations = policy?.obligations && typeof policy.obligations === 'object' && !Array.isArray(policy.obligations) ? policy.obligations as Json : undefined
    const adapter = obligations?.native_adapter_id
    if (adapter === undefined) return {}
    if (adapter !== 'codex-app-server' && adapter !== 'claude-code-stream-json') throw Error('Connected journey Run native adapter is invalid')
    const model = obligations?.native_model
    if (model !== undefined && (typeof model !== 'string' || !model || model.length > 100)) throw Error('Connected journey Run native model is invalid')
    return { nativeAdapterId: adapter, ...(typeof model === 'string' ? { nativeModel:model } : {}) }
  }

  private authorizedContextSelection(run: Json) {
    const policy = run.policy && typeof run.policy === 'object' && !Array.isArray(run.policy) ? run.policy as Json : undefined
    const obligations = policy?.obligations && typeof policy.obligations === 'object' && !Array.isArray(policy.obligations) ? policy.obligations as Json : undefined
    const raw = obligations?.authorized_context_packet
    if (raw === undefined) return {}
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Connected journey Run context packet is invalid')
    const item = raw as Json
    const digest = (value: unknown, label: string) => { if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw Error(`Connected journey Run context ${label} is invalid`); return value }
    if (item.capability_id !== 'krail.authorized-context-packet' || item.capability_version !== '1.0.0') throw Error('Connected journey Run context capability is invalid')
    return { authorizedContext: { packetDigest:digest(item.packet_digest,'packet digest'), requestDigest:digest(item.request_digest,'request digest'), capabilityId:item.capability_id, capabilityVersion:item.capability_version, capabilityDescriptorDigest:digest(item.capability_descriptor_digest,'descriptor digest') } as AuthorizedContextHandle }
  }

  async authorizedContextPacket(projectId: string, runId: string, handle: AuthorizedContextHandle) {
    void projectId
    if (!this.authorizedContextAvailable) throw Error('context_packet_unavailable')
    let value: Json
    try { value = await this.request(`/api/v2/runs/${encodeURIComponent(runId)}/authorized-context-packet`, 'GET') }
    catch { throw Error('context_packet_unavailable') }
    const object = (input: unknown, label: string) => { if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error(`Connected journey context ${label} is invalid`); return input as Json }
    const string = (input: unknown, label: string, max=8192) => { if (typeof input !== 'string' || !input || input.length>max) throw Error(`Connected journey context ${label} is invalid`); return input }
    const digest = (input: unknown, label: string) => { const result=string(input,label,71); if (!/^sha256:[a-f0-9]{64}$/.test(result)) throw Error(`Connected journey context ${label} is invalid`); return result }
    const timestamp = (input: unknown, label: string) => { const result=string(input,label,64); if (!Number.isFinite(Date.parse(result))) throw Error(`Connected journey context ${label} is invalid`); return result }
    if (value.available !== true) throw Error('context_packet_unavailable')
    const packet=object(value.packet,'packet'), reauth=object(value.reauthorization,'reauthorization'), coreBinding=object(value.core_binding,'Core binding'), context=object(packet.context,'brief')
    const packetDigest=digest(packet.packet_digest,'packet digest'), packetId=digest(packet.packet_id,'packet id'), requestDigest=digest(packet.request_digest,'request digest')
    if (packet.schema_version!=='krail.authorized-context-packet.v2' || packetId!==packetDigest || packetDigest!==handle.packetDigest || requestDigest!==handle.requestDigest || packet.capability_id!==handle.capabilityId || packet.capability_version!==handle.capabilityVersion || digest(packet.capability_descriptor_digest,'descriptor digest')!==handle.capabilityDescriptorDigest) throw Error('Connected journey context packet does not match admitted Run')
    if (reauth.schema_version!=='krail.authorized-context-reauthorization.v1' || string(coreBinding.project_id,'Core Project')!==projectId || string(coreBinding.run_id,'Core Run')!==runId || digest(coreBinding.request_digest,'Core request digest')!==handle.requestDigest || digest(coreBinding.packet_digest,'Core packet digest')!==handle.packetDigest) throw Error('Connected journey context reauthorization does not match admitted Run')
    if (context.schema_version!=='krail.context-brief.v1' || typeof packet.truncated!=='boolean') throw Error('Connected journey context packet shape is invalid')
    const positiveInteger=(input:unknown,label:string,max:number)=>{if(!Number.isSafeInteger(input)||Number(input)<1||Number(input)>max)throw Error(`Connected journey context ${label} is invalid`);return Number(input)}
    positiveInteger(packet.canonical_context_utf8_bytes,'context byte bound',524288); positiveInteger(packet.canonical_packet_utf8_bytes,'packet byte bound',524288); positiveInteger(packet.max_context_tokens,'token limit',32768); positiveInteger(packet.context_token_upper_bound,'token bound',32768)
    if(packet.token_estimation!=='canonical-context-utf8-bytes-conservative-upper-bound'||packet.truncation_uncertainty!=='bounded-search-or-source-truncation-may-omit-evidence')throw Error('Connected journey context packet bounds are invalid')
    const resource = (input: unknown) => { const item=object(input,'resource'), authority=string(item.authority,'resource authority',512),resourceType=string(item.resource_type,'resource type',100),resourceId=string(item.resource_id,'resource id',2048),version=string(item.version,'resource version',512),resourceDigest=digest(item.digest,'resource digest'); if(!/^[a-z][a-z0-9+.-]*:[^\s?#]+$/.test(authority)||['latest','current','head','working-tree'].includes(version.toLowerCase()))throw Error('Connected journey context resource is invalid'); return { resourceId,version,key:JSON.stringify([authority,resourceType,resourceId,version,resourceDigest]) } }
    if (!Array.isArray(packet.exact_evidence_refs) || packet.exact_evidence_refs.length<1 || packet.exact_evidence_refs.length>256) throw Error('Connected journey context evidence refs are invalid')
    const exactKeys=new Set(packet.exact_evidence_refs.map(item=>resource(item).key)); if(exactKeys.size!==packet.exact_evidence_refs.length) throw Error('Connected journey context evidence refs are invalid')
    const referencedKeys=new Set<string>()
    const referencedResource=(input:unknown,label:string)=>{const ref=resource(input);if(!exactKeys.has(ref.key))throw Error(`Connected journey context ${label} is outside admitted evidence`);referencedKeys.add(ref.key);return ref}
    referencedResource(context.repository,'repository'); referencedResource(context.issue,'issue')
    const strictArray=(input:unknown,label:string,max=32)=>{if(!Array.isArray(input)||input.length>max)throw Error(`Connected journey context ${label} is invalid`);return input}
    const assertions = strictArray(context.assertions,'assertions').map(raw=>{const item=object(raw,'assertion'), ref=referencedResource(item.source,'assertion');digest(item.assertion_id,'assertion id');strictArray(item.processing_versions,'assertion processing versions',16);return {text:string(item.text,'assertion',16384),locator:string(item.locator,'assertion locator',2048),resourceId:ref.resourceId,version:ref.version}})
    strictArray(context.freshness,'freshness').forEach(raw=>referencedResource(object(raw,'freshness item').source,'freshness'))
    strictArray(context.conflicts,'conflicts').forEach(raw=>strictArray(object(raw,'conflict').sources,'conflict sources',2).forEach(ref=>referencedResource(ref,'conflict')))
    strictArray(context.ranking_trace,'ranking trace').forEach(raw=>referencedResource(object(raw,'ranking item').source,'ranking'))
    const evidence=object(context.evidence,'evidence'); if (typeof evidence.packet_id!=='string' || !evidence.packet_id || !string(evidence.query,'evidence query') || !timestamp(evidence.generated_at,'evidence generation') || typeof evidence.truncated!=='boolean') throw Error('Connected journey context evidence is invalid'); if (!Array.isArray(evidence.items) || evidence.items.length<1 || evidence.items.length>100) throw Error('Connected journey context evidence is invalid')
    const citations=evidence.items.map(raw=>{const item=object(raw,'evidence item'),ref=referencedResource(item.source,'evidence');return {content:string(item.excerpt,'evidence excerpt',32768),locator:string(item.locator,'evidence locator',2048),resourceId:ref.resourceId,version:ref.version}})
    if (assertions.length>32 || citations.length>500 || referencedKeys.size!==exactKeys.size) throw Error('Connected journey context evidence refs do not match the admitted packet')
    return { packetId,packetDigest,requestDigest,capabilityId:handle.capabilityId,capabilityVersion:handle.capabilityVersion,capabilityDescriptorDigest:handle.capabilityDescriptorDigest,reauthorizedAt:timestamp(reauth.reauthorized_at,'reauthorized time'),currentAuthorizationDigest:digest(reauth.current_authorization_digest,'current authorization digest'),decisionDigest:digest(reauth.decision_digest,'decision digest'),purpose:string(packet.purpose,'purpose',512),scope:string(packet.scope,'scope',512),truncated:packet.truncated===true,assertions,citations }
  }

  async snapshot(projectId: string) {
    const invitations = await this.invitations(projectId).catch(() => ({ project_id: projectId, invitations: [] }))
    if (invitations.project_id !== projectId) throw Error('Connected journey Project identity mismatch')
    const mappedInvitations = (Array.isArray(invitations.invitations) ? invitations.invitations : []).map(value => { const item = value as Json; return { invitationId: String(item.invitation_id), recipientSubject: String(item.recipient_subject), status: String(item.status), revision: Number(item.revision), expiresAt: String(item.expires_at) } })
    let members: Json, workers: Json, center: Json
    try { [members, workers, center] = await Promise.all([this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/members`, 'GET'), this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/workers`, 'GET'), this.request('/api/v2/command-center', 'GET')]) }
    catch (reason) { if (mappedInvitations.some(item => item.status === 'pending')) return { projectId, members: [], workers: [], invitations: mappedInvitations, rosterAvailable: false, canManage: false, currentSubject: this.user() }; throw reason }
    if (members.project_id !== projectId || workers.project_id !== projectId) throw Error('Connected journey Project identity mismatch')
    let participantDiscoveryAvailable = true, sourceDiscoveryAvailable = true
    let capacityError: string | undefined, nativeAdaptersError: string | undefined, authorizedContextSourcesError: string | undefined
    const [participantList, sourceList, capacity, nativeAdapters, authorizedContextSources] = await Promise.all([
      this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/participants?limit=100`, 'GET').catch(() => { participantDiscoveryAvailable = false; return { items: [] } }),
      this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/sources?limit=100`, 'GET').catch(() => { sourceDiscoveryAvailable = false; return { items: [] } }),
      this.capacity(projectId).catch(reason => { capacityError = reason instanceof Error ? reason.message : String(reason); return undefined }),
      this.nativeAdapters(projectId).catch(reason => { nativeAdaptersError = reason instanceof Error ? reason.message : String(reason); return undefined }),
      this.authorizedContextSources(projectId).catch(reason => { authorizedContextSourcesError = reason instanceof Error ? reason.message : String(reason); return undefined }),
    ])
    if ((participantDiscoveryAvailable && (!('project_id' in participantList) || participantList.project_id !== projectId)) || (sourceDiscoveryAvailable && (!('project_id' in sourceList) || sourceList.project_id !== projectId))) throw Error('Connected journey discovery Project identity mismatch')
    const memberItems = Array.isArray(members.members) ? members.members : []
    const outcomes = (Array.isArray(center.outcomes) ? center.outcomes : []).flatMap(value => { const item = value as Json; return item.project_id === projectId && typeof item.run_id === 'string' && typeof item.artifact_available === 'boolean' ? [{ runId: item.run_id, fallbackTitle: String(item.task ?? item.title), verified: item.verified === true, artifactAvailable:item.artifact_available }] : [] })
    const results = await Promise.all(outcomes.map(async outcome => {
      const detail = await this.run(outcome.runId)
      if (detail.project_id !== projectId || detail.run_id !== outcome.runId) throw Error('Connected journey result Run identity mismatch')
      return { runId: outcome.runId, title: typeof detail.task === 'string' ? detail.task : outcome.fallbackTitle, verified: outcome.verified, artifactAvailable:outcome.artifactAvailable, workerId: typeof detail.assigned_worker_id === 'string' ? detail.assigned_worker_id : undefined, status: typeof detail.status === 'string' ? detail.status : undefined, updatedAt: typeof detail.updated_at === 'string' ? detail.updated_at : undefined, ...this.nativeSelection(detail), ...this.authorizedContextSelection(detail) }
    }))
    const activeItems=(Array.isArray(center.active_runs) ? center.active_runs : []).flatMap(value => { const item=value as Json;return item.project_id===projectId&&typeof item.run_id==='string'&&Number.isSafeInteger(item.lease_epoch)&&Number(item.lease_epoch)>=0&&typeof item.requested_by==='string'&&typeof item.cancellation_requested==='boolean'?[item]:[] })
    const known=new Set(activeItems.map(item=>item.run_id as string)),pendingIndex=this.pendingContinuations(projectId);let portableContinuationError=pendingIndex.error
    for(const pending of pendingIndex.items){if(known.has(pending.runId))continue;let item:Json;try{item=await this.run(pending.runId)}catch(reason){portableContinuationError=reason instanceof Error?reason.message:String(reason);continue}if(item.project_id===projectId&&item.run_id===pending.runId&&Number.isSafeInteger(item.lease_epoch)&&Number(item.lease_epoch)>=0&&typeof item.requested_by==='string'&&typeof item.cancellation_requested==='boolean'){activeItems.push(item);known.add(pending.runId)}}
    const activeRuns = await Promise.all(activeItems.map(async item=>{let checkpoints:PortableCheckpoint[]|undefined,checkpointError:string|undefined;if(item.status==='paused'){try{checkpoints=await this.checkpoints(projectId,item.run_id as string)}catch(reason){checkpointError=reason instanceof Error?reason.message:String(reason)}}return{ runId:item.run_id as string,task:String(item.task??'Run'),status:String(item.status),leaseEpoch:Number(item.lease_epoch),requestedBy:item.requested_by as string,cancellationRequested:item.cancellation_requested as boolean,...this.nativeSelection(item),...(checkpoints?{checkpoints}:{}),...(checkpointError?{checkpointError}:{}),...(this.pendingContinuation(projectId,item.run_id as string)?{pendingContinuation:this.pendingContinuation(projectId,item.run_id as string)}:{}) } }))
    return {
      projectId,
      members: memberItems.map(value => { const item = value as Json; return { subject: String(item.subject), role: String(item.role), status: String(item.status) } }),
      workers: (Array.isArray(workers.workers) ? workers.workers : []).map(value => { const item = value as Json; return { workerId: String(item.worker_id), runtimeKind: String(item.runtime_kind), status: String(item.status) } }),
      invitations: mappedInvitations,
      participantDiscoveryAvailable,
      participants: (Array.isArray(participantList.items) ? participantList.items : []).map(value => { const item = value as Json; return { participantId: String(item.participant_id), title: String(item.title), lifecycle: String(item.lifecycle) } }),
      sourceDiscoveryAvailable,
      sources: (Array.isArray(sourceList.items) ? sourceList.items : []).map(value => { const item = value as Json; return { sourceId: String(item.source_id), label: String(item.display_label) } }),
      activeRuns,
      portableContinuationAvailable: this.portableContinuationAvailable,
      portableContinuationError,
      nativeSessionResume: this.nativeSessionResume,
      results,
      rosterAvailable: true,
      currentSubject: this.user(),
      canManage: memberItems.some(value => { const item = value as Json; return item.subject === this.user() && (item.role === 'owner' || item.role === 'admin') }),
      capacityAvailable: this.capacityAvailable,
      capacity,
      capacityError,
      nativeAdaptersAvailable: this.nativeAdaptersAvailable,
      nativeAdapters,
      nativeAdaptersError,
      authorizedContextAvailable: this.authorizedContextAvailable,
      authorizedContextSourcesAvailable: this.authorizedContextAvailable && authorizedContextSources !== undefined,
      authorizedContextSources,
      authorizedContextSourcesError,
    }
  }

  async review(projectId: string, runId: string) {
    const subject=this.user()
    const run = await this.run(runId); if (run.run_id !== runId || run.project_id !== projectId) throw Error('Connected journey Run Project mismatch')
    const listing = await this.request(`/api/v2/runs/${encodeURIComponent(runId)}/artifacts`, 'GET'); if (listing.run_id !== runId) throw Error('Connected journey artifact Run mismatch')
    const artifact = (Array.isArray(listing.artifacts) ? listing.artifacts : [])[0] as Json | undefined; if (!artifact) throw Error('This Run has no reviewable artifact.')
    const resource = { project_id: projectId, run_id: runId, artifact_id: String(artifact.artifact_id), digest: String(artifact.content_digest) }
    const content = await new RemoteMalleableShellClient(this.baseUrl, this.user, this.token).content(resource)
    const current = await this.run(runId)
    if(subject!==this.user()||current.run_id!==runId||current.project_id!==projectId)throw Error('Result authority changed during read')
    return { runId, status: String(run.status), workerId: String(run.assigned_worker_id ?? 'unassigned'), resource, text: content.text, ...((((run.policy as Json | undefined)?.obligations as Json | undefined)?.coding_task as Json | undefined)?.schema_version === 'opensaddle.coding-task.v1' ? { codingTask: true } : {}) }
  }
}
