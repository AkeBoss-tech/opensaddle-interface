export const EDITING_CONTRACT_VERSION = 'opensaddle.interface-editing.presentation/v1' as const

export type EditingContractVersion = typeof EDITING_CONTRACT_VERSION

export const EDITING_CONTRACT_PROVENANCE = Object.freeze({
  owner: 'opensaddle-interface',
  kind: 'client-presentation-snapshot',
  authority: 'non-authoritative',
  backendContract: null,
} as const)

export type EditableResourceKind =
  | 'thread'
  | 'plan_draft'
  | 'workflow_definition'
  | 'factory_definition'
  | 'agent_configuration'
  | 'schedule'
  | 'automation'
  | 'semantic_package_draft'
  | 'ontology_package_draft'
  | 'connector_manifest'

export type ImmutableResourceKind =
  | 'evidence'
  | 'capture'
  | 'approval'
  | 'audit_event'
  | 'verification_event'
  | 'receipt'

export type EditResourceKind = EditableResourceKind | ImmutableResourceKind
export type EditEffectClass = 'draft' | 'low_risk' | 'consequential'
export type FieldValueType = 'string' | 'number' | 'boolean' | 'string_list' | 'enum'
export type EditAvailabilityCode =
  | 'available'
  | 'immutable_resource'
  | 'policy_denied'
  | 'provider_unavailable'
  | 'unsupported_resource'

/** Safe for display. It cannot include resource values, field names, ids, or policy internals. */
export interface SafeAvailability {
  code: EditAvailabilityCode
  message: string
}

export interface EditResourceRef {
  kind: EditResourceKind
  id: string
}

export interface EditResourceVersion {
  version: string
  digest: string
}

export interface FieldValidation {
  required?: boolean
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  pattern?: string
  options?: readonly string[]
}

export interface EditFieldSchema {
  /** RFC 6901 JSON Pointer. Only fields explicitly present here are editable. */
  path: string
  label: string
  valueType: FieldValueType
  validation: FieldValidation
  requiredRoles: readonly string[]
  requiredCapabilities: readonly string[]
  effectClass: EditEffectClass
}

export interface EditWorkflow {
  draftFirst: true
  publishMode: 'none' | 'explicit_publish' | 'proposal_only'
  directCommit: 'never' | 'policy_permitted_low_risk_draft'
}

export interface ReversibilityDescriptor {
  mode: 'undo' | 'revert' | 'supersede' | 'none'
  requiresProposal: boolean
}

export interface ImmutableAlternativeCapability {
  kind: 'annotation' | 'correction' | 'supersession'
  available: boolean
  availability: SafeAvailability
}

export interface EditCapability {
  contractVersion: EditingContractVersion
  provenance: typeof EDITING_CONTRACT_PROVENANCE
  capabilityId: string
  resource: EditResourceRef
  current: EditResourceVersion
  fields: readonly EditFieldSchema[]
  requiredRoles: readonly string[]
  requiredCapabilities: readonly string[]
  workflow: EditWorkflow
  reversibility: ReversibilityDescriptor
  available: boolean
  availability: SafeAvailability
  immutableAlternatives: readonly ImmutableAlternativeCapability[]
  policyRevision: string
}

export type EditAuthor =
  | { kind: 'human'; principalId: string; roles: readonly string[]; capabilities: readonly string[] }
  | {
      kind: 'agent'
      principalId: string
      delegatedBy: string
      delegationId: string
      delegatedCapabilityIds: readonly string[]
      roles: readonly string[]
      capabilities: readonly string[]
    }

export type TypedFieldValue = string | number | boolean | readonly string[]

export interface TypedFieldChange {
  kind: 'field'
  path: string
  value: TypedFieldValue
}

export interface JsonPatchChange {
  kind: 'json_patch'
  op: 'add' | 'replace' | 'remove'
  path: string
  value?: TypedFieldValue
}

export type EditChange = TypedFieldChange | JsonPatchChange

export interface LocalRecoveryPolicy {
  mode: 'disabled' | 'memory' | 'device_encrypted'
  authoritative: false
  ttlMs?: number
}

export interface EditValidationIssue {
  path?: string
  code: 'required' | 'type' | 'range' | 'length' | 'pattern' | 'option' | 'unavailable'
  message: string
}

export interface EditDiffEntry {
  path: string
  operation: 'add' | 'replace' | 'remove'
  value?: TypedFieldValue
}

export type EditConflictState =
  | { status: 'current' }
  | { status: 'stale'; latest: EditResourceVersion; canCompare: true; canRebase: boolean }
  | { status: 'rebasing'; latest: EditResourceVersion }
  | { status: 'conflicted'; latest: EditResourceVersion; paths: readonly string[] }

export interface EditSession {
  contractVersion: EditingContractVersion
  sessionId: string
  capabilityId: string
  resource: EditResourceRef
  base: EditResourceVersion
  policyRevision: string
  state: 'draft' | 'validating' | 'ready' | 'submitted' | 'discarded'
  changes: readonly EditChange[]
  undoStack: readonly (readonly EditChange[])[]
  recovery: LocalRecoveryPolicy
  validation: readonly EditValidationIssue[]
  diff: readonly EditDiffEntry[]
  author: EditAuthor
  conflict: EditConflictState
}

export interface LiveEditPolicy {
  revision: string
  active: boolean
  principalRoles: readonly string[]
  principalCapabilities: readonly string[]
  permittedCapabilityIds: readonly string[]
  allowLowRiskDraftDirectCommit: boolean
}

export interface SharedEditCommand {
  contractVersion: EditingContractVersion
  commandId: string
  capabilityId: string
  resource: EditResourceRef
  expected: EditResourceVersion
  policyRevision: string
  author: EditAuthor
  changes: readonly EditChange[]
}

export interface DirectCommitProjection {
  kind: 'direct_commit'
  command: SharedEditCommand
  transportAvailable: false
}

export interface OperationProposalProjection {
  kind: 'operation_proposal'
  command: SharedEditCommand
  effectClass: 'consequential'
  lifecycle: readonly ['proposal', 'approval', 'execution']
  executionAvailable: false
  transportAvailable: false
}

export type EditSubmissionProjection = DirectCommitProjection | OperationProposalProjection
