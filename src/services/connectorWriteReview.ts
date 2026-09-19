type Json = Record<string, unknown>
export type ConnectorWriteProposal = {
  proposalId: string; projectId: string; runId: string; requestDigest: string
  connector: string; action: string; arguments: Json; agentId: string; onBehalfOf: string
  state: 'proposed' | 'approved' | 'dispatching' | 'completed' | 'effect_unknown'
  expiresAt: string; approvedBy?: string; receipt?: Json
}
export type ConnectorWriteSnapshot = { proposals: ConnectorWriteProposal[]; complete: boolean }

const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const proposalId = (value: unknown): value is string => typeof value === 'string' && /^awp_[a-f0-9]{32}$/.test(value)
const object = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const states = new Set(['proposed', 'approved', 'dispatching', 'completed', 'effect_unknown'])

export class ConnectorWriteReviewClient {
  private readonly baseUrl: string
  private readonly user: () => string
  private readonly token?: string
  constructor(baseUrl: string, user: () => string, token?: string) { this.baseUrl = baseUrl; this.user = user; this.token = token }

  private async request(path: string, method: 'GET' | 'POST', body: unknown, subject: string, signal?: AbortSignal): Promise<Json> {
    if (subject !== this.user()) throw Error('Write review authority changed')
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method, cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'X-OpenSaddle-User': subject,
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    signal?.throwIfAborted()
    if (subject !== this.user()) throw Error('Write review authority changed')
    if (!response.ok) throw Error(`Write review unavailable (HTTP ${response.status})`)
    const value: unknown = await response.json()
    if (!object(value)) throw Error('Write review response is invalid')
    return value
  }

  private async exactRun(projectId: string, runId: string, subject: string, signal?: AbortSignal) {
    const run = await this.request(`/api/v2/runs/${encodeURIComponent(runId)}`, 'GET', undefined, subject, signal)
    if (run.run_id !== runId || run.project_id !== projectId) throw Error('Write review Run identity changed')
  }

  private parse(value: Json, projectId: string, runId: string, expectedId: string, expectedDigest?: string, requireScope = true): ConnectorWriteProposal {
    if (requireScope && (value.review_scope !== 'exact_connector_write' || typeof value.dispatch_reservation_started !== 'boolean')) throw Error('Write review scope is invalid')
    if (value.proposal_id !== expectedId || value.project_id !== projectId || value.run_id !== runId
      || !digest(value.request_digest) || (expectedDigest && value.request_digest !== expectedDigest)
      || typeof value.connector !== 'string' || !value.connector || typeof value.action !== 'string' || !value.action
      || !object(value.arguments) || typeof value.participant_id !== 'string' || !value.participant_id
      || typeof value.on_behalf_of !== 'string' || !value.on_behalf_of
      || !states.has(String(value.state)) || typeof value.expires_at !== 'string'
      || !Number.isFinite(Date.parse(value.expires_at))) throw Error('Write review binding is invalid')
    return { proposalId: expectedId, projectId, runId, requestDigest: value.request_digest,
      connector: value.connector, action: value.action, arguments: value.arguments,
      agentId: value.participant_id, onBehalfOf: value.on_behalf_of,
      state: value.state as ConnectorWriteProposal['state'], expiresAt: value.expires_at,
      approvedBy: typeof value.approved_by === 'string' ? value.approved_by : undefined,
      receipt: object(value.receipt) ? value.receipt : undefined }
  }

  async proposal(projectId: string, runId: string, id: string, expectedDigest?: string, signal?: AbortSignal): Promise<ConnectorWriteProposal> {
    if (!proposalId(id) || (expectedDigest !== undefined && !digest(expectedDigest))) throw Error('Write proposal identity is invalid')
    const subject = this.user()
    await this.exactRun(projectId, runId, subject, signal)
    const value = await this.request(`/api/v2/connector-write-proposals/${encodeURIComponent(id)}`, 'GET', undefined, subject, signal)
    const proposal = this.parse(value, projectId, runId, id, expectedDigest)
    if (subject !== this.user()) throw Error('Write review authority changed')
    return proposal
  }

  async discover(projectId: string, runId: string, signal?: AbortSignal, previouslyReviewed: ConnectorWriteProposal[] = []): Promise<ConnectorWriteSnapshot> {
    const subject = this.user(), overall = new AbortController()
    const abort = () => overall.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 7500)
    try {
      await this.exactRun(projectId, runId, subject, overall.signal)
      const list = await this.request(`/api/v2/runs/${encodeURIComponent(runId)}/connector-write-proposals`, 'GET', undefined, subject, overall.signal)
      if (list.schema_version !== 'opensaddle.connector-write-proposals.v1' || list.run_id !== runId
        || !Array.isArray(list.proposals) || list.proposals.length > 50 || typeof list.truncated !== 'boolean')
        throw Error('Write proposal list binding is invalid')
      const ids = new Set<string>(), proposals: ConnectorWriteProposal[] = []
      for (const raw of list.proposals) {
        if (!object(raw) || !proposalId(raw.proposal_id) || ids.has(raw.proposal_id)) throw Error('Write proposal list item is invalid')
        ids.add(raw.proposal_id)
        const proposal = this.parse(raw, projectId, runId, raw.proposal_id)
        if (proposal.state === 'completed') throw Error('Write proposal list state is invalid')
        proposals.push(proposal)
      }
      // The pending list drops completed writes. Recheck only proposals this
      // mounted review already saw, so their terminal state remains visible.
      for (const prior of previouslyReviewed.slice(0, 50)) {
        if (prior.projectId !== projectId || prior.runId !== runId || !proposalId(prior.proposalId)
          || !digest(prior.requestDigest)) throw Error('Previously reviewed write binding is invalid')
        if (!ids.has(prior.proposalId)) {
          ids.add(prior.proposalId)
          proposals.push(await this.proposal(projectId, runId, prior.proposalId, prior.requestDigest, overall.signal))
        }
      }
      await this.exactRun(projectId, runId, subject, overall.signal)
      if (subject !== this.user()) throw Error('Write review authority changed')
      return { proposals, complete: !list.truncated }
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); overall.abort() }
  }

  async approve(proposal: ConnectorWriteProposal): Promise<ConnectorWriteProposal> {
    const subject = this.user()
    const current = await this.proposal(proposal.projectId, proposal.runId, proposal.proposalId, proposal.requestDigest)
    if (current.state !== 'proposed' || JSON.stringify(current.arguments) !== JSON.stringify(proposal.arguments)
      || current.connector !== proposal.connector || current.action !== proposal.action
      || current.agentId !== proposal.agentId || current.onBehalfOf !== proposal.onBehalfOf)
      throw Error('Write request changed; refresh before deciding')
    if (Date.parse(current.expiresAt) <= Date.now()) throw Error('Write request expired; refresh before deciding')
    const response = await this.request(`/api/v2/connector-write-proposals/${encodeURIComponent(proposal.proposalId)}/approve`,
      'POST', { expected_request_digest: proposal.requestDigest }, subject)
    this.parse(response, proposal.projectId, proposal.runId, proposal.proposalId, proposal.requestDigest, false)
    return this.proposal(proposal.projectId, proposal.runId, proposal.proposalId, proposal.requestDigest)
  }
}
