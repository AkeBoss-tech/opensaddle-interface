export type AgentHarness = 'codex-app-server' | 'claude-code-stream-json' | 'cursor-agent-cli' | 'external-agent-client'

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
  externalWorkerId?: string
  grants: AgentGrant[]
  memorySourceIds: string[]
  assumptions: string[]
  evidence: AgentEvidence[]
}

export interface AgentMemorySource {
  sourceId: string
  classification: string
  sourceVersion: string
  resourceRef: {
    authority: string
    contract: string
    resource_id: string
    resource_type: string
    version: string
    digest: string
  }
  immutable: boolean
  providerFreshness: string
}

export interface AgentMemoryBinding {
  sourceRecordDigest: string
  resourceRecordDigest: string
  resourceRef: AgentMemorySource['resourceRef']
  classification: string
}

export interface AgentProposal {
  proposalId: string
  projectId: string
  definitionDigest: string
  definition: AgentDefinition
  memoryBindings: Record<string, AgentMemoryBinding>
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
  researchAvailable: boolean
  researchProvider: string | null
  researchScope: 'web' | 'mediawiki_documentation' | null
  memoryAvailable: boolean
  memorySources: AgentMemorySource[]
  sources: Array<{ sourceId: string; sourceKind: string; revision: string; snapshotDigest: string }>
  harnesses: AgentHarness[]
  externalWorkers: Array<{ workerId: string; credentialState: 'active' | 'revoked' | 'unavailable' }>
  connectorActions: Array<{ connector: string; action: string; title: string; input: { required?: string[]; properties?: Record<string, { type?: string; title?: string; description?: string; enum?: Array<string | number | boolean>; minimum?: number; maximum?: number; min_length?: number; max_length?: number; pattern?: string }> } }>
}

export interface AgentResearchRequest {
  objective: string
  sourceId: string
  harness: AgentHarness
  queries: string[]
  candidateConnectorIds: string[]
  resultsPerQuery: number
}

export interface AgentResearchObservation {
  url: string
  title: string
  excerpt: string
  query: string
  provider: string
  retrievedFrom: string
  checkedAt: string
  contentBasis: 'search_index_excerpt_unverified_at_page'
  trust: 'untrusted_external_content'
}

export interface AgentResearchIdea {
  connectorId: string
  name: string
  status: 'installed_read_action' | 'catalog_research_only' | 'unavailable'
  installedReadActions: Array<{ action: string; title: string }>
  catalogSourceUrls: string[]
  selectionBasis: 'request_selection' | 'lexical_catalog_match'
  grantProposed: false
}

export interface AgentResearchDossier {
  checkedAt: string
  adapter: string
  observations: AgentResearchObservation[]
  capabilityIdeas: AgentResearchIdea[]
  draftDefinition: AgentDefinition
  reviewRequired: true
}

export interface AgentParticipant { projectId: string; revision: number; lifecycle: string }

export interface AgentProfileClient {
  options(projectId: string): Promise<AgentBuilderOptions>
  research(projectId: string, request: AgentResearchRequest): Promise<AgentResearchDossier>
  participant(participantId: string): Promise<AgentParticipant>
  list(projectId: string): Promise<AgentProposal[]>
  propose(projectId: string, definition: AgentDefinition): Promise<AgentProposal>
  publish(proposalId: string, expectedDigest: string): Promise<AgentProposal>
  submitTask(participantId: string, expectedParticipantRevision: number, task: string, idempotencyKey: string, authorizedContextSourceIds: string[]): Promise<AgentTaskAdmission>
}

type WireDefinition = {
  title: string
  objective: string
  instructions: string
  source_id: string
  harness: AgentHarness
  external_worker_id?: string | null
  grants: Array<{ connector: string; action: string; argument_equals: Record<string, string | number | boolean>; rationale: string }>
  memory_source_ids?: string[]
  assumptions: string[]
  evidence: AgentEvidence[]
}

type WireProposal = {
  proposal_id: string
  project_id: string
  definition_digest: string
  definition: WireDefinition
  memory_bindings?: Record<string, { source_record_digest: string; resource_record_digest: string; resource_ref: AgentMemorySource['resourceRef']; classification: string }>
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

type WireResearchDossier = {
  schema_version: string
  status: string
  adapter: string
  checked_at: string
  observations: Array<{
    url: string; title: string; excerpt: string; query: string; provider: string
    retrieved_from: string; checked_at: string; content_basis: string; trust: string
  }>
  capability_ideas: Array<{
    connector_id: string; name: string; status: AgentResearchIdea['status']
    installed_read_actions: Array<{ action: string; title: string }>
    catalog_source_urls: string[]; selection_basis: AgentResearchIdea['selectionBasis']; grant_proposed: boolean
  }>
  draft_definition: WireDefinition
  review_required: boolean
}

function isHttpsUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false
  try {
    const value = new URL(url)
    return value.protocol === 'https:' && !value.username && !value.password && Boolean(value.hostname)
  } catch { return false }
}

const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)

function isResourceRef(value: unknown): value is AgentMemorySource['resourceRef'] {
  if (!value || typeof value !== 'object') return false
  const ref = value as AgentMemorySource['resourceRef']
  return typeof ref.authority === 'string' && typeof ref.contract === 'string'
    && typeof ref.resource_id === 'string'
    && typeof ref.resource_type === 'string' && typeof ref.version === 'string'
    && Boolean(ref.authority && ref.contract && ref.resource_id && ref.resource_type && ref.version)
    && typeof ref.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(ref.digest)
}

function memorySource(value: unknown): AgentMemorySource {
  if (!value || typeof value !== 'object') throw Error('Agent memory source response is malformed')
  const item = value as Record<string, unknown>
  if (typeof item.source_id !== 'string' || !item.source_id || typeof item.classification !== 'string'
      || typeof item.source_version !== 'string' || !item.source_version || !isResourceRef(item.resource_ref)
      || item.immutable !== true || typeof item.provider_freshness !== 'string') {
    throw Error('Agent memory source response is malformed')
  }
  return { sourceId: item.source_id, classification: item.classification,
    sourceVersion: item.source_version, resourceRef: item.resource_ref,
    immutable: true, providerFreshness: item.provider_freshness }
}

function proposal(value: WireProposal): AgentProposal {
  const externalWorkerId=value.definition.external_worker_id
  if(value.definition.harness==='external-agent-client'
    ? typeof externalWorkerId!=='string'||!externalWorkerId||externalWorkerId.length>200
    : externalWorkerId!==undefined&&externalWorkerId!==null)throw Error('Agent proposal external worker binding is malformed')
  const memorySourceIds = value.definition.memory_source_ids ?? []
  const rawBindings = value.memory_bindings ?? {}
  if (!Array.isArray(memorySourceIds) || memorySourceIds.length > 8
      || memorySourceIds.some((id) => typeof id !== 'string' || !id)
      || new Set(memorySourceIds).size !== memorySourceIds.length
      || !rawBindings || typeof rawBindings !== 'object' || Array.isArray(rawBindings)
      || Object.keys(rawBindings).length !== memorySourceIds.length
      || memorySourceIds.some((id) => {
        const binding = rawBindings[id]
        return !binding || !isDigest(binding.source_record_digest) || !isDigest(binding.resource_record_digest)
          || !isResourceRef(binding.resource_ref) || typeof binding.classification !== 'string'
      })) throw Error('Agent proposal memory bindings are malformed')
  const memoryBindings = Object.fromEntries(memorySourceIds.map((id) => {
    const binding = rawBindings[id]
    return [id, { sourceRecordDigest: binding.source_record_digest,
      resourceRecordDigest: binding.resource_record_digest,
      resourceRef: binding.resource_ref, classification: binding.classification }]
  }))
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
      ...(typeof externalWorkerId==='string'?{externalWorkerId}:{}),
      grants: value.definition.grants.map((grant) => ({
        connector: grant.connector,
        action: grant.action,
        argumentEquals: grant.argument_equals,
        rationale: grant.rationale,
      })),
      memorySourceIds,
      assumptions: value.definition.assumptions,
      evidence: value.definition.evidence,
    },
    memoryBindings,
    status: value.status,
    publishedAt: value.published_at ?? undefined,
    reviewedBy: value.reviewed_by ?? undefined,
    participantId: value.participant_id ?? undefined,
  }
}

function wireDefinition(value: AgentDefinition): WireDefinition {
  if(value.harness==='external-agent-client'
    ? typeof value.externalWorkerId!=='string'||!value.externalWorkerId||value.externalWorkerId.length>200
    : value.externalWorkerId!==undefined)throw Error('Agent definition external worker binding is invalid')
  return {
    title: value.title,
    objective: value.objective,
    instructions: value.instructions,
    source_id: value.sourceId,
    harness: value.harness,
    ...(value.harness==='external-agent-client'?{external_worker_id:value.externalWorkerId}:{}),
    grants: value.grants.map((grant) => ({
      connector: grant.connector,
      action: grant.action,
      argument_equals: grant.argumentEquals,
      rationale: grant.rationale,
    })),
    memory_source_ids: value.memorySourceIds,
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
      research_available?: boolean; research_provider?: string | null; research_scope?: 'web' | 'mediawiki_documentation' | null
      memory_available?: boolean; memory_sources?: unknown[]
      sources: Array<{ source_id: string; source_kind: string; revision: string; snapshot_digest: string }>
      harnesses: AgentHarness[]
      external_workers?: Array<{ worker_id:string; credential_state:string }>
      connector_actions: AgentBuilderOptions['connectorActions']
    }>(`/api/v2/projects/${encodeURIComponent(projectId)}/agent-builder-options`)
    if (value.schema_version !== 'opensaddle.agent-builder-options.v1' || value.project_id !== projectId
        || !Array.isArray(value.sources) || !Array.isArray(value.harnesses) || !Array.isArray(value.connector_actions)
        || value.harnesses.some(harness=>!['codex-app-server','claude-code-stream-json','cursor-agent-cli','external-agent-client'].includes(harness))
        || (value.memory_sources !== undefined && !Array.isArray(value.memory_sources))
        || (value.external_workers !== undefined && !Array.isArray(value.external_workers))
        || (value.external_workers?.length??0)>10000
        || (value.harnesses.includes('external-agent-client') && !Array.isArray(value.external_workers))) {
      throw new Error('Agent builder options response is malformed')
    }
    const externalWorkers=(value.external_workers??[]).map((worker)=>{
      if(!worker||typeof worker.worker_id!=='string'||!worker.worker_id||worker.worker_id.length>200
        || !['active','revoked','unavailable'].includes(worker.credential_state))throw Error('Agent external worker options response is malformed')
      return {workerId:worker.worker_id,credentialState:worker.credential_state as 'active'|'revoked'|'unavailable'}
    })
    if(new Set(externalWorkers.map(worker=>worker.workerId)).size!==externalWorkers.length)throw Error('Agent external worker options response is malformed')
    return {
      executionAvailable: value.execution_available === true,
      canReview: value.can_review === true,
      researchAvailable: value.research_available === true,
      researchProvider: typeof value.research_provider === 'string' ? value.research_provider : null,
      researchScope: value.research_scope === 'web' || value.research_scope === 'mediawiki_documentation' ? value.research_scope : null,
      memoryAvailable: value.memory_available === true,
      memorySources: (value.memory_sources ?? []).map(memorySource),
      sources: value.sources.map((source) => ({ sourceId: source.source_id, sourceKind: source.source_kind,
        revision: source.revision, snapshotDigest: source.snapshot_digest })),
      harnesses: value.harnesses,
      externalWorkers,
      connectorActions: value.connector_actions,
    }
  }

  async research(projectId: string, request: AgentResearchRequest): Promise<AgentResearchDossier> {
    if(request.harness==='external-agent-client')throw Error('Online research is unavailable for external agents')
    const value = await this.request<WireResearchDossier>(`/api/v2/projects/${encodeURIComponent(projectId)}/agent-research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective: request.objective, source_id: request.sourceId, harness: request.harness,
        queries: request.queries, candidate_connector_ids: request.candidateConnectorIds,
        results_per_query: request.resultsPerQuery }),
    })
    if (value.schema_version !== 'opensaddle.agent-research.v1' || value.status !== 'draft_unpublished'
        || value.review_required !== true || !Array.isArray(value.observations) || !Array.isArray(value.capability_ideas)
        || !value.draft_definition || value.draft_definition.source_id !== request.sourceId
        || value.draft_definition.harness !== request.harness || !Array.isArray(value.draft_definition.grants)
        || value.draft_definition.grants.length !== 0 || !Array.isArray(value.draft_definition.evidence)
        || (value.draft_definition.memory_source_ids !== undefined
          && (!Array.isArray(value.draft_definition.memory_source_ids)
            || value.draft_definition.memory_source_ids.length !== 0))
        || !value.draft_definition.evidence.every((item) => isHttpsUrl(item.url))
        || !value.observations.every((item) => isHttpsUrl(item.url) && isHttpsUrl(item.retrieved_from)
          && item.content_basis === 'search_index_excerpt_unverified_at_page' && item.trust === 'untrusted_external_content')
        || !value.capability_ideas.every((item) => item.grant_proposed === false)) {
      throw new Error('Agent research response is malformed or would widen authority')
    }
    return {
      adapter: value.adapter, checkedAt: value.checked_at, reviewRequired: true,
      observations: value.observations.map((item) => ({ url: item.url, title: item.title, excerpt: item.excerpt,
        query: item.query, provider: item.provider, retrievedFrom: item.retrieved_from,
        checkedAt: item.checked_at, contentBasis: 'search_index_excerpt_unverified_at_page', trust: 'untrusted_external_content' })),
      capabilityIdeas: value.capability_ideas.map((item) => ({ connectorId: item.connector_id, name: item.name,
        status: item.status, installedReadActions: item.installed_read_actions,
        catalogSourceUrls: item.catalog_source_urls, selectionBasis: item.selection_basis, grantProposed: false })),
      draftDefinition: { title: value.draft_definition.title, objective: value.draft_definition.objective,
        instructions: value.draft_definition.instructions, sourceId: value.draft_definition.source_id,
        harness: value.draft_definition.harness, grants: [], memorySourceIds: [], assumptions: value.draft_definition.assumptions,
        evidence: value.draft_definition.evidence },
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

  async submitTask(participantId: string, expectedParticipantRevision: number, task: string, idempotencyKey: string,
                   authorizedContextSourceIds: string[]): Promise<AgentTaskAdmission> {
    const response = await this.request<WireTaskAdmission>(`/api/v2/agents/${encodeURIComponent(participantId)}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ expected_participant_revision: expectedParticipantRevision, task,
        authorized_context_source_ids: authorizedContextSourceIds }),
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
