import { RemoteMalleableShellClient } from './remoteMalleableShell'
import type { AuthorizedContextHandle } from '../features/onboarding/ConnectedJourneySurface'

type Json = Record<string, unknown>

export class RemoteJourneyClient {
  private readonly baseUrl: string
  private readonly user: () => string
  private readonly token?: string
  private readonly capacityAvailable: boolean
  private readonly nativeAdaptersAvailable: boolean
  private readonly authorizedContextAvailable: boolean
  constructor(baseUrl: string, user: () => string, token?: string, capacityAvailable = false, nativeAdaptersAvailable = false, authorizedContextAvailable = false) { this.baseUrl = baseUrl; this.user = user; this.token = token; this.capacityAvailable = capacityAvailable; this.nativeAdaptersAvailable = nativeAdaptersAvailable; this.authorizedContextAvailable = authorizedContextAvailable }

  private async request(path: string, method: string, body?: unknown): Promise<Json> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-OpenSaddle-User': this.user(), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!response.ok) { const value = await response.json().catch(() => null) as { detail?: unknown } | null; throw Error(typeof value?.detail === 'string' ? value.detail : `Connected journey request failed (${response.status})`) }
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
  delegate(projectId: string, sourceId: string, task: string, nativeAdapterId?: 'codex-app-server'|'claude-code-stream-json', authorizedContextSourceIds: string[] = []) { if (authorizedContextSourceIds.length>32 || new Set(authorizedContextSourceIds).size!==authorizedContextSourceIds.length || authorizedContextSourceIds.some(id=>!id)) throw Error('Authorized context source selection is invalid'); return this.request('/api/v2/runs', 'POST', { project_id: projectId, source_id: sourceId, task, ...(nativeAdapterId ? { native_adapter_id: nativeAdapterId } : {}), ...(authorizedContextSourceIds.length ? { authorized_context_source_ids: authorizedContextSourceIds } : {}) }) }
  run(runId: string) { return this.request(`/api/v2/runs/${encodeURIComponent(runId)}`, 'GET') }
  cancel(runId: string) { return this.request(`/api/v2/runs/${encodeURIComponent(runId)}/cancel`, 'POST', {}) }
  configureCapacity(projectId: string, limits: { cpuMillicores: number; memoryMiB: number; maxConcurrency: number }) { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/capacity-limits`, 'PUT', { cpu_millicores: limits.cpuMillicores, memory_mib: limits.memoryMiB, max_concurrency: limits.maxConcurrency }) }


  private async authorizedContextSources(projectId: string) {
    if (!this.authorizedContextAvailable) return undefined
    const value=await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/authorized-context-sources?limit=100`,'GET')
    if(value.schema_version!=='opensaddle.authorized-context-source-list.v1'||value.project_id!==projectId||!Array.isArray(value.items)||value.items.length>100)throw Error('Connected journey authorized context source list is invalid')
    const text=(input:unknown,label:string,max=2048)=>{if(typeof input!=='string'||!input||input.length>max)throw Error(`Connected journey authorized context source ${label} is invalid`);return input}
    const digest=(input:unknown)=>{const value=text(input,'digest',71);if(!/^sha256:[a-f0-9]{64}$/.test(value))throw Error('Connected journey authorized context source digest is invalid');return value}
    const ids=new Set<string>()
    return value.items.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Connected journey authorized context source is invalid');const item=raw as Json,ref=item.resource_ref;if(!ref||typeof ref!=='object'||Array.isArray(ref))throw Error('Connected journey authorized context source ResourceRef is invalid');const resource=ref as Json,sourceId=text(item.source_id,'ID',512),version=text(item.source_version,'version',512),classification=text(item.classification,'classification',128),authority=text(resource.authority,'authority',512),resourceType=text(resource.resource_type,'resource type',128),resourceId=text(resource.resource_id,'resource ID'),resourceVersion=text(resource.version,'resource version',512);digest(resource.digest);if(ids.has(sourceId)||item.immutable!==true||item.provider_freshness!=='rechecked_at_packet_create_and_read'||resourceVersion!==version||!['public','internal','confidential','restricted'].includes(classification)||!/^([a-z][a-z0-9+.-]*):[^\s?#]+$/.test(authority)||!/^[a-z][a-z0-9._-]*$/.test(resourceType)||['latest','current','head','working-tree'].includes(version.toLowerCase()))throw Error('Connected journey authorized context source contract is invalid');ids.add(sourceId);return{sourceId,label:resourceId,version,classification}})
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
    return {
      projectId,
      members: memberItems.map(value => { const item = value as Json; return { subject: String(item.subject), role: String(item.role), status: String(item.status) } }),
      workers: (Array.isArray(workers.workers) ? workers.workers : []).map(value => { const item = value as Json; return { workerId: String(item.worker_id), runtimeKind: String(item.runtime_kind), status: String(item.status) } }),
      invitations: mappedInvitations,
      participantDiscoveryAvailable,
      participants: (Array.isArray(participantList.items) ? participantList.items : []).map(value => { const item = value as Json; return { participantId: String(item.participant_id), title: String(item.title), lifecycle: String(item.lifecycle) } }),
      sourceDiscoveryAvailable,
      sources: (Array.isArray(sourceList.items) ? sourceList.items : []).map(value => { const item = value as Json; return { sourceId: String(item.source_id), label: String(item.display_label) } }),
      activeRuns: (Array.isArray(center.active_runs) ? center.active_runs : []).flatMap(value => { const item = value as Json; return item.project_id === projectId && typeof item.run_id === 'string' ? [{ runId: item.run_id, task: String(item.task ?? 'Run'), status: String(item.status), ...this.nativeSelection(item) }] : [] }),
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
    const run = await this.run(runId); if (run.project_id !== projectId) throw Error('Connected journey Run Project mismatch')
    const listing = await this.request(`/api/v2/runs/${encodeURIComponent(runId)}/artifacts`, 'GET'); if (listing.run_id !== runId) throw Error('Connected journey artifact Run mismatch')
    const artifact = (Array.isArray(listing.artifacts) ? listing.artifacts : [])[0] as Json | undefined; if (!artifact) throw Error('This Run has no reviewable artifact.')
    const resource = { project_id: projectId, run_id: runId, artifact_id: String(artifact.artifact_id), digest: String(artifact.content_digest) }
    const content = await new RemoteMalleableShellClient(this.baseUrl, this.user, this.token).content(resource)
    return { runId, status: String(run.status), workerId: String(run.assigned_worker_id ?? 'unassigned'), resource, text: content.text }
  }
}
