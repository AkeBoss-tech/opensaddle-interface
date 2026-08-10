export const INVESTIGATION_SCHEMA_VERSION = 'opensaddle.grounded-investigation.v1' as const
export const PLAN_DRAFT_SCHEMA_VERSION = 'opensaddle.human-plan-draft.v1' as const

export const PINNED_CONTEXT_BRIEF_CONTRACT = Object.freeze({
  capabilityId: 'krail.context-brief.opensaddle-v1',
  descriptorDigest: 'sha256:bfe1bd6af513f24df70b59617565a2262610119f13d0a8a7fb937fbca70098fd',
  manifestDigest: 'sha256:3fa4bb326946fe0555321b0790150dbbb2a92964fba23eae492f448e8c0655a7',
  sourceCommit: '21da6d42619410e8d1cfc4f823681e4eac47d21a',
})

export interface WireDigest {
  algorithm: 'sha-256'
  value: string
}

export interface SourceVersion {
  sourceId: string
  origin: string
  version: string
  digest: WireDigest
}

/** Exact authority-qualified reference from the accepted OpenSaddle contract. */
export interface InvestigationResourceRef {
  issuer: string
  resourceId: string
  resourceType: 'repository' | 'issue'
  version: string
  digest: WireDigest
  source: SourceVersion
}

export type InvestigationFailureCode =
  | 'policy_denied'
  | 'approval_required'
  | 'stale_evidence'
  | 'version_conflict'
  | 'provider_unavailable'
  | 'invalid_evidence'
  | 'cancelled'
  | 'redacted'
  | 'unavailable'

export interface InvestigationFailure {
  code: InvestigationFailureCode
  message: string
  retryable: boolean
}

export interface HumanPlanDraft {
  schemaVersion: typeof PLAN_DRAFT_SCHEMA_VERSION
  title: string
  objective: string
  steps: readonly string[]
  assumptions: readonly string[]
  authoredBy: string
}

/** A non-executing link only. It is neither approval nor authorization. */
export interface OperationProposalLink {
  path: '/api/v2/operation-proposals'
  proposalId: string | null
  executionAvailable: false
  protectedInputDigest: string | null
}

export interface ContextBriefProjection {
  readonly schema_version: 'krail.context-brief.v1'
  readonly brief_digest: string
  readonly [key: string]: unknown
}

export interface InvestigationProjection {
  schemaVersion: typeof INVESTIGATION_SCHEMA_VERSION
  investigationId: string
  outcomeThreadId: string
  projectId: string
  repository: InvestigationResourceRef
  issue: InvestigationResourceRef
  query: string | null
  status: 'pending' | 'ready' | 'needs_attention' | 'failed' | 'cancelled'
  failure: InvestigationFailure | null
  attempt: number
  contextBrief: ContextBriefProjection | null
  planDraft: HumanPlanDraft | null
  planVersion: number
  planDigest: string | null
  operationProposal: OperationProposalLink
  createdAt: string
  updatedAt: string
}

export interface CreateInvestigationInput {
  projectId: string
  repository: InvestigationResourceRef
  issue: InvestigationResourceRef
  query?: string | null
  evaluatedAt: string
}

export interface ReconcileInvestigationInput {
  repository: InvestigationResourceRef
  issue: InvestigationResourceRef
  query?: string | null
  evaluatedAt: string
}

export interface SavePlanDraftInput {
  expectedVersion: number
  title: string
  objective: string
  steps: readonly string[]
  assumptions: readonly string[]
  registeredActionId: string
  registeredActionVersion: number
  expiresInSeconds?: number
  costEstimate: Readonly<Record<string, unknown>>
}

export type InvestigationLifecycle =
  | { phase: 'idle' }
  | { phase: 'requesting'; operation: 'create' | 'retry' | 'reconcile' | 'cancel' | 'plan' | 'reconnect' }
  | { phase: 'settled'; projection: InvestigationProjection }
  | { phase: 'failed'; failure: InvestigationFailure; lastProjection?: InvestigationProjection }

export interface InvestigationSnapshot {
  lifecycle: InvestigationLifecycle
  projection?: InvestigationProjection
}
