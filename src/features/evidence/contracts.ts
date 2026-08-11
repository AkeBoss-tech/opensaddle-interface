export const EVIDENCE_SCHEMA_VERSION = 'opensaddle.evidence/v1' as const
export const RESOURCE_REF_SCHEMA_VERSION = 'opensaddle.resource-ref/v1' as const

export type EvidenceSchemaVersion = typeof EVIDENCE_SCHEMA_VERSION
export type ResourceRefSchemaVersion = typeof RESOURCE_REF_SCHEMA_VERSION

export type AuthorityKind =
  | 'opensaddle'
  | 'local_workspace'
  | 'provider'
  | 'connector'
  | 'user'
  | 'public_web'

/** Identifies who is authoritative for a resource, not merely where it was displayed. */
export interface ResourceAuthority {
  kind: AuthorityKind
  id: string
}

export type ResourceVersion =
  | { kind: 'revision'; value: string }
  | { kind: 'etag'; value: string }
  | { kind: 'timestamp'; value: string }
  | { kind: 'digest'; algorithm: string; value: string }

/** A reference is usable as evidence only when its authority and exact version are known. */
export interface ResourceRef {
  schemaVersion: ResourceRefSchemaVersion
  authority: ResourceAuthority
  kind: string
  id: string
  version: ResourceVersion
}

export type SemanticTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface SemanticBadge {
  label: string
  tone: SemanticTone
}

export interface AuthorityPresentation {
  label: string
  badge: SemanticBadge
  description: string
}

export type EvidenceErrorCode =
  | 'policy_denied'
  | 'provider_denied'
  | 'version_conflict'
  | 'approval_required'
  | 'stale_evidence'
  | 'runtime_unavailable'

export interface EvidenceDomainError {
  code: EvidenceErrorCode
  message: string
  retryable: boolean
  resource?: ResourceRef
}

export type FreshnessStatus = 'fresh' | 'stale' | 'unknown'

export interface EvidenceFreshness {
  observedAt?: number
  freshUntil?: number
  status: FreshnessStatus
  ageMs?: number
  staleByMs?: number
}

export interface EvidenceCitation {
  id: string
  source: ResourceRef
  title: string
  locator?: string
  excerpt?: string
  freshness: EvidenceFreshness
}

export interface EvidenceConflict {
  id: string
  citationIds: string[]
  summary: string
}

export type EvidenceGapKind = 'missing_source' | 'missing_version' | 'missing_content' | 'coverage'

export interface EvidenceGap {
  id: string
  kind: EvidenceGapKind
  summary: string
  source?: ResourceRef
}

export interface EvidenceLineage {
  from: ResourceRef
  to: ResourceRef
  relation: 'derived_from' | 'quoted_from' | 'generated_from'
}

/** Safe disclosure that evidence was omitted. It must never contain source data or identifiers. */
export interface PolicyOmission {
  id: string
  reason: 'policy_denied' | 'provider_denied' | 'redacted'
  count: number
  message: string
}

/** Opaque disclosure for UI consumers; never carries hidden ids or cardinality. */
export interface PresentationOmission {
  reason: PolicyOmission['reason']
  message: string
}

export interface EvidencePacket {
  schemaVersion: EvidenceSchemaVersion
  id: string
  generatedAt: number
  citations: EvidenceCitation[]
  conflicts: EvidenceConflict[]
  gaps: EvidenceGap[]
  lineage: EvidenceLineage[]
  policyOmissions: PolicyOmission[]
  errors: EvidenceDomainError[]
}

export type OperationState = 'queued' | 'active' | 'waiting' | 'paused' | 'terminal'
export type OperationPhase = 'intake' | 'planning' | 'execution' | 'verification' | 'review' | 'delivery'
export type OperationBlocker =
  | 'none'
  | 'input_required'
  | 'approval_required'
  | 'policy_denied'
  | 'provider_denied'
  | 'version_conflict'
  | 'stale_evidence'
  | 'runtime_unavailable'
  | 'unknown'
export type OperationOutcome = 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'partial'

/** State, phase, blocker, and outcome deliberately vary independently. */
export interface OperationPresentation {
  state: OperationState
  phase: OperationPhase
  blocker: OperationBlocker
  outcome: OperationOutcome
  stateBadge: SemanticBadge
  phaseLabel: string
  blockerLabel?: string
  outcomeBadge: SemanticBadge
  error?: EvidenceDomainError
}

export interface PresentedCitation extends EvidenceCitation {
  visibility: 'visible'
  authority: AuthorityPresentation
}

export interface RedactedCitation {
  id: string
  visibility: 'redacted'
  title: 'Restricted evidence'
  authority: AuthorityPresentation
}

export type PresentationCitation = PresentedCitation | RedactedCitation

export interface EvidencePresentation {
  schemaVersion: EvidenceSchemaVersion
  id: string
  generatedAt: number
  citations: PresentationCitation[]
  conflicts: EvidenceConflict[]
  gaps: EvidenceGap[]
  lineage: EvidenceLineage[]
  omissions: PresentationOmission[]
  errors: EvidenceDomainError[]
}

export type EvidencePolicyEffect = 'allow' | 'redact' | 'deny'

export interface EvidencePolicy {
  defaultEffect: EvidencePolicyEffect
  citationEffects?: Readonly<Record<string, EvidencePolicyEffect>>
  resourceEffects?: Readonly<Record<string, EvidencePolicyEffect>>
  denialReason?: 'policy_denied' | 'provider_denied'
}
