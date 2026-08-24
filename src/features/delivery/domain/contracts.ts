import type { EditSession, EditSubmissionProjection } from '../../editing'

export const GOVERNED_DELIVERY_CONTRACT_VERSION = 'opensaddle.governed-delivery.v1' as const

export type Digest = string
export type GitRevision = string

export interface Sha256Digest {
  algorithm: 'sha-256'
  value: string
}

export interface ExactSourceVersion {
  sourceId: string
  origin: string
  version: string
  digest: Sha256Digest
}

export interface ExactResourceRef {
  issuer: string
  resourceType: string
  resourceId: string
  version: string
  digest: Sha256Digest
  source: ExactSourceVersion
}

export interface CompactResourceRef {
  authority: string
  resourceType: string
  resourceId: string
  version: string
  digest: Digest
}

export interface DeliveryLifecycleEvent {
  sequence: number
  eventType: string
  state: 'admitted' | 'executing' | 'verifying' | 'proposed' | 'approved' | 'dispatching' | 'cancelled' | 'terminal'
  fenceEpoch: number
  occurredAt: string
  requestDigest: Digest | null
  receiptId: string | null
  omission: string | null
}

export interface GovernedOperation {
  operationId: string
  admissionId: string
  state: 'publishing' | 'dispatching' | 'cancelled' | 'terminal'
  fenceEpoch: number
  lifecycle: readonly DeliveryLifecycleEvent[]
  replay: { requestDigest: Digest; result: 'committed' | 'replayed' }
  reconnect: { supported: true; requiresSameFence: true }
  cancel: { revokesActiveCredentialLeases: true; preventsNewDispatch: true }
}

export interface ExecutionAdmission {
  admissionId: string
  admissionDigest: Digest
  proposalId: string
  proposalDigest: Digest
  proposalRequestDigest: Digest
  registeredActionId: string
  registeredActionVersion: number
  registeredActionDigest: Digest
  projectId: string
  policyHash: string
  sourceRevisions: readonly ExactResourceRef[]
  contextBriefDigest: Digest
  evidencePacketRefs: readonly string[]
  correlationIds: readonly string[]
  expiresAt: string
}

export type UpstreamVerificationState = 'passed' | 'failed' | 'partial' | 'unavailable'
export type VerificationPresentationState = 'pending' | 'passed' | 'failed' | 'unavailable' | 'uncertain' | 'incomplete'

export interface SafeVerificationCheck {
  checkId: string
  kind: string
  status: VerificationPresentationState
  summary: string | null
  resultDigest: Digest | null
  exitStatusDigest: Digest | null
  observedRevision: GitRevision
  artifactRefs: readonly CompactResourceRef[]
}

export interface VerificationEvidenceReference {
  capabilityId: string
  descriptorDigest: Digest
  evidencePacketId: string
  evidenceDigest: Digest
  operationId: string
  correlationId: string
  causationId: string
  observedRevision: GitRevision
  freshness: 'current' | 'stale' | 'uncertain'
  uncertainty: readonly string[]
  omissions: readonly string[]
}

export interface ChangedFileProjection {
  path: string
  ref: ExactResourceRef
  additions: number | null
  deletions: number | null
}

export interface ChangeSetProjection {
  repository: ExactResourceRef
  source: ExactSourceVersion
  baseRevision: GitRevision
  headRevision: GitRevision
  diff: CompactResourceRef
  patch: CompactResourceRef
  files: readonly ChangedFileProjection[]
  additions: number | null
  deletions: number | null
  commits: readonly ExactResourceRef[]
  status: 'current' | 'stale_head' | 'uncertain'
  countsStatus: 'observed' | 'unavailable' | 'stale_observation'
}

export interface PublicationProposalProjection {
  schemaVersion: 'opensaddle.publication-proposal.v1'
  state: 'draft'
  targetKind: 'code-review'
  title: string
  body: string
  baseRevision: GitRevision
  headRevision: GitRevision
  diffRef: ExactResourceRef
  patchRef: ExactResourceRef
  changedFiles: readonly ExactResourceRef[]
  verificationState: UpstreamVerificationState
  verificationEvidenceDigest: Digest
  verificationEvidencePacketId: string
  editableFields: readonly ['title', 'body']
}

export interface PullRequestProjection {
  provider: 'github'
  number: number
  url: string
  baseRevision: GitRevision
  headRevision: GitRevision
}

export interface ProviderCiProjection {
  provider: 'github'
  headRevision: GitRevision
  state: 'passed' | 'failed' | 'pending' | 'unavailable'
  checksRef: string | null
  observedAt: string
  freshness: 'current' | 'stale' | 'uncertain'
}

export interface ApprovalBindingProjection {
  approvalId: string
  approvalDigest: Digest
  expiresAt: string
  consumed: true
  runId: string
  consequenceDigest: Digest
  requestDigest: Digest
  policyHash: string
  admissionDigest: Digest
}

export interface EffectReceiptProjection {
  schemaVersion: 'opensaddle.effect-receipt.v1'
  receiptId: string
  receiptDigest: Digest
  operationId: string
  admissionId: string
  admissionDigest: Digest
  fenceEpoch: number
  outcome: 'effect_applied_verified' | 'effect_applied_not_verified'
  proposalDigest: Digest
  proposalRequestDigest: Digest
  publicationDigest: Digest
  consequenceDigest: Digest
  requestDigest: Digest
  registeredActionId: string
  registeredActionVersion: number
  registeredActionDigest: Digest
  repository: ExactResourceRef
  baseRevision: GitRevision
  headRevision: GitRevision
  pullRequest: PullRequestProjection
  diffRef: ExactResourceRef
  patchRef: ExactResourceRef
  verificationEvidenceRef: string
  verificationEvidenceDigest: Digest
  ci: ProviderCiProjection
  verifiedCompletion: boolean
  omissions: readonly string[]
  idempotencyResult: 'committed' | 'replayed'
  completedAt: string
}

export type DeliveryPhase = 'provisioning' | 'executing' | 'verifying' | 'publishing'
export type DeliveryPhaseStatus = 'pending' | 'active' | 'completed' | 'cancelled' | 'uncertain'

export interface DeliveryProgressStep {
  phase: DeliveryPhase
  status: DeliveryPhaseStatus
}

export type DeliveryTerminalState =
  | 'in_progress'
  | 'completed_verified'
  | 'completed_incomplete_verification'
  | 'cancelled'
  | 'uncertain'

export interface DeliveryPresentationProjection {
  contractVersion: typeof GOVERNED_DELIVERY_CONTRACT_VERSION
  operationId: string
  admissionId: string
  fenceEpoch: number
  lifecycle: readonly DeliveryLifecycleEvent[]
  replayResult: 'committed' | 'replayed'
  progress: readonly DeliveryProgressStep[]
  terminal: DeliveryTerminalState
  changeSet: ChangeSetProjection
  checks: readonly SafeVerificationCheck[]
  verification: VerificationEvidenceReference
  publication: PublicationProposalProjection
  approval: ApprovalBindingProjection
  provider: { pullRequest: PullRequestProjection; ci: ProviderCiProjection }
  receipt: EffectReceiptProjection
  omissions: readonly string[]
}

export interface DeliveryReviewSessionBinding {
  session: EditSession
  submission: EditSubmissionProjection
  transport: 'shared_edit_command_only'
}

export class GovernedDeliveryValidationError extends Error {
  readonly code: 'unsupported_contract' | 'invalid_document' | 'authority_mismatch' | 'unsafe_presentation'

  constructor(code: GovernedDeliveryValidationError['code']) {
    super('The governed delivery projection is invalid or unavailable.')
    this.name = 'GovernedDeliveryValidationError'
    this.code = code
  }
}
