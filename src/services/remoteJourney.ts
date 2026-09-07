import { RemoteMalleableShellClient } from './remoteMalleableShell'

type Json = Record<string, unknown>

export class RemoteJourneyClient {
  private readonly baseUrl: string
  private readonly user: () => string
  private readonly token?: string
  private readonly capacityAvailable: boolean
  constructor(baseUrl: string, user: () => string, token?: string, capacityAvailable = false) { this.baseUrl = baseUrl; this.user = user; this.token = token; this.capacityAvailable = capacityAvailable }

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
  delegate(projectId: string, sourceId: string, task: string) { return this.createRun({ projectId, sourceId, task }) }
  run(runId: string) { return this.request(`/api/v2/runs/${encodeURIComponent(runId)}`, 'GET') }
  cancel(runId: string) { return this.request(`/api/v2/runs/${encodeURIComponent(runId)}/cancel`, 'POST', {}) }
  configureCapacity(projectId: string, limits: { cpuMillicores: number; memoryMiB: number; maxConcurrency: number }) { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/capacity-limits`, 'PUT', { cpu_millicores: limits.cpuMillicores, memory_mib: limits.memoryMiB, max_concurrency: limits.maxConcurrency }) }

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

  async snapshot(projectId: string) {
    const invitations = await this.invitations(projectId).catch(() => ({ project_id: projectId, invitations: [] }))
    if (invitations.project_id !== projectId) throw Error('Connected journey Project identity mismatch')
    const mappedInvitations = (Array.isArray(invitations.invitations) ? invitations.invitations : []).map(value => { const item = value as Json; return { invitationId: String(item.invitation_id), recipientSubject: String(item.recipient_subject), status: String(item.status), revision: Number(item.revision), expiresAt: String(item.expires_at) } })
    let members: Json, workers: Json, center: Json
    try { [members, workers, center] = await Promise.all([this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/members`, 'GET'), this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/workers`, 'GET'), this.request('/api/v2/command-center', 'GET')]) }
    catch (reason) { if (mappedInvitations.some(item => item.status === 'pending')) return { projectId, members: [], workers: [], invitations: mappedInvitations, rosterAvailable: false, canManage: false, currentSubject: this.user() }; throw reason }
    if (members.project_id !== projectId || workers.project_id !== projectId) throw Error('Connected journey Project identity mismatch')
    let participantDiscoveryAvailable = true, sourceDiscoveryAvailable = true
    let capacityError: string | undefined
    const [participantList, sourceList, capacity] = await Promise.all([
      this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/participants?limit=100`, 'GET').catch(() => { participantDiscoveryAvailable = false; return { items: [] } }),
      this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/sources?limit=100`, 'GET').catch(() => { sourceDiscoveryAvailable = false; return { items: [] } }),
      this.capacity(projectId).catch(reason => { capacityError = reason instanceof Error ? reason.message : String(reason); return undefined }),
    ])
    if ((participantDiscoveryAvailable && (!('project_id' in participantList) || participantList.project_id !== projectId)) || (sourceDiscoveryAvailable && (!('project_id' in sourceList) || sourceList.project_id !== projectId))) throw Error('Connected journey discovery Project identity mismatch')
    const memberItems = Array.isArray(members.members) ? members.members : []
    const outcomes = (Array.isArray(center.outcomes) ? center.outcomes : []).flatMap(value => { const item = value as Json; return item.project_id === projectId && typeof item.run_id === 'string' ? [{ runId: item.run_id, fallbackTitle: String(item.title), verified: item.verified === true }] : [] })
    const results = await Promise.all(outcomes.map(async outcome => {
      const detail = await this.run(outcome.runId)
      if (detail.project_id !== projectId || detail.run_id !== outcome.runId) throw Error('Connected journey result Run identity mismatch')
      return { runId: outcome.runId, title: typeof detail.task === 'string' ? detail.task : outcome.fallbackTitle, verified: outcome.verified, workerId: typeof detail.assigned_worker_id === 'string' ? detail.assigned_worker_id : undefined, status: typeof detail.status === 'string' ? detail.status : undefined, updatedAt: typeof detail.updated_at === 'string' ? detail.updated_at : undefined }
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
      activeRuns: (Array.isArray(center.active_runs) ? center.active_runs : []).flatMap(value => { const item = value as Json; return item.project_id === projectId && typeof item.run_id === 'string' ? [{ runId: item.run_id, task: String(item.task ?? 'Run'), status: String(item.status) }] : [] }),
      results,
      rosterAvailable: true,
      currentSubject: this.user(),
      canManage: memberItems.some(value => { const item = value as Json; return item.subject === this.user() && (item.role === 'owner' || item.role === 'admin') }),
      capacityAvailable: this.capacityAvailable,
      capacity,
      capacityError,
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
