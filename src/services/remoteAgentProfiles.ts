export type AgentHarness = 'codex-app-server' | 'claude-code-stream-json' | 'cursor-agent-cli'

export interface AgentGrant {
  connector: string
  action: string
  argumentEquals: Record<string, string | number | boolean>
  rationale: string
}

export interface AgentEvidence {
  url: string
  title: string
  finding: string
}

export interface AgentDefinition {
  title: string
  objective: string
  instructions: string
  sourceId: string
  harness: AgentHarness
  grants: AgentGrant[]
  assumptions: string[]
  evidence: AgentEvidence[]
}

export interface AgentProposal {
  proposalId: string
  projectId: string
  definitionDigest: string
  definition: AgentDefinition
  status: 'proposed' | 'published'
  publishedAt?: string
  reviewedBy?: string
  participantId?: string
}

export interface AgentTaskAdmission {
  messageId: string
  participantId: string
  projectId: string
  runId: string
  status: string
  participantRevision: number
  replayed: boolean
}

export interface AgentBuilderOptions {
  executionAvailable: boolean
  canReview: boolean
  sources: Array<{ sourceId: string; sourceKind: string; revision: string; snapshotDigest: string }>
  harnesses: AgentHarness[]
  connectorActions: Array<{ connector: string; action: string; title: string; input: { required?: string[]; properties?: Record<string, { type?: string; title?: string; description?: string; enum?: Array<string | number | boolean>; minimum?: number; maximum?: number; min_length?: number; max_length?: number; pattern?: string }> } }>
}

export interface AgentParticipant { projectId: string; revision: number; lifecycle: string }

export interface AgentProfileClient {
  options(projectId: string): Promise<AgentBuilderOptions>
  participant(participantId: string): Promise<AgentParticipant>
  list(projectId: string): Promise<AgentProposal[]>
  propose(projectId: string, definition: AgentDefinition): Promise<AgentProposal>
  publish(proposalId: string, expectedDigest: string): Promise<AgentProposal>
  submitTask(participantId: string, expectedParticipantRevision: number, task: string, idempotencyKey: string): Promise<AgentTaskAdmission>
}

type WireDefinition = {
  title: string
  objective: string
  instructions: string
  source_id: string
  harness: AgentHarness
  grants: Array<{ connector: string; action: string; argument_equals: Record<string, string | number | boolean>; rationale: string }>
  assumptions: string[]
  evidence: AgentEvidence[]
}

type WireProposal = {
  proposal_id: string
  project_id: string
  definition_digest: string
  definition: WireDefinition
  status: 'proposed' | 'published'
  published_at?: string | null
  reviewed_by?: string | null
  participant_id?: string | null
}

type WireTaskAdmission = {
  schema_version: 'opensaddle.participant-message.v1'
  message_id: string
  participant_id: string
  project_id: string
  run_id: string
  status: string
  participant_revision: number
  replayed: boolean
}

function proposal(value: WireProposal): AgentProposal {
  return {
    proposalId: value.proposal_id,
    projectId: value.project_id,
    definitionDigest: value.definition_digest,
    definition: {
      title: value.definition.title,
      objective: value.definition.objective,
      instructions: value.definition.instructions,
      sourceId: value.definition.source_id,
      harness: value.definition.harness,
      grants: value.definition.grants.map((grant) => ({
        connector: grant.connector,
        action: grant.action,
        argumentEquals: grant.argument_equals,
        rationale: grant.rationale,
      })),
      assumptions: value.definition.assumptions,
      evidence: value.definition.evidence,
    },
    status: value.status,
    publishedAt: value.published_at ?? undefined,
    reviewedBy: value.reviewed_by ?? undefined,
    participantId: value.participant_id ?? undefined,
  }
}

function wireDefinition(value: AgentDefinition): WireDefinition {
  return {
    title: value.title,
    objective: value.objective,
    instructions: value.instructions,
    source_id: value.sourceId,
    harness: value.harness,
    grants: value.grants.map((grant) => ({
      connector: grant.connector,
      action: grant.action,
      argument_equals: grant.argumentEquals,
      rationale: grant.rationale,
    })),
    assumptions: value.assumptions,
    evidence: value.evidence,
  }
}

export class RemoteAgentProfileClient implements AgentProfileClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string
  private readonly fetchImplementation: typeof fetch

  constructor(baseUrl: string, getUserId: () => string, token?: string,
              fetchImplementation: typeof fetch = (input, init) => globalThis.fetch(input, init)) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getUserId = getUserId
    this.token = token
    this.fetchImplementation = fetchImplementation
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'X-OpenSaddle-User': this.getUserId(),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...init.headers,
      },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: unknown } | null
      throw new Error(typeof body?.detail === 'string' ? body.detail : `OpenSaddle HTTP ${response.status}`)
    }
    return await response.json() as T
  }

  async options(projectId: string): Promise<AgentBuilderOptions> {
    const value = await this.request<{
      schema_version: string; project_id: string; execution_available: boolean; can_review: boolean
      sources: Array<{ source_id: string; source_kind: string; revision: string; snapshot_digest: string }>
      harnesses: AgentHarness[]
      connector_actions: AgentBuilderOptions['connectorActions']
    }>(`/api/v2/projects/${encodeURIComponent(projectId)}/agent-builder-options`)
    if (value.schema_version !== 'opensaddle.agent-builder-options.v1' || value.project_id !== projectId
        || !Array.isArray(value.sources) || !Array.isArray(value.harnesses) || !Array.isArray(value.connector_actions)) {
      throw new Error('Agent builder options response is malformed')
    }
    return {
      executionAvailable: value.execution_available === true,
      canReview: value.can_review === true,
      sources: value.sources.map((source) => ({ sourceId: source.source_id, sourceKind: source.source_kind,
        revision: source.revision, snapshotDigest: source.snapshot_digest })),
      harnesses: value.harnesses,
      connectorActions: value.connector_actions,
    }
  }

  async participant(participantId: string): Promise<AgentParticipant> {
    const value = await this.request<{ project_id?: string; revision?: number; lifecycle?: string }>(`/api/v2/participants/${encodeURIComponent(participantId)}`)
    if (typeof value.project_id !== 'string' || !Number.isSafeInteger(value.revision) || typeof value.lifecycle !== 'string') {
      throw new Error('Agent participant response is malformed')
    }
    return { projectId: value.project_id, revision: value.revision!, lifecycle: value.lifecycle }
  }

  async list(projectId: string): Promise<AgentProposal[]> {
    const response = await this.request<{ schema_version: string; items: WireProposal[] }>(`/api/v2/projects/${encodeURIComponent(projectId)}/agent-proposals`)
    if (response.schema_version !== 'opensaddle.agent-proposal-list.v1' || !Array.isArray(response.items)) throw new Error('Agent proposal response is malformed')
    return response.items.map(proposal)
  }

  async propose(projectId: string, definition: AgentDefinition): Promise<AgentProposal> {
    return proposal(await this.request<WireProposal>(`/api/v2/projects/${encodeURIComponent(projectId)}/agent-proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wireDefinition(definition)),
    }))
  }

  async publish(proposalId: string, expectedDigest: string): Promise<AgentProposal> {
    return proposal(await this.request<WireProposal>(`/api/v2/agent-proposals/${encodeURIComponent(proposalId)}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_digest: expectedDigest, acknowledge_assumptions: true }),
    }))
  }

  async submitTask(participantId: string, expectedParticipantRevision: number, task: string, idempotencyKey: string): Promise<AgentTaskAdmission> {
    const response = await this.request<WireTaskAdmission>(`/api/v2/agents/${encodeURIComponent(participantId)}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ expected_participant_revision: expectedParticipantRevision, task }),
    })
    if (response.schema_version !== 'opensaddle.participant-message.v1') throw new Error('Agent task response is malformed')
    return {
      messageId: response.message_id,
      participantId: response.participant_id,
      projectId: response.project_id,
      runId: response.run_id,
      status: response.status,
      participantRevision: response.participant_revision,
      replayed: response.replayed,
    }
  }
}
