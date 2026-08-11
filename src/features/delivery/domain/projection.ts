import type { GitComparisonResult } from '../../../services/contracts'
import {
  GOVERNED_DELIVERY_CONTRACT_VERSION,
  GovernedDeliveryValidationError,
  type ApprovalBindingProjection,
  type ChangeSetProjection,
  type CompactResourceRef,
  type DeliveryPresentationProjection,
  type DeliveryProgressStep,
  type DeliveryTerminalState,
  type Digest,
  type EffectReceiptProjection,
  type ExactResourceRef,
  type ExactSourceVersion,
  type ExecutionAdmission,
  type GovernedOperation,
  type ProviderCiProjection,
  type PublicationProposalProjection,
  type SafeVerificationCheck,
  type Sha256Digest,
  type UpstreamVerificationState,
  type VerificationEvidenceReference,
  type VerificationPresentationState,
} from './contracts'

const HEX_DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/
const RESOURCE_TYPE = /^[a-z][a-z0-9_.-]{0,127}$/
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/

function fail(code: GovernedDeliveryValidationError['code'] = 'invalid_document'): never {
  throw new GovernedDeliveryValidationError(code)
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail()
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail()
}

function text(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return fail()
  return value
}

function nullableText(value: unknown, max = 2048): string | null {
  return value === null ? null : text(value, max)
}

function integer(value: unknown, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) return fail()
  return value as number
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') return fail()
  return value
}

function literal<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return fail()
  return value as T
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail()
  return value
}

function stringList(value: unknown, max: number): readonly string[] {
  return Object.freeze(list(value, max).map((item) => text(item)))
}

function digest(value: unknown): Digest {
  if (typeof value !== 'string' || !HEX_DIGEST.test(value)) return fail()
  return value
}

function dateTime(value: unknown): string {
  const result = text(value, 200)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(result)
  if (!match) return fail()
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[8] === undefined ? 0 : Number(match[8])
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
    || Number.isNaN(Date.parse(result))) return fail()
  return result
}

function shaDigest(value: unknown): Sha256Digest {
  const source = object(value)
  exact(source, ['algorithm', 'value'])
  if (source.algorithm !== 'sha-256') return fail()
  const result = digest(source.value)
  if (result.startsWith('sha256:')) return fail()
  return Object.freeze({ algorithm: 'sha-256', value: result })
}

function sourceVersion(value: unknown): ExactSourceVersion {
  const source = object(value)
  exact(source, ['source_id', 'origin', 'version', 'digest'])
  const origin = text(source.origin)
  if (!URI.test(origin)) return fail('authority_mismatch')
  return Object.freeze({
    sourceId: text(source.source_id),
    origin,
    version: text(source.version),
    digest: shaDigest(source.digest),
  })
}

function resourceRef(value: unknown): ExactResourceRef {
  const source = object(value)
  exact(source, ['issuer', 'resource_type', 'resource_id', 'version', 'digest', 'source'])
  const issuer = text(source.issuer, 512)
  const resourceType = text(source.resource_type, 128)
  if (!URI.test(issuer) || !RESOURCE_TYPE.test(resourceType)) return fail('authority_mismatch')
  return Object.freeze({
    issuer,
    resourceType,
    resourceId: text(source.resource_id),
    version: text(source.version),
    digest: shaDigest(source.digest),
    source: sourceVersion(source.source),
  })
}

function compactRef(value: unknown): CompactResourceRef {
  const source = object(value)
  exact(source, ['authority', 'resource_type', 'resource_id', 'version', 'digest'])
  const authority = text(source.authority, 512)
  const resourceType = text(source.resource_type, 128)
  if (!URI.test(authority) || !RESOURCE_TYPE.test(resourceType)) return fail('authority_mismatch')
  return Object.freeze({
    authority,
    resourceType,
    resourceId: text(source.resource_id),
    version: text(source.version),
    digest: digest(source.digest),
  })
}

function normalizeRevision(value: string): string {
  return value.startsWith('git:') ? value.slice(4) : value
}

function sameRevision(left: string, right: string): boolean {
  return normalizeRevision(left) === normalizeRevision(right)
}

function digestText(value: Sha256Digest): string {
  return `sha256:${value.value}`
}

function sameSource(left: ExactSourceVersion, right: ExactSourceVersion): boolean {
  return left.sourceId === right.sourceId
    && left.origin === right.origin
    && sameRevision(left.version, right.version)
    && left.digest.value === right.digest.value
}

function sameResource(left: ExactResourceRef, right: ExactResourceRef): boolean {
  return left.issuer === right.issuer
    && left.resourceType === right.resourceType
    && left.resourceId === right.resourceId
    && sameRevision(left.version, right.version)
    && left.digest.value === right.digest.value
    && sameSource(left.source, right.source)
}

function compactMatchesResource(compact: CompactResourceRef, exactRef: ExactResourceRef): boolean {
  return compact.authority === exactRef.issuer
    && compact.resourceType === exactRef.resourceType
    && compact.resourceId === exactRef.resourceId
    && sameRevision(compact.version, exactRef.version)
    && compact.digest === digestText(exactRef.digest)
}

function operation(value: unknown): GovernedOperation {
  const source = object(value)
  exact(source, ['operation_id', 'admission_id', 'state', 'fence_epoch', 'lifecycle', 'replay', 'reconnect', 'cancel'])
  const lifecycle = list(source.lifecycle, 256).map((item) => {
    const event = object(item)
    exact(event, ['sequence', 'event_type', 'state', 'fence_epoch', 'occurred_at', 'request_digest', 'receipt_id', 'omission'])
    return Object.freeze({
      sequence: integer(event.sequence, 1),
      eventType: text(event.event_type),
      state: literal(event.state, ['admitted', 'executing', 'verifying', 'proposed', 'approved', 'dispatching', 'cancelled', 'terminal'] as const),
      fenceEpoch: integer(event.fence_epoch, 1),
      occurredAt: dateTime(event.occurred_at),
      requestDigest: event.request_digest === null ? null : digest(event.request_digest),
      receiptId: nullableText(event.receipt_id, 200),
      omission: nullableText(event.omission, 200),
    })
  })
  if (lifecycle.length === 0) fail()
  const replay = object(source.replay)
  exact(replay, ['request_digest', 'result'])
  const reconnect = object(source.reconnect)
  exact(reconnect, ['supported', 'requires_same_fence'])
  const cancel = object(source.cancel)
  exact(cancel, ['revokes_active_credential_leases', 'prevents_new_dispatch'])
  if (reconnect.supported !== true || reconnect.requires_same_fence !== true
    || cancel.revokes_active_credential_leases !== true || cancel.prevents_new_dispatch !== true) return fail()
  return Object.freeze({
    operationId: text(source.operation_id),
    admissionId: text(source.admission_id),
    state: literal(source.state, ['publishing', 'dispatching', 'cancelled', 'terminal'] as const),
    fenceEpoch: integer(source.fence_epoch, 1),
    lifecycle: Object.freeze(lifecycle),
    replay: Object.freeze({ requestDigest: digest(replay.request_digest), result: literal(replay.result, ['committed', 'replayed'] as const) }),
    reconnect: Object.freeze({ supported: true, requiresSameFence: true }),
    cancel: Object.freeze({ revokesActiveCredentialLeases: true, preventsNewDispatch: true }),
  })
}

const ADMISSION_KEYS = [
  'schema_version', 'admission_id', 'admission_digest', 'proposal_id', 'proposal_digest',
  'proposal_request_digest', 'registered_action_id', 'registered_action_version', 'registered_action_digest',
  'actor', 'delegation_chain', 'project_id', 'policy_hash', 'approval_ids', 'approval_request_digest',
  'source_revisions', 'context_brief_digest', 'evidence_packet_refs', 'expected_resource_versions',
  'runtime', 'budget', 'correlation_ids', 'expires_at',
] as const

function admission(value: unknown): ExecutionAdmission {
  const source = object(value)
  exact(source, ADMISSION_KEYS)
  if (source.schema_version !== 'opensaddle.execution-admission.v1') return fail('unsupported_contract')
  text(source.actor)
  stringList(source.delegation_chain, 32)
  stringList(source.approval_ids, 32)
  if (source.approval_request_digest !== null) digest(source.approval_request_digest)
  const expectedVersions = object(source.expected_resource_versions)
  if (Object.keys(expectedVersions).length < 2 || Object.keys(expectedVersions).length > 32) fail()
  for (const expected of Object.values(expectedVersions)) text(expected)
  const runtime = object(source.runtime)
  exact(runtime, ['isolation', 'network'])
  text(runtime.isolation)
  text(runtime.network)
  const budget = object(source.budget)
  exact(budget, ['currency', 'max_microunits'])
  text(budget.currency)
  integer(budget.max_microunits)
  return Object.freeze({
    admissionId: text(source.admission_id),
    admissionDigest: digest(source.admission_digest),
    proposalId: text(source.proposal_id),
    proposalDigest: digest(source.proposal_digest),
    proposalRequestDigest: digest(source.proposal_request_digest),
    registeredActionId: text(source.registered_action_id),
    registeredActionVersion: integer(source.registered_action_version, 1),
    registeredActionDigest: digest(source.registered_action_digest),
    projectId: text(source.project_id),
    policyHash: text(source.policy_hash),
    sourceRevisions: Object.freeze(list(source.source_revisions, 32).map(resourceRef)),
    contextBriefDigest: digest(source.context_brief_digest),
    evidencePacketRefs: stringList(source.evidence_packet_refs, 32),
    correlationIds: stringList(source.correlation_ids, 32),
    expiresAt: dateTime(source.expires_at),
  })
}

function safeCheck(value: unknown, observedRevision: string): SafeVerificationCheck {
  const source = object(value)
  const status = checkState(source.status)
  const artifacts = Array.isArray(source.artifact_refs)
    ? source.artifact_refs.slice(0, 32).flatMap((item): CompactResourceRef[] => {
        try {
          const artifact = object(item)
          const ref = compactRef(artifact.ref)
          return [ref]
        } catch {
          return []
        }
      })
    : []
  return Object.freeze({
    checkId: typeof source.check_id === 'string' && source.check_id.length <= 128 ? source.check_id : 'unavailable-check',
    kind: typeof source.kind === 'string' && source.kind.length <= 128 ? source.kind : 'other',
    status,
    summary: typeof source.summary === 'string' && source.summary.length <= 4096 ? source.summary : null,
    resultDigest: typeof source.result_digest === 'string' && HEX_DIGEST.test(source.result_digest) ? source.result_digest : null,
    exitStatusDigest: typeof source.exit_status_digest === 'string' && HEX_DIGEST.test(source.exit_status_digest) ? source.exit_status_digest : null,
    observedRevision,
    artifactRefs: Object.freeze(artifacts),
  })
}

function checkState(value: unknown): VerificationPresentationState {
  if (value === 'passed' || value === 'failed' || value === 'pending') return value
  if (value === 'partial') return 'incomplete'
  if (value === 'unavailable' || value === 'inaccessible' || value === 'redacted' || value === 'missing') return 'unavailable'
  return 'uncertain'
}

function artifact(value: unknown, role: 'diff' | 'patch'): CompactResourceRef {
  const source = object(value)
  exact(source, ['role', 'ref', 'media_type', 'byte_length', 'bounded_summary'])
  if (source.role !== role) fail('authority_mismatch')
  text(source.media_type)
  integer(source.byte_length)
  text(source.bounded_summary, 4096)
  return compactRef(source.ref)
}

interface ParsedExecution {
  admissionId: string
  admissionDigest: Digest
  fenceEpoch: number
  baseRevision: string
  headRevision: string
  diff: CompactResourceRef
  patch: CompactResourceRef
  changedFiles: readonly ExactResourceRef[]
  commits: readonly ExactResourceRef[]
  checks: readonly SafeVerificationCheck[]
  verificationState: UpstreamVerificationState
  verificationReceipt: Omit<VerificationEvidenceReference, 'observedRevision' | 'freshness' | 'uncertainty'>
}

function execution(value: unknown): ParsedExecution {
  const source = object(value)
  exact(source, ['admission_id', 'admission_digest', 'fence_epoch', 'evidence', 'verification_receipt'])
  const evidence = object(source.evidence)
  exact(evidence, ['base_revision', 'head_revision', 'diff', 'patch', 'changed_files', 'commits', 'checks', 'tool_versions', 'environment_versions', 'verification_state'])
  const baseRevision = text(evidence.base_revision)
  const headRevision = text(evidence.head_revision)
  list(evidence.tool_versions, 128)
  list(evidence.environment_versions, 128)
  const receipt = object(source.verification_receipt)
  exact(receipt, ['capability_id', 'descriptor_digest', 'evidence_packet_id', 'evidence_digest', 'operation_id', 'correlation_id', 'causation_id', 'omissions'])
  return Object.freeze({
    admissionId: text(source.admission_id),
    admissionDigest: digest(source.admission_digest),
    fenceEpoch: integer(source.fence_epoch, 1),
    baseRevision,
    headRevision,
    diff: artifact(evidence.diff, 'diff'),
    patch: artifact(evidence.patch, 'patch'),
    changedFiles: Object.freeze(list(evidence.changed_files, 256).map(resourceRef)),
    commits: Object.freeze(list(evidence.commits, 256).map(resourceRef)),
    checks: Object.freeze(list(evidence.checks, 256).map((item) => safeCheck(item, headRevision))),
    verificationState: literal(evidence.verification_state, ['passed', 'failed', 'partial', 'unavailable'] as const),
    verificationReceipt: Object.freeze({
      capabilityId: text(receipt.capability_id),
      descriptorDigest: digest(receipt.descriptor_digest),
      evidencePacketId: text(receipt.evidence_packet_id),
      evidenceDigest: digest(receipt.evidence_digest),
      operationId: text(receipt.operation_id),
      correlationId: text(receipt.correlation_id),
      causationId: text(receipt.causation_id),
      omissions: stringList(receipt.omissions, 32),
    }),
  })
}

function publication(value: unknown): PublicationProposalProjection {
  const source = object(value)
  exact(source, ['schema_version', 'state', 'target_kind', 'title', 'body', 'base_revision', 'head_revision', 'diff_ref', 'patch_ref', 'changed_files', 'verification_state', 'verification_evidence_digest', 'verification_evidence_packet_id', 'editable_fields'])
  if (source.schema_version !== 'opensaddle.publication-proposal.v1' || source.state !== 'draft' || source.target_kind !== 'code-review') return fail('unsupported_contract')
  if (!Array.isArray(source.editable_fields) || source.editable_fields.length !== 2 || source.editable_fields[0] !== 'title' || source.editable_fields[1] !== 'body') fail()
  return Object.freeze({
    schemaVersion: 'opensaddle.publication-proposal.v1',
    state: 'draft',
    targetKind: 'code-review',
    title: text(source.title, 300),
    body: typeof source.body === 'string' && source.body.length <= 65_536 ? source.body : fail(),
    baseRevision: text(source.base_revision),
    headRevision: text(source.head_revision),
    diffRef: resourceRef(source.diff_ref),
    patchRef: resourceRef(source.patch_ref),
    changedFiles: Object.freeze(list(source.changed_files, 256).map(resourceRef)),
    verificationState: literal(source.verification_state, ['passed', 'failed', 'partial', 'unavailable'] as const),
    verificationEvidenceDigest: digest(source.verification_evidence_digest),
    verificationEvidencePacketId: text(source.verification_evidence_packet_id),
    editableFields: Object.freeze(['title', 'body'] as const),
  })
}

function approval(value: unknown): ApprovalBindingProjection {
  const source = object(value)
  exact(source, ['approval_id', 'approval_digest', 'expires_at', 'single_use', 'consumed', 'run_id', 'principal', 'consequence_digest', 'request_digest', 'policy_hash', 'admission_digest'])
  if (source.single_use !== true || source.consumed !== true) fail('authority_mismatch')
  text(source.principal)
  return Object.freeze({
    approvalId: text(source.approval_id),
    approvalDigest: digest(source.approval_digest),
    expiresAt: dateTime(source.expires_at),
    consumed: true,
    runId: text(source.run_id),
    consequenceDigest: digest(source.consequence_digest),
    requestDigest: digest(source.request_digest),
    policyHash: text(source.policy_hash),
    admissionDigest: digest(source.admission_digest),
  })
}

function canonicalHttpsUrl(value: unknown): string {
  const source = text(value)
  let parsed: URL
  try { parsed = new URL(source) } catch { return fail('unsafe_presentation') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return fail('unsafe_presentation')
  return source
}

function ci(value: unknown): ProviderCiProjection {
  const source = object(value)
  exact(source, ['provider', 'head_revision', 'state', 'checks_ref', 'observed_at'])
  if (source.provider !== 'github') fail('authority_mismatch')
  return Object.freeze({
    provider: 'github',
    headRevision: text(source.head_revision),
    state: literal(source.state, ['passed', 'failed', 'pending', 'unavailable'] as const),
    checksRef: source.checks_ref === null ? null : canonicalHttpsUrl(source.checks_ref),
    observedAt: dateTime(source.observed_at),
    freshness: 'uncertain',
  })
}

const RECEIPT_KEYS = [
  'schema_version', 'receipt_id', 'receipt_digest', 'operation_id', 'admission_id', 'admission_digest',
  'fence_epoch', 'outcome', 'actual_effects', 'proposal_digest', 'proposal_request_digest', 'publication_digest',
  'consequence_digest', 'request_digest', 'registered_action_id', 'registered_action_version', 'registered_action_digest',
  'adapter_capability_id', 'adapter_capability_version', 'adapter_capability_digest', 'policy_hash', 'approval_ids',
  'credential_lease_id', 'repository_ref', 'base_revision', 'head_revision', 'pull_request', 'diff_ref', 'patch_ref',
  'verification_evidence_ref', 'verification_evidence_digest', 'ci', 'verified_completion', 'costs', 'omissions',
  'idempotency_result', 'compensating_action', 'completed_at',
] as const

function receipt(value: unknown): EffectReceiptProjection {
  const source = object(value)
  exact(source, RECEIPT_KEYS)
  if (source.schema_version !== 'opensaddle.effect-receipt.v1') return fail('unsupported_contract')
  if (!Array.isArray(source.actual_effects) || source.actual_effects.length !== 1 || source.actual_effects[0] !== 'github.pull_request.created') fail('authority_mismatch')
  if (source.adapter_capability_id !== 'github.create_pull_request' || source.adapter_capability_version !== '1.0.0') fail('authority_mismatch')
  digest(source.adapter_capability_digest)
  text(source.policy_hash)
  stringList(source.approval_ids, 32)
  text(source.credential_lease_id)
  object(source.costs)
  object(source.compensating_action)
  const pullRequest = object(source.pull_request)
  exact(pullRequest, ['provider', 'number', 'url', 'base_revision', 'head_revision'])
  if (pullRequest.provider !== 'github') fail('authority_mismatch')
  return Object.freeze({
    schemaVersion: 'opensaddle.effect-receipt.v1',
    receiptId: text(source.receipt_id),
    receiptDigest: digest(source.receipt_digest),
    operationId: text(source.operation_id),
    admissionId: text(source.admission_id),
    admissionDigest: digest(source.admission_digest),
    fenceEpoch: integer(source.fence_epoch, 1),
    outcome: literal(source.outcome, ['effect_applied_verified', 'effect_applied_not_verified'] as const),
    proposalDigest: digest(source.proposal_digest),
    proposalRequestDigest: digest(source.proposal_request_digest),
    publicationDigest: digest(source.publication_digest),
    consequenceDigest: digest(source.consequence_digest),
    requestDigest: digest(source.request_digest),
    registeredActionId: text(source.registered_action_id),
    registeredActionVersion: integer(source.registered_action_version, 1),
    registeredActionDigest: digest(source.registered_action_digest),
    repository: resourceRef(source.repository_ref),
    baseRevision: text(source.base_revision),
    headRevision: text(source.head_revision),
    pullRequest: Object.freeze({
      provider: 'github',
      number: integer(pullRequest.number, 1),
      url: canonicalHttpsUrl(pullRequest.url),
      baseRevision: text(pullRequest.base_revision),
      headRevision: text(pullRequest.head_revision),
    }),
    diffRef: resourceRef(source.diff_ref),
    patchRef: resourceRef(source.patch_ref),
    verificationEvidenceRef: text(source.verification_evidence_ref),
    verificationEvidenceDigest: digest(source.verification_evidence_digest),
    ci: ci(source.ci),
    verifiedCompletion: bool(source.verified_completion),
    omissions: stringList(source.omissions, 32),
    idempotencyResult: literal(source.idempotency_result, ['committed', 'replayed'] as const),
    completedAt: dateTime(source.completed_at),
  })
}

function validateEffectRequest(value: unknown, admissionValue: ExecutionAdmission, receiptValue: EffectReceiptProjection): void {
  const source = object(value)
  exact(source, ['operation_id', 'fence_epoch', 'admission_id', 'admission_digest', 'requester', 'delegation_chain', 'registered_action_id', 'registered_action_version', 'registered_action_digest', 'action_availability_version', 'adapter_capability_id', 'adapter_capability_version', 'adapter_capability_digest', 'repository_ref', 'base_ref_digest', 'head_ref_digest', 'base_revision', 'head_revision', 'publication_digest', 'consequence_digest', 'request_digest', 'idempotency_key_digest'])
  text(source.requester)
  stringList(source.delegation_chain, 32)
  integer(source.action_availability_version, 1)
  digest(source.base_ref_digest)
  digest(source.head_ref_digest)
  digest(source.idempotency_key_digest)
  if (source.adapter_capability_id !== 'github.create_pull_request' || source.adapter_capability_version !== '1.0.0') fail('authority_mismatch')
  if (text(source.admission_id) !== admissionValue.admissionId
    || digest(source.admission_digest) !== admissionValue.admissionDigest
    || text(source.operation_id) !== receiptValue.operationId
    || integer(source.fence_epoch, 1) !== receiptValue.fenceEpoch
    || text(source.registered_action_id) !== receiptValue.registeredActionId
    || integer(source.registered_action_version, 1) !== receiptValue.registeredActionVersion
    || digest(source.registered_action_digest) !== receiptValue.registeredActionDigest
    || digest(source.publication_digest) !== receiptValue.publicationDigest
    || digest(source.consequence_digest) !== receiptValue.consequenceDigest
    || digest(source.request_digest) !== receiptValue.requestDigest
    || !sameResource(resourceRef(source.repository_ref), receiptValue.repository)
    || !sameRevision(text(source.base_revision), receiptValue.baseRevision)
    || !sameRevision(text(source.head_revision), receiptValue.headRevision)) fail('authority_mismatch')
}

function validateCredentialLease(value: unknown, approvalValue: ApprovalBindingProjection): void {
  const source = object(value)
  exact(source, ['lease_id', 'run_id', 'policy_hash', 'connector', 'action', 'expires_at', 'secret_material_omitted'])
  if (source.connector !== 'github' || source.action !== 'create_pull_request' || source.secret_material_omitted !== true) fail('unsafe_presentation')
  text(source.lease_id)
  dateTime(source.expires_at)
  if (text(source.run_id) !== approvalValue.runId || text(source.policy_hash) !== approvalValue.policyHash) fail('authority_mismatch')
}

function validateRedaction(value: unknown): void {
  const source = object(value)
  exact(source, ['mode', 'secret_material', 'provider_request_selectors', 'raw_provider_bodies', 'error_details'])
  if (source.mode !== 'allowlist' || source.secret_material !== 'omitted' || source.provider_request_selectors !== 'omitted'
    || source.raw_provider_bodies !== 'omitted' || source.error_details !== 'typed_constant_disclosures_only') fail('unsafe_presentation')
}

function validateProvenance(value: unknown): void {
  const source = object(value)
  exact(source, ['contract_version', 'authoritative_base_commit', 'execution_schema_version', 'publication_schema_version', 'effect_receipt_schema_version'])
  if (source.contract_version !== GOVERNED_DELIVERY_CONTRACT_VERSION
    || source.execution_schema_version !== 'opensaddle.execution-admission.v1'
    || source.publication_schema_version !== 'opensaddle.publication-proposal.v1'
    || source.effect_receipt_schema_version !== 'opensaddle.effect-receipt.v1'
    || typeof source.authoritative_base_commit !== 'string'
    || !/^[a-f0-9]{40}$/.test(source.authoritative_base_commit)) fail('unsupported_contract')
}

function validateTypedFailures(value: unknown): void {
  for (const item of list(value, 32)) {
    const source = object(item)
    exact(source, ['code', 'phase', 'retryable', 'disclosure'])
    text(source.code, 200)
    text(source.phase, 200)
    bool(source.retryable)
    if (source.disclosure !== 'constant') fail('unsafe_presentation')
  }
}

function bindChangeSet(
  admissionValue: ExecutionAdmission,
  executionValue: ParsedExecution,
  currentRepositoryRevision: string | undefined,
  comparison: GitComparisonResult | undefined,
): ChangeSetProjection {
  const repositories = admissionValue.sourceRevisions.filter((item) => item.resourceType === 'repository')
  if (repositories.length !== 1) fail('authority_mismatch')
  const repository = repositories[0]
  if (!sameRevision(repository.version, executionValue.baseRevision)) fail('authority_mismatch')
  const headSource = executionValue.changedFiles[0]?.source ?? executionValue.commits[0]?.source
  if (!headSource || headSource.sourceId !== repository.source.sourceId || headSource.origin !== repository.source.origin
    || !sameRevision(headSource.version, executionValue.headRevision)) fail('authority_mismatch')
  for (const item of [...executionValue.changedFiles, ...executionValue.commits]) {
    if (!sameRevision(item.version, executionValue.headRevision) || !sameSource(item.source, headSource)) fail('authority_mismatch')
  }
  if (!sameRevision(executionValue.diff.version, executionValue.headRevision)
    || !sameRevision(executionValue.patch.version, executionValue.headRevision)) fail('authority_mismatch')

  const authoritativePaths = new Set(executionValue.changedFiles.map((item) => item.resourceId))
  const exactComparison = comparison !== undefined
    && sameRevision(comparison.base, executionValue.baseRevision)
    && sameRevision(comparison.head, executionValue.headRevision)
    && comparison.files.length === authoritativePaths.size
    && comparison.files.every((item) => authoritativePaths.has(item.path))
  const fileStats = exactComparison ? new Map(comparison.files.map((item) => [item.path, item])) : new Map()
  const files = executionValue.changedFiles.map((item) => {
    const stat = fileStats.get(item.resourceId)
    return Object.freeze({ path: item.resourceId, ref: item, additions: stat?.additions ?? null, deletions: stat?.deletions ?? null })
  })
  const status = currentRepositoryRevision === undefined
    ? 'uncertain'
    : sameRevision(currentRepositoryRevision, executionValue.headRevision) ? 'current' : 'stale_head'
  return Object.freeze({
    repository,
    source: headSource,
    baseRevision: executionValue.baseRevision,
    headRevision: executionValue.headRevision,
    diff: executionValue.diff,
    patch: executionValue.patch,
    files: Object.freeze(files),
    additions: exactComparison ? comparison.additions : null,
    deletions: exactComparison ? comparison.deletions : null,
    commits: executionValue.commits,
    status,
    countsStatus: comparison === undefined ? 'unavailable' : exactComparison ? 'observed' : 'stale_observation',
  })
}

function progress(operationValue: GovernedOperation, verificationState: UpstreamVerificationState): readonly DeliveryProgressStep[] {
  const verificationStatus = verificationState === 'passed' ? 'completed' : 'uncertain'
  const publishingStatus = operationValue.state === 'terminal'
    ? 'completed'
    : operationValue.state === 'cancelled' ? 'cancelled' : 'active'
  return Object.freeze([
    Object.freeze({ phase: 'provisioning', status: 'completed' }),
    Object.freeze({ phase: 'executing', status: 'completed' }),
    Object.freeze({ phase: 'verifying', status: verificationStatus }),
    Object.freeze({ phase: 'publishing', status: publishingStatus }),
  ] as const)
}

function terminal(
  operationValue: GovernedOperation,
  changeSet: ChangeSetProjection,
  executionValue: ParsedExecution,
  receiptValue: EffectReceiptProjection,
): DeliveryTerminalState {
  if (operationValue.state === 'cancelled') return 'cancelled'
  if (operationValue.state !== 'terminal') return 'in_progress'
  if (changeSet.status !== 'current' || receiptValue.ci.freshness !== 'current') return 'uncertain'
  const verificationComplete = executionValue.verificationState === 'passed'
    && executionValue.checks.length > 0
    && executionValue.checks.every((check) => check.status === 'passed')
    && executionValue.verificationReceipt.omissions.length === 0
    && receiptValue.verificationEvidenceDigest === executionValue.verificationReceipt.evidenceDigest
    && receiptValue.outcome === 'effect_applied_verified'
    && receiptValue.verifiedCompletion
    && receiptValue.ci.state === 'passed'
    && receiptValue.omissions.length === 0
  return verificationComplete ? 'completed_verified' : 'completed_incomplete_verification'
}

export interface AdaptGovernedDeliveryInput {
  document: unknown
  currentRepositoryRevision?: string
  comparison?: GitComparisonResult
}

/**
 * Adapts the reviewed OpenSaddle read model into an allowlisted presentation
 * projection. Raw provider bodies, selectors, credentials, principals, costs,
 * and unrestricted errors are validated or discarded before this boundary.
 */
export function adaptGovernedDeliveryProjection(input: AdaptGovernedDeliveryInput): DeliveryPresentationProjection {
  const source = object(input.document)
  exact(source, ['schema_version', 'operation', 'execution_admission', 'execution', 'publication_proposal', 'effect_request', 'approval', 'credential_lease', 'effect_receipt', 'typed_failures', 'redaction', 'provenance'])
  if (source.schema_version !== GOVERNED_DELIVERY_CONTRACT_VERSION) fail('unsupported_contract')
  validateRedaction(source.redaction)
  validateProvenance(source.provenance)
  validateTypedFailures(source.typed_failures)

  const operationValue = operation(source.operation)
  const admissionValue = admission(source.execution_admission)
  const executionValue = execution(source.execution)
  const publicationValue = publication(source.publication_proposal)
  const approvalValue = approval(source.approval)
  const receiptValue = receipt(source.effect_receipt)
  validateEffectRequest(source.effect_request, admissionValue, receiptValue)
  validateCredentialLease(source.credential_lease, approvalValue)

  if (operationValue.admissionId !== admissionValue.admissionId
    || executionValue.admissionId !== admissionValue.admissionId
    || executionValue.admissionDigest !== admissionValue.admissionDigest
    || receiptValue.operationId !== operationValue.operationId
    || receiptValue.admissionId !== admissionValue.admissionId
    || receiptValue.admissionDigest !== admissionValue.admissionDigest
    || receiptValue.fenceEpoch !== operationValue.fenceEpoch
    || receiptValue.proposalDigest !== admissionValue.proposalDigest
    || receiptValue.proposalRequestDigest !== admissionValue.proposalRequestDigest
    || approvalValue.admissionDigest !== admissionValue.admissionDigest
    || approvalValue.requestDigest !== receiptValue.requestDigest
    || approvalValue.consequenceDigest !== receiptValue.consequenceDigest
    || approvalValue.policyHash !== admissionValue.policyHash) fail('authority_mismatch')

  const terminalEvents = operationValue.lifecycle.filter((event) => event.state === 'terminal')
  const terminalEvent = terminalEvents.at(-1)
  if (executionValue.verificationReceipt.operationId !== admissionValue.admissionId
    || executionValue.verificationReceipt.causationId !== admissionValue.proposalId
    || !admissionValue.correlationIds.includes(executionValue.verificationReceipt.correlationId)
    || operationValue.replay.requestDigest !== receiptValue.requestDigest
    || (operationValue.state === 'terminal' && (
      terminalEvents.length !== 1
      || terminalEvent?.receiptId !== receiptValue.receiptId
      || terminalEvent.requestDigest !== receiptValue.requestDigest
    ))) fail('authority_mismatch')

  if (!sameRevision(publicationValue.baseRevision, executionValue.baseRevision)
    || !sameRevision(publicationValue.headRevision, executionValue.headRevision)
    || !sameRevision(receiptValue.baseRevision, executionValue.baseRevision)
    || !sameRevision(receiptValue.headRevision, executionValue.headRevision)
    || !sameRevision(receiptValue.pullRequest.baseRevision, executionValue.baseRevision)
    || !sameRevision(receiptValue.pullRequest.headRevision, executionValue.headRevision)
    || !sameRevision(receiptValue.ci.headRevision, executionValue.headRevision)
    || publicationValue.verificationEvidenceDigest !== executionValue.verificationReceipt.evidenceDigest
    || publicationValue.verificationEvidencePacketId !== executionValue.verificationReceipt.evidencePacketId
    || publicationValue.verificationState !== executionValue.verificationState
    || receiptValue.verificationEvidenceRef !== executionValue.verificationReceipt.evidencePacketId
    || !compactMatchesResource(executionValue.diff, publicationValue.diffRef)
    || !compactMatchesResource(executionValue.patch, publicationValue.patchRef)
    || !sameResource(publicationValue.diffRef, receiptValue.diffRef)
    || !sameResource(publicationValue.patchRef, receiptValue.patchRef)
    || publicationValue.changedFiles.length !== executionValue.changedFiles.length
    || publicationValue.changedFiles.some((item, index) => !sameResource(item, executionValue.changedFiles[index]))) fail('authority_mismatch')

  const changeSet = bindChangeSet(admissionValue, executionValue, input.currentRepositoryRevision, input.comparison)
  if (!sameResource(changeSet.repository, receiptValue.repository)
    || (receiptValue.outcome === 'effect_applied_verified' && (
      !receiptValue.verifiedCompletion || receiptValue.ci.state !== 'passed' || receiptValue.omissions.length > 0
    ))
    || (receiptValue.outcome === 'effect_applied_not_verified' && receiptValue.verifiedCompletion)) fail('authority_mismatch')
  const current = changeSet.status === 'current'
  const ciValue = Object.freeze({
    ...receiptValue.ci,
    freshness: input.currentRepositoryRevision === undefined
      ? 'uncertain' as const
      : current && sameRevision(receiptValue.ci.headRevision, changeSet.headRevision) ? 'current' as const : 'stale' as const,
  })
  const boundReceipt = Object.freeze({ ...receiptValue, ci: ciValue })
  const uncertainty = [
    ...(changeSet.status === 'stale_head' ? ['repository_head_changed'] : []),
    ...(changeSet.status === 'uncertain' ? ['repository_head_unobserved'] : []),
    ...(executionValue.verificationState !== 'passed' ? [`verification_${executionValue.verificationState}`] : []),
  ]
  const verification: VerificationEvidenceReference = Object.freeze({
    ...executionValue.verificationReceipt,
    observedRevision: executionValue.headRevision,
    freshness: changeSet.status === 'current' ? 'current' : changeSet.status === 'stale_head' ? 'stale' : 'uncertain',
    uncertainty: Object.freeze(uncertainty),
  })
  const omissions = Object.freeze([...new Set([
    ...verification.omissions,
    ...boundReceipt.omissions,
    ...operationValue.lifecycle.flatMap((event) => event.omission ? [event.omission] : []),
  ])])
  const terminalState = terminal(operationValue, changeSet, executionValue, boundReceipt)

  return Object.freeze({
    contractVersion: GOVERNED_DELIVERY_CONTRACT_VERSION,
    operationId: operationValue.operationId,
    admissionId: admissionValue.admissionId,
    fenceEpoch: operationValue.fenceEpoch,
    lifecycle: operationValue.lifecycle,
    replayResult: operationValue.replay.result,
    progress: progress(operationValue, executionValue.verificationState),
    terminal: terminalState,
    changeSet,
    checks: executionValue.checks,
    verification,
    publication: publicationValue,
    approval: approvalValue,
    provider: Object.freeze({ pullRequest: boundReceipt.pullRequest, ci: boundReceipt.ci }),
    receipt: boundReceipt,
    omissions,
  })
}
