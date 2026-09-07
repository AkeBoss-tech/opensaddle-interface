import type { KrailProposalApproval, KrailProposalClient, OperationProposal } from './contracts'

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} is invalid`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is invalid`)
  return value
}

function number(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} is invalid`)
  return value as number
}

function proposalFromApi(value: unknown): OperationProposal {
  const raw = object(value, 'operation proposal')
  const policy = object(raw.policy_decision, 'proposal policy')
  const cost = object(raw.cost_estimate, 'proposal cost')
  return {
    proposalId: string(raw.proposal_id, 'proposal id'), projectId: string(raw.project_id, 'proposal project'),
    recordDigest: string(raw.record_digest, 'proposal record digest'), protectedInputDigest: string(raw.protected_input_digest, 'proposal input digest'),
    registeredActionId: string(raw.registered_action_id, 'proposal action'), registeredActionVersion: number(raw.registered_action_version, 'proposal action version'),
    actor: string(raw.actor, 'proposal actor'), delegationChain: (Array.isArray(raw.delegation_chain) ? raw.delegation_chain : []).map((item) => string(item, 'proposal delegate')),
    targets: (Array.isArray(raw.targets) ? raw.targets : []).map((item) => { const target = object(item, 'proposal target'); const resource = object(target.resource_ref, 'proposal target resource'); const digest = object(resource.digest, 'proposal target digest'); const source = object(resource.source, 'proposal target source'); const sourceDigest = object(source.digest, 'proposal target source digest'); return { issuer: string(resource.issuer, 'proposal target issuer'), resourceType: string(resource.resource_type, 'proposal target type'), resourceId: string(resource.resource_id, 'proposal target id'), resourceVersion: string(resource.version, 'proposal target resource version'), expectedVersion: string(target.expected_version, 'proposal target version'), digest: string(digest.value, 'proposal target digest'), source: { sourceId: string(source.source_id, 'proposal target source id'), origin: string(source.origin, 'proposal target source origin'), version: string(source.version, 'proposal target source version'), digest: string(sourceDigest.value, 'proposal target source digest') } } }),
    declaredEffects: (Array.isArray(raw.declared_effects) ? raw.declared_effects : []).map((item) => { const effect = object(item, 'proposal effect'); return { effectClass: string(effect.effect_class, 'proposal effect class'), bounds: object(effect.bounds, 'proposal effect bounds') } }),
    policy: { outcome: string(policy.outcome, 'proposal policy outcome'), id: string(policy.policy_id, 'proposal policy id'), version: string(policy.policy_version, 'proposal policy version'), hash: string(policy.policy_hash, 'proposal policy hash'), reason: policy.reason === null ? null : string(policy.reason, 'proposal policy reason') },
    requiredApprovals: (Array.isArray(raw.required_approvals) ? raw.required_approvals : []).map((item) => { const approval = object(item, 'proposal approval'); return { kind: string(approval.kind, 'proposal approval kind'), role: string(approval.role, 'proposal approval role'), count: number(approval.count, 'proposal approval count') } }),
    costEstimate: { currency: string(cost.currency, 'proposal cost currency'), estimatedMicrounits: number(cost.estimated_microunits, 'proposal cost estimate'), budgetMicrounits: cost.budget_microunits === null ? null : number(cost.budget_microunits, 'proposal budget') },
    validationResults: (Array.isArray(raw.validation_results) ? raw.validation_results : []).map((item) => { const result = object(item, 'proposal validation'); if (typeof result.passed !== 'boolean') throw new Error('proposal validation is invalid'); return { code: string(result.code, 'proposal validation code'), passed: result.passed, message: result.message === null ? null : string(result.message, 'proposal validation message') } }),
    blockers: (Array.isArray(raw.blockers) ? raw.blockers : []).map((item) => { const blocker = object(item, 'proposal blocker'); return { code: string(blocker.code, 'proposal blocker code'), message: string(blocker.message, 'proposal blocker message') } }),
    expiresAt: string(raw.expires_at, 'proposal expiry'), createdAt: string(raw.created_at, 'proposal creation'),
  }
}

export class RemoteKrailProposalClient implements KrailProposalClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string
  constructor(baseUrl: string, getUserId: () => string, token?: string) { this.baseUrl = baseUrl; this.getUserId = getUserId; this.token = token }
  private headers() { return { 'Content-Type': 'application/json', 'X-OpenSaddle-User': this.getUserId(), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) } }
  async get(proposalId: string): Promise<OperationProposal> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v2/operation-proposals/${encodeURIComponent(proposalId)}`, { headers: this.headers() })
    if (!response.ok) throw new Error(await detail(response))
    return proposalFromApi(await response.json())
  }
  async approve(proposalId: string, ttlSeconds: number): Promise<KrailProposalApproval> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v2/krail/proposals/${encodeURIComponent(proposalId)}/approval`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ ttl_seconds: ttlSeconds }) })
    if (!response.ok) throw new Error(await detail(response))
    const value = object(await response.json(), 'proposal approval')
    return { approvalId: string(value.approval_id, 'approval id'), proposalId: string(value.proposal_id, 'approval proposal id'), approvedBy: string(value.approved_by, 'approval approver'), expiresAt: string(value.expires_at, 'approval expiry'), recordDigest: string(value.proposal_record_digest, 'approval record digest') }
  }
}

async function detail(response: Response) {
  const value = await response.json().catch(() => null) as { detail?: unknown } | null
  return typeof value?.detail === 'string' ? value.detail : `Proposal request failed (${response.status})`
}
