import {
  INVESTIGATION_SCHEMA_VERSION,
  PINNED_CONTEXT_BRIEF_CONTRACT,
  PLAN_DRAFT_SCHEMA_VERSION,
  type ContextBriefProjection,
  type HumanPlanDraft,
  type InvestigationFailure,
  type InvestigationFailureCode,
  type InvestigationProjection,
  type InvestigationResourceRef,
  type OperationProposalLink,
  type SourceVersion,
  type WireDigest,
} from './contracts'

const FAILURE_CODES = new Set<InvestigationFailureCode>([
  'policy_denied', 'approval_required', 'stale_evidence', 'version_conflict',
  'provider_unavailable', 'invalid_evidence', 'cancelled', 'redacted', 'unavailable',
])
const STATUSES = new Set(['pending', 'ready', 'needs_attention', 'failed', 'cancelled'])
const HEX_64 = /^[a-f0-9]{64}$/
const SHA256 = /^sha256:[a-f0-9]{64}$/

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function digest(value: unknown, label: string): WireDigest {
  const source = object(value, label)
  if (source.algorithm !== 'sha-256' || typeof source.value !== 'string' || !HEX_64.test(source.value)) {
    throw new Error(`${label} must be an exact sha-256 digest`)
  }
  return { algorithm: 'sha-256', value: source.value }
}

function uri(value: unknown, label: string): string {
  const result = string(value, label)
  try { new URL(result) } catch { throw new Error(`${label} must be an absolute URI`) }
  return result
}

function dateTime(value: unknown, label: string): string {
  const result = string(value, label)
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an RFC 3339 date-time`)
  return result
}

function hexDigest(value: unknown, label: string): string {
  const result = string(value, label)
  if (!HEX_64.test(result)) throw new Error(`${label} is invalid`)
  return result
}

function sourceVersion(value: unknown, label: string): SourceVersion {
  const source = object(value, label)
  return {
    sourceId: string(source.source_id, `${label}.source_id`),
    origin: uri(source.origin, `${label}.origin`),
    version: string(source.version, `${label}.version`),
    digest: digest(source.digest, `${label}.digest`),
  }
}

export function adaptInvestigationResourceRef(value: unknown, expectedType?: 'repository' | 'issue'): InvestigationResourceRef {
  const source = object(value, 'resource')
  if (source.resource_type !== 'repository' && source.resource_type !== 'issue') throw new Error('resource.resource_type is unsupported')
  if (expectedType && source.resource_type !== expectedType) throw new Error(`resource must be a ${expectedType}`)
  const resourceType: 'repository' | 'issue' = source.resource_type
  const result = {
    issuer: uri(source.issuer, 'resource.issuer'),
    resourceId: string(source.resource_id, 'resource.resource_id'),
    resourceType,
    version: string(source.version, 'resource.version'),
    digest: digest(source.digest, 'resource.digest'),
    source: sourceVersion(source.source, 'resource.source'),
  }
  return result
}

function failure(value: unknown): InvestigationFailure | null {
  if (value === null) return null
  const source = object(value, 'failure')
  if (typeof source.code !== 'string' || !FAILURE_CODES.has(source.code as InvestigationFailureCode)) throw new Error('failure.code is unsupported')
  if (typeof source.retryable !== 'boolean') throw new Error('failure.retryable must be boolean')
  return { code: source.code as InvestigationFailureCode, message: string(source.message, 'failure.message'), retryable: source.retryable }
}

function plan(value: unknown): HumanPlanDraft | null {
  if (value === null) return null
  const source = object(value, 'plan_draft')
  if (source.schema_version !== PLAN_DRAFT_SCHEMA_VERSION) throw new Error('plan_draft schema is unsupported')
  if (!Array.isArray(source.steps) || !Array.isArray(source.assumptions)) throw new Error('plan_draft lists are invalid')
  return {
    schemaVersion: PLAN_DRAFT_SCHEMA_VERSION,
    title: string(source.title, 'plan_draft.title'),
    objective: string(source.objective, 'plan_draft.objective'),
    steps: source.steps.map((item, index) => string(item, `plan_draft.steps.${index}`)),
    assumptions: source.assumptions.map((item, index) => string(item, `plan_draft.assumptions.${index}`)),
    authoredBy: string(source.authored_by, 'plan_draft.authored_by'),
  }
}

function proposal(value: unknown): OperationProposalLink {
  const source = object(value, 'operation_proposal')
  if (source.path !== '/api/v2/operation-proposals' || source.execution_available !== false) throw new Error('operation_proposal cannot represent execution')
  return {
    path: '/api/v2/operation-proposals',
    proposalId: source.proposal_id === null ? null : string(source.proposal_id, 'operation_proposal.proposal_id'),
    executionAvailable: false,
    protectedInputDigest: source.protected_input_digest === null ? null : string(source.protected_input_digest, 'operation_proposal.protected_input_digest'),
  }
}

function contextBrief(value: unknown): ContextBriefProjection | null {
  if (value === null) return null
  const source = object(value, 'context_brief')
  if (source.schema_version !== 'krail.context-brief.v1' || typeof source.brief_digest !== 'string' || !SHA256.test(source.brief_digest)) throw new Error('context_brief schema is unsupported')
  return Object.freeze({ ...source }) as ContextBriefProjection
}

export function adaptInvestigationProjection(value: unknown): InvestigationProjection {
  const source = object(value, 'investigation')
  const contract = object(source.contract, 'contract')
  if (
    contract.capability_id !== PINNED_CONTEXT_BRIEF_CONTRACT.capabilityId
    || contract.descriptor_digest !== PINNED_CONTEXT_BRIEF_CONTRACT.descriptorDigest
    || contract.manifest_digest !== PINNED_CONTEXT_BRIEF_CONTRACT.manifestDigest
    || contract.source_commit !== PINNED_CONTEXT_BRIEF_CONTRACT.sourceCommit
  ) throw new Error('investigation uses an unrecognized Context Brief contract')
  if (source.schema_version !== INVESTIGATION_SCHEMA_VERSION) throw new Error('investigation schema is unsupported')
  if (typeof source.status !== 'string' || !STATUSES.has(source.status)) throw new Error('investigation status is unsupported')
  if (!Number.isInteger(source.attempt) || Number(source.attempt) < 1) throw new Error('investigation attempt is invalid')
  if (!Number.isInteger(source.plan_version) || Number(source.plan_version) < 0) throw new Error('plan version is invalid')
  return Object.freeze({
    schemaVersion: INVESTIGATION_SCHEMA_VERSION,
    investigationId: string(source.investigation_id, 'investigation_id'),
    outcomeThreadId: string(source.outcome_thread_id, 'outcome_thread_id'),
    projectId: string(source.project_id, 'project_id'),
    repository: adaptInvestigationResourceRef(source.repository, 'repository'),
    issue: adaptInvestigationResourceRef(source.issue, 'issue'),
    query: source.query === null ? null : string(source.query, 'query'),
    status: source.status as InvestigationProjection['status'],
    failure: failure(source.failure),
    attempt: Number(source.attempt),
    contextBrief: contextBrief(source.context_brief),
    planDraft: plan(source.plan_draft),
    planVersion: Number(source.plan_version),
    planDigest: source.plan_digest === null ? null : hexDigest(source.plan_digest, 'plan_digest'),
    operationProposal: proposal(source.operation_proposal),
    createdAt: dateTime(source.created_at, 'created_at'),
    updatedAt: dateTime(source.updated_at, 'updated_at'),
  })
}

export function investigationFailure(error: unknown): InvestigationFailure {
  if (error instanceof InvestigationClientError) return error.failure
  if (error instanceof DOMException && error.name === 'AbortError') return { code: 'cancelled', message: 'Investigation request was cancelled', retryable: true }
  return { code: 'unavailable', message: error instanceof Error ? error.message : 'Investigation service is unavailable', retryable: true }
}

export class InvestigationClientError extends Error {
  readonly failure: InvestigationFailure
  readonly status?: number

  constructor(failure: InvestigationFailure, status?: number) {
    super(failure.message)
    this.name = 'InvestigationClientError'
    this.failure = failure
    this.status = status
  }
}
