import type { InvestigationProjection } from '../domain'

const HEX_64 = /^[a-f0-9]{64}$/
const BLOCKERS = new Set<ProposalBlockerCode>([
  'action_unavailable', 'policy_denied', 'approval_required', 'validation_failed', 'budget_exceeded',
])
const EFFECTS = new Set<ProposalEffectClass>(['read', 'external_write', 'code_mutation', 'runtime_execution', 'destructive'])

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) throw new Error(`${label} must be an integer`)
  return Number(value)
}

function array(value: unknown, label: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${label} must be a bounded list`)
  return value
}

function digest(value: unknown, label: string): string {
  const result = string(value, label)
  if (!HEX_64.test(result)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
  return result
}

function boundedJson(value: unknown, label: string): Readonly<Record<string, unknown>> {
  const result = object(value, label)
  if (JSON.stringify(result).length > 16_384) throw new Error(`${label} is too large for presentation`)
  return Object.freeze({ ...result })
}

export type ProposalEffectClass = 'read' | 'external_write' | 'code_mutation' | 'runtime_execution' | 'destructive'
export type ProposalBlockerCode = 'action_unavailable' | 'policy_denied' | 'approval_required' | 'validation_failed' | 'budget_exceeded'

export interface ProposalResourcePresentation {
  issuer: string
  resourceId: string
  resourceType: string
  version: string
  digest: string
  source: { sourceId: string; origin: string; version: string; digest: string }
}

export interface OperationProposalPresentation {
  schemaVersion: 'opensaddle.operation-proposal.v1'
  proposalId: string
  projectId: string
  registeredActionId: string
  registeredActionVersion: number
  actor: string
  delegationChain: string[]
  targets: Array<{ resource: ProposalResourcePresentation; expectedVersion: string }>
  protectedInputDigest: string
  declaredEffects: Array<{ effectClass: ProposalEffectClass; bounds: Readonly<Record<string, unknown>> }>
  policy: { outcome: string; id: string; version: string; hash: string; reason: string | null }
  requiredApprovals: Array<{ kind: string; role: string; count: number }>
  costEstimate: { currency: string; estimatedMicrounits: number; budgetMicrounits: number | null }
  validationResults: Array<{ code: string; passed: boolean; message: string | null }>
  blockers: Array<{ code: ProposalBlockerCode; message: string }>
  correlationIds: string[]
  expiresAt: string
  createdAt: string
  recordDigest: string
}

function proposalResource(value: unknown): ProposalResourcePresentation {
  const source = object(value, 'proposal target resource')
  const sourceVersion = object(source.source, 'proposal target source')
  const sourceDigest = object(sourceVersion.digest, 'proposal target source digest')
  const resourceDigest = object(source.digest, 'proposal target digest')
  if (resourceDigest.algorithm !== 'sha-256' || sourceDigest.algorithm !== 'sha-256') throw new Error('proposal target digest algorithm is unsupported')
  return {
    issuer: string(source.issuer, 'proposal target issuer'),
    resourceId: string(source.resource_id, 'proposal target resource id'),
    resourceType: string(source.resource_type, 'proposal target resource type'),
    version: string(source.version, 'proposal target version'),
    digest: digest(resourceDigest.value, 'proposal target digest'),
    source: {
      sourceId: string(sourceVersion.source_id, 'proposal target source id'),
      origin: string(sourceVersion.origin, 'proposal target source origin'),
      version: string(sourceVersion.version, 'proposal target source version'),
      digest: digest(sourceDigest.value, 'proposal target source digest'),
    },
  }
}

/** Strictly adapts the reviewed OpenSaddle v1 proposal into a text-only view model. */
export function presentOperationProposal(value: unknown, investigation: InvestigationProjection): OperationProposalPresentation {
  const source = object(value, 'operation proposal')
  if (source.schema_version !== 'opensaddle.operation-proposal.v1') throw new Error('operation proposal schema is unsupported')
  const proposalId = string(source.proposal_id, 'operation proposal id')
  const projectId = string(source.project_id, 'operation proposal project id')
  const protectedInputDigest = digest(source.protected_input_digest, 'operation proposal protected input digest')
  if (
    investigation.operationProposal.proposalId !== proposalId
    || projectId !== investigation.projectId
    || investigation.operationProposal.protectedInputDigest !== protectedInputDigest
    || investigation.planDigest !== protectedInputDigest
  ) throw new Error('operation proposal is not bound to this investigation plan')

  const correlationIds = array(source.correlation_ids, 'operation proposal correlation ids', 32).map((item) => string(item, 'operation proposal correlation id'))
  if (!correlationIds.includes(investigation.investigationId) || !correlationIds.includes(investigation.outcomeThreadId)) {
    throw new Error('operation proposal identity binding is incomplete')
  }
  const policy = object(source.policy_decision, 'operation proposal policy')
  const cost = object(source.cost_estimate, 'operation proposal cost estimate')

  return {
    schemaVersion: 'opensaddle.operation-proposal.v1',
    proposalId,
    projectId,
    registeredActionId: string(source.registered_action_id, 'registered action id'),
    registeredActionVersion: integer(source.registered_action_version, 'registered action version', 1),
    actor: string(source.actor, 'operation proposal actor'),
    delegationChain: array(source.delegation_chain, 'operation proposal delegation chain', 32).map((item) => string(item, 'operation proposal delegate')),
    targets: array(source.targets, 'operation proposal targets', 100).map((item) => {
      const target = object(item, 'operation proposal target')
      const resource = proposalResource(target.resource_ref)
      const expectedVersion = string(target.expected_version, 'operation proposal expected version')
      if (resource.version !== expectedVersion) throw new Error('operation proposal target version is not exact')
      return { resource, expectedVersion }
    }),
    protectedInputDigest,
    declaredEffects: array(source.declared_effects, 'operation proposal effects', 16).map((item) => {
      const effect = object(item, 'operation proposal effect')
      if (typeof effect.effect_class !== 'string' || !EFFECTS.has(effect.effect_class as ProposalEffectClass)) throw new Error('operation proposal effect is unsupported')
      return { effectClass: effect.effect_class as ProposalEffectClass, bounds: boundedJson(effect.bounds, 'operation proposal effect bounds') }
    }),
    policy: {
      outcome: string(policy.outcome, 'operation proposal policy outcome'),
      id: string(policy.policy_id, 'operation proposal policy id'),
      version: string(policy.policy_version, 'operation proposal policy version'),
      hash: string(policy.policy_hash, 'operation proposal policy hash'),
      reason: policy.reason === null ? null : string(policy.reason, 'operation proposal policy reason'),
    },
    requiredApprovals: array(source.required_approvals, 'operation proposal approvals', 100).map((item) => {
      const approval = object(item, 'operation proposal approval')
      return {
        kind: string(approval.kind, 'operation proposal approval kind'),
        role: string(approval.role, 'operation proposal approval role'),
        count: integer(approval.count, 'operation proposal approval count', 1),
      }
    }),
    costEstimate: {
      currency: string(cost.currency, 'operation proposal cost currency'),
      estimatedMicrounits: integer(cost.estimated_microunits, 'operation proposal estimated cost'),
      budgetMicrounits: cost.budget_microunits === null ? null : integer(cost.budget_microunits, 'operation proposal budget'),
    },
    validationResults: array(source.validation_results, 'operation proposal validations', 100).map((item) => {
      const validation = object(item, 'operation proposal validation')
      if (typeof validation.passed !== 'boolean') throw new Error('operation proposal validation result is invalid')
      return {
        code: string(validation.code, 'operation proposal validation code'),
        passed: validation.passed,
        message: validation.message === null || validation.message === undefined ? null : string(validation.message, 'operation proposal validation message'),
      }
    }),
    blockers: array(source.blockers, 'operation proposal blockers', 100).map((item) => {
      const blocker = object(item, 'operation proposal blocker')
      if (typeof blocker.code !== 'string' || !BLOCKERS.has(blocker.code as ProposalBlockerCode)) throw new Error('operation proposal blocker is unsupported')
      return { code: blocker.code as ProposalBlockerCode, message: string(blocker.message, 'operation proposal blocker message') }
    }),
    correlationIds,
    expiresAt: string(source.expires_at, 'operation proposal expiry'),
    createdAt: string(source.created_at, 'operation proposal creation time'),
    recordDigest: digest(source.record_digest, 'operation proposal record digest'),
  }
}

export async function fetchOperationProposal(
  baseUrl: string,
  userId: string,
  token: string | undefined,
  investigation: InvestigationProjection,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<OperationProposalPresentation> {
  const proposalId = investigation.operationProposal.proposalId
  if (!proposalId) throw new Error('No operation proposal is bound to this investigation')
  let response: Response
  try {
    response = await fetcher(`${baseUrl.replace(/\/$/, '')}/api/v2/operation-proposals/${encodeURIComponent(proposalId)}`, {
      headers: { 'X-OpenSaddle-User': userId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  } catch {
    throw new Error('Operation proposal is unavailable')
  }
  if (!response.ok) throw new Error(response.status === 403 || response.status === 404 ? 'Operation proposal is unavailable or restricted' : 'Operation proposal could not be loaded')
  try {
    return presentOperationProposal(await response.json(), investigation)
  } catch {
    throw new Error('OpenSaddle returned an invalid or unbound operation proposal')
  }
}

export function proposalCostInput(proposal: OperationProposalPresentation): Readonly<Record<string, unknown>> {
  return {
    currency: proposal.costEstimate.currency,
    estimated_microunits: proposal.costEstimate.estimatedMicrounits,
    budget_microunits: proposal.costEstimate.budgetMicrounits,
  }
}
