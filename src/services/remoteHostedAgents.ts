import type { AgentEvidence } from './remoteAgentProfiles'

// PostgreSQL's hosted external-agent contract is deliberately separate from
// the personal agent-builder/Participant contract.
export interface HostedAgentDefinition {
  title: string
  objective: string
  instructions: string
  sourceId: string
  externalWorkerId: string
  assumptions: string[]
  evidence: AgentEvidence[]
}

export interface HostedAgentProposal {
  proposalId: string
  projectId: string
  definition: HostedAgentDefinition
  definitionDigest: string
  sourceRevision: string
  sourceDigest: string
  workerRegisteredAt: string
  workerRegisteredBy: string
  proposedBy: string
  status: 'proposed' | 'published'
  agentId?: string
  publishedBy?: string
  revision: number
  enabled: boolean
}

export interface HostedAgentOptions {
  projectId: string
  canReview: boolean
  sources: Array<{ sourceId: string; sourceKind: string; revision: string; snapshotDigest: string }>
  workers: Array<{ workerId: string; registeredAt: string; registeredBy: string }>
}

export interface HostedTaskAdmission {
  agentId: string
  taskId: string
  runId: string
  replayed: boolean
}

export interface HostedPendingTask {
  agentId: string
  agentRevision: number
  createdAt: string
  // The task text and credential are never persisted. The user must re-enter
  // the exact text to recover an ambiguous response with the retained key.
  taskDigest: string
  key: string
  confirmed?: HostedTaskAdmission
}

export interface HostedAgentEvent {
  eventId: string
  revision: number
  action: 'proposed' | 'published' | 'paused' | 'enabled'
  actor: string
  recordedAt: string
}

export interface HostedAgentClient {
  options(projectId: string): Promise<HostedAgentOptions>
  list(projectId: string): Promise<HostedAgentProposal[]>
  events(proposalId: string): Promise<HostedAgentEvent[]>
  propose(projectId: string, definition: HostedAgentDefinition): Promise<HostedAgentProposal>
  publish(proposalId: string, expectedDigest: string): Promise<HostedAgentProposal>
  lifecycle(agentId: string, expectedRevision: number, enabled: boolean): Promise<HostedAgentProposal>
  submitTask(projectId: string, agentId: string, revision: number, task: string): Promise<HostedTaskAdmission>
  pendingTask(projectId: string, agentId: string): HostedPendingTask | undefined
  discardPendingTask(projectId: string, agentId: string, expectedKey: string): Promise<void>
}

type WireProposal = Record<string, unknown>
const digestPattern = /^[a-f0-9]{64}$/
const idPattern = /^[A-Za-z0-9._~-]{1,200}$/

export class HostedAgentHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type TaskLocks = {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Hosted agent response is malformed')
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, max = 12_000): string {
  if (typeof value !== 'string' || !value || value.length > max) throw Error(`Hosted agent ${label} is malformed`)
  return value
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !digestPattern.test(value)) throw Error(`Hosted agent ${label} is malformed`)
  return value
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('Hosted agent revision is malformed')
  return value
}

function definition(value: unknown): HostedAgentDefinition {
  const wire = record(value)
  if (wire.harness !== 'external-agent-client' || !Array.isArray(wire.grants) || wire.grants.length !== 0
    || !Array.isArray(wire.memory_source_ids) || wire.memory_source_ids.length !== 0
    || !Array.isArray(wire.assumptions) || !Array.isArray(wire.evidence)
    || wire.assumptions.some(item => typeof item !== 'string')
    || wire.evidence.some(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return true
      const evidence = item as Record<string, unknown>
      return typeof evidence.url !== 'string' || typeof evidence.title !== 'string' || typeof evidence.finding !== 'string'
    })) throw Error('Hosted agent definition would widen authority')
  return {
    title: text(wire.title, 'title', 200), objective: text(wire.objective, 'objective', 4_000),
    instructions: text(wire.instructions, 'instructions'), sourceId: text(wire.source_id, 'source ID', 200),
    externalWorkerId: text(wire.external_worker_id, 'worker ID', 200),
    assumptions: wire.assumptions as string[], evidence: wire.evidence as AgentEvidence[],
  }
}

function proposal(value: unknown, expectedProjectId?: string): HostedAgentProposal {
  const wire: WireProposal = record(value)
  if (wire.schema_version !== 'opensaddle.hosted-agent-proposal.v1') throw Error('Hosted agent proposal schema is malformed')
  const projectId = text(wire.project_id, 'Project ID', 200)
  if (expectedProjectId && projectId !== expectedProjectId) throw Error('Hosted agent Project changed')
  const agentId = wire.agent_id === null ? undefined : wire.agent_id
  const publishedBy = wire.published_by === null ? undefined : wire.published_by
  if ((wire.status === 'published') !== (typeof agentId === 'string')
    || !['proposed', 'published'].includes(String(wire.status))
    || typeof wire.enabled !== 'boolean'
    || (publishedBy !== undefined && typeof publishedBy !== 'string')) throw Error('Hosted agent lifecycle is malformed')
  return {
    proposalId: text(wire.proposal_id, 'proposal ID', 200), projectId,
    definition: definition(wire.definition), definitionDigest: digest(wire.definition_digest, 'definition digest'),
    sourceRevision: text(wire.source_revision, 'source revision', 200),
    sourceDigest: digest(wire.source_digest, 'source digest'),
    workerRegisteredAt: text(wire.external_worker_registered_at, 'worker enrollment time', 100),
    workerRegisteredBy: text(wire.external_worker_registered_by, 'worker issuer', 200),
    proposedBy: text(wire.proposed_by, 'proposer', 200),
    status: wire.status as 'proposed' | 'published',
    ...(typeof agentId === 'string' ? { agentId: text(agentId, 'agent ID', 200) } : {}),
    ...(typeof publishedBy === 'string' ? { publishedBy } : {}),
    revision: revision(wire.revision), enabled: wire.enabled as boolean,
  }
}

async function taskDigest(projectId: string, agentId: string, revision: number, task: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw Error('A secure task fingerprint is unavailable')
  const input = new TextEncoder().encode(JSON.stringify([projectId, agentId, revision, task]))
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export class RemoteHostedAgentClient implements HostedAgentClient {
  private readonly baseUrl: string
  private readonly subject: string
  private readonly getSubject: () => string
  private readonly token?: string
  private readonly fetchImplementation: typeof fetch
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  private readonly locks?: TaskLocks

  constructor(baseUrl: string, getSubject: () => string,
    token?: string,
    fetchImplementation: typeof fetch = (input, init) => globalThis.fetch(input, init),
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    locks?: TaskLocks) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getSubject = getSubject
    this.token = token
    this.fetchImplementation = fetchImplementation
    this.storage = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
    this.locks = locks ?? (typeof navigator !== 'undefined' ? navigator.locks : undefined)
    this.subject = getSubject()
    if (!this.subject) throw Error('Authenticated hosted-agent subject is unavailable')
  }

  private storageKey(projectId: string, agentId: string): string {
    return `opensaddle.hosted-task.v1:${encodeURIComponent(this.baseUrl)}:${encodeURIComponent(this.subject)}:${encodeURIComponent(projectId)}:${encodeURIComponent(agentId)}`
  }

  private retainedStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    if (!this.storage) throw Error('Durable hosted task retry storage is unavailable')
    return this.storage
  }

  private withTaskLock<T>(projectId: string, agentId: string, operation: () => Promise<T>): Promise<T> {
    if (!this.locks) throw Error('Cross-window hosted task coordination is unavailable')
    return this.locks.request(this.storageKey(projectId, agentId), { mode: 'exclusive' }, operation)
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (this.getSubject() !== this.subject) throw Error('Hosted-agent account changed; reload the Project')
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'X-OpenSaddle-User': this.subject,
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...init.headers },
    })
    if (this.getSubject() !== this.subject) throw Error('Hosted-agent account changed; reload the Project')
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: unknown } | null
      throw new HostedAgentHttpError(response.status,
        typeof body?.detail === 'string' ? body.detail : `OpenSaddle HTTP ${response.status}`)
    }
    const value = await response.json() as T
    if (this.getSubject() !== this.subject) throw Error('Hosted-agent account changed; reload the Project')
    return value
  }

  async options(projectId: string): Promise<HostedAgentOptions> {
    const root = `/api/v2/projects/${encodeURIComponent(projectId)}`
    const [sourcesRaw, workersRaw, membersRaw] = await Promise.all([
      this.request<unknown>(`${root}/sources?limit=100`),
      this.request<unknown>(`${root}/workers`),
      this.request<unknown>(`${root}/members`),
    ])
    const sources = record(sourcesRaw), workers = record(workersRaw), members = record(membersRaw)
    if (sources.schema_version !== 'opensaddle.source-list.v1' || sources.project_id !== projectId
      || !Array.isArray(sources.items) || sources.items.length > 100
      || workers.schema_version !== 'project-workers.v1' || workers.project_id !== projectId
      || !Array.isArray(workers.workers)
      || members.schema_version !== 'project-members.v1' || members.project_id !== projectId
      || typeof members.viewer_can_manage !== 'boolean' || members.viewer_subject !== this.subject)
      throw Error('Hosted agent Project options are malformed')
    return {
      projectId, canReview: members.viewer_can_manage,
      sources: sources.items.map((item: unknown) => {
        const source = record(item)
        return { sourceId: text(source.source_id, 'source ID', 200),
          sourceKind: text(source.source_kind, 'source kind', 200),
          revision: text(source.revision, 'source revision', 200),
          snapshotDigest: digest(source.snapshot_digest, 'source digest') }
      }),
      workers: workers.workers.flatMap((item: unknown) => {
        const worker = record(item)
        if (worker.runtime_kind !== 'remote_worker') return []
        if (!Array.isArray(worker.project_ids) || !worker.project_ids.includes(projectId))
          throw Error('Hosted agent worker Project is malformed')
        return [{ workerId: text(worker.worker_id, 'worker ID', 200),
          registeredAt: text(worker.registered_at, 'worker enrollment time', 100),
          registeredBy: text(worker.registered_by, 'worker issuer', 200) }]
      }),
    }
  }

  async list(projectId: string): Promise<HostedAgentProposal[]> {
    const value = record(await this.request<unknown>(`/api/v2/projects/${encodeURIComponent(projectId)}/hosted-agent-proposals`))
    if (value.schema_version !== 'opensaddle.hosted-agent-list.v1' || value.project_id !== projectId
      || !Array.isArray(value.items) || value.items.length > 100) throw Error('Hosted agent proposal list is malformed')
    return value.items.map(item => proposal(item, projectId))
  }

  async events(proposalId: string): Promise<HostedAgentEvent[]> {
    const value = record(await this.request<unknown>(`/api/v2/hosted-agent-proposals/${encodeURIComponent(proposalId)}/events`))
    if (value.schema_version !== 'opensaddle.hosted-agent-events.v1' || value.proposal_id !== proposalId
      || !Array.isArray(value.items) || value.items.length > 100) throw Error('Hosted agent audit is malformed')
    return value.items.map(item => {
      const event = record(item)
      if (!['proposed', 'published', 'paused', 'enabled'].includes(String(event.action)))
        throw Error('Hosted agent audit is malformed')
      return { eventId: text(event.event_id, 'audit event ID', 200), revision: revision(event.revision),
        action: event.action as HostedAgentEvent['action'], actor: text(event.actor, 'audit actor', 200),
        recordedAt: text(event.recorded_at, 'audit time', 100) }
    })
  }

  async propose(projectId: string, value: HostedAgentDefinition): Promise<HostedAgentProposal> {
    return proposal(await this.request<unknown>(`/api/v2/projects/${encodeURIComponent(projectId)}/hosted-agent-proposals`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition: {
        title: value.title, objective: value.objective, instructions: value.instructions,
        source_id: value.sourceId, harness: 'external-agent-client', external_worker_id: value.externalWorkerId,
        grants: [], memory_source_ids: [], assumptions: value.assumptions, evidence: value.evidence,
      } }),
    }), projectId)
  }

  async publish(proposalId: string, expectedDigest: string): Promise<HostedAgentProposal> {
    return proposal(await this.request<unknown>(`/api/v2/hosted-agent-proposals/${encodeURIComponent(proposalId)}/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_digest: expectedDigest }),
    }))
  }

  async lifecycle(agentId: string, expectedRevision: number, enabled: boolean): Promise<HostedAgentProposal> {
    return proposal(await this.request<unknown>(`/api/v2/hosted-agents/${encodeURIComponent(agentId)}/lifecycle`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: expectedRevision, enabled }),
    }))
  }

  pendingTask(projectId: string, agentId: string): HostedPendingTask | undefined {
    const raw = this.retainedStorage().getItem(this.storageKey(projectId, agentId))
    if (!raw) return undefined
    try {
      const value = record(JSON.parse(raw))
      if (value.agentId !== agentId || !Number.isSafeInteger(value.agentRevision) || Number(value.agentRevision) < 1
        || typeof value.createdAt !== 'string' || typeof value.taskDigest !== 'string' || !digestPattern.test(value.taskDigest)
        || typeof value.key !== 'string' || !idPattern.test(value.key)
        || (value.confirmed !== undefined && (!value.confirmed || typeof value.confirmed !== 'object'
          || Array.isArray(value.confirmed) || (value.confirmed as HostedTaskAdmission).agentId !== agentId
          || typeof (value.confirmed as HostedTaskAdmission).taskId !== 'string'
          || !idPattern.test((value.confirmed as HostedTaskAdmission).taskId)
          || typeof (value.confirmed as HostedTaskAdmission).runId !== 'string'
          || !idPattern.test((value.confirmed as HostedTaskAdmission).runId)
          || typeof (value.confirmed as HostedTaskAdmission).replayed !== 'boolean'))) throw Error('invalid')
      return value as unknown as HostedPendingTask
    } catch { throw Error('Retained hosted task intent is unreadable; no new task will be submitted') }
  }

  async discardPendingTask(projectId: string, agentId: string, expectedKey: string): Promise<void> {
    await this.withTaskLock(projectId, agentId, async () => {
      const current = this.pendingTask(projectId, agentId)
      if (!current || current.key !== expectedKey) throw Error('Hosted task retry intent changed; refresh before setting it aside')
      this.retainedStorage().removeItem(this.storageKey(projectId, agentId))
    })
  }

  async submitTask(projectId: string, agentId: string, agentRevision: number, task: string): Promise<HostedTaskAdmission> {
    if (!idPattern.test(projectId) || !idPattern.test(agentId) || !Number.isSafeInteger(agentRevision) || agentRevision < 1
      || !task.trim() || task.length > 12_000) throw Error('Hosted agent task intent is invalid')
    const fingerprint = await taskDigest(projectId, agentId, agentRevision, task)
    return this.withTaskLock(projectId, agentId, async () => {
      let pending = this.pendingTask(projectId, agentId)
      if (pending && (pending.agentRevision !== agentRevision || pending.taskDigest !== fingerprint))
        throw Error('A prior hosted task may already have been admitted. Re-enter that exact task to retry, or explicitly set aside its retry key before starting independent work.')
      if (!pending) {
        if (!globalThis.crypto?.randomUUID) throw Error('A secure task retry key is unavailable')
        pending = { agentId, agentRevision, taskDigest: fingerprint, key: globalThis.crypto.randomUUID(),
          createdAt: new Date().toISOString() }
        this.retainedStorage().setItem(this.storageKey(projectId, agentId), JSON.stringify(pending))
        // Storage failure must stop before the Core side effect.
        if (this.pendingTask(projectId, agentId)?.key !== pending.key) throw Error('Hosted task retry key was not retained')
      }
      const value = record(await this.request<unknown>(`/api/v2/hosted-agents/${encodeURIComponent(agentId)}/tasks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key },
        body: JSON.stringify({ expected_agent_revision: agentRevision, task }),
      }))
      if (value.schema_version !== 'opensaddle.hosted-agent-task.v1' || value.agent_id !== agentId
        || typeof value.task_id !== 'string' || !idPattern.test(value.task_id)
        || typeof value.run_id !== 'string' || !idPattern.test(value.run_id)
        || typeof value.replayed !== 'boolean') throw Error('Hosted agent task admission is malformed')
      if (this.getSubject() !== this.subject) throw Error('Hosted-agent account changed; reload the Project')
      const current = this.pendingTask(projectId, agentId)
      const admission = { agentId, taskId: value.task_id, runId: value.run_id, replayed: value.replayed }
      if (current?.key === pending.key && current.taskDigest === fingerprint)
        this.retainedStorage().setItem(this.storageKey(projectId, agentId), JSON.stringify({ ...current, confirmed: admission }))
      return admission
    })
  }
}
