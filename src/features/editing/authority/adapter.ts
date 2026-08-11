import {
  EDITING_CONTRACT_PROVENANCE,
  EDITING_CONTRACT_VERSION,
  type EditCapability,
  type EditChange,
  type EditFieldSchema,
  type EditSession,
  type EditSubmissionProjection,
  type SharedEditCommand,
  type TypedFieldValue,
} from '../contracts'
import {
  type AuthoritativeAuthor,
  type AuthoritativeConsequentialAction,
  type AuthoritativeEditCapability,
  type AuthoritativeEditSession,
  type AuthoritativeFieldRule,
  type AuthoritativeProposalInput,
  type AuthoritativeResourceRef,
  type AuthoritativeResourceSchema,
  type AuthoritativeTypedPatch,
  type JsonValue,
  validateAuthoritativeEditCapability,
  validateAuthoritativeEditSession,
  validateAuthoritativeProposalInput,
  validateAuthoritativeResourceRef,
  validateAuthoritativeTypedPatch,
} from './contract'

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const FIELD_POINTER = /^\/[a-z][a-z0-9_]{0,127}$/
const DIGEST = /^[a-f0-9]{64}$/
const RESOURCE_KIND_BY_TYPE = Object.freeze({
  'investigation.plan-draft': 'plan_draft',
} as const)

export type SupportedAuthoritativeResourceType = keyof typeof RESOURCE_KIND_BY_TYPE
export type AuthoritativePolicyOutcome = 'allow_draft' | 'allow_commit' | 'proposal_required' | 'deny'

export type AuthorityAdapterFailureCode =
  | 'unsupported_contract'
  | 'unsupported_resource'
  | 'ambiguous_mapping'
  | 'invalid_pointer'
  | 'invalid_patch'
  | 'identity_conflict'
  | 'delegation_denied'
  | 'stale_resource'
  | 'stale_session'
  | 'policy_changed'
  | 'policy_denied'
  | 'capability_changed'
  | 'action_changed'
  | 'digest_mismatch'
  | 'proposal_required'

const FAILURE_MESSAGE = 'The edit cannot be adapted to the authoritative contract.'

/** Opaque by design: it never includes resource values, field names, policy internals, or identities. */
export class AuthorityAdapterFailure extends Error {
  readonly code: AuthorityAdapterFailureCode

  constructor(code: AuthorityAdapterFailureCode) {
    super(FAILURE_MESSAGE)
    this.name = 'AuthorityAdapterFailure'
    this.code = code
  }
}

function fail(code: AuthorityAdapterFailureCode): never {
  throw new AuthorityAdapterFailure(code)
}

export interface AuthoritativePolicySnapshot {
  id: string
  version: string
  hash: string
  revision: string
  outcome: AuthoritativePolicyOutcome
}

export interface AuthoritativeDelegationSnapshot {
  delegationId: string
  delegate: string
  delegator: string
  projectId: string
  capabilityId: string
  capabilityVersion: number
  capabilityDigest: string
  policyId: string
  policyVersion: string
  policyHash: string
  policyOutcome: AuthoritativePolicyOutcome
  validUntil: string
}

export interface AuthoritativeCapabilityAuthority {
  projectId: string
  permissions: readonly string[]
  policy: AuthoritativePolicySnapshot
  availabilityVersion: number
  available: boolean
  capabilityId: string
  capabilityVersion: number
  capabilityDigest: string
  currentResourceRef: AuthoritativeResourceRef
  registeredAction: AuthoritativeConsequentialAction
}

export interface AuthoritativeLiveAuthority extends AuthoritativeCapabilityAuthority {
  subject: string
  currentSessionVersion: number
  currentDraftDigest: string
  activeDelegation: AuthoritativeDelegationSnapshot | null
  revokedDelegationIds: readonly string[]
  now: string
}

export interface AuthoritativeOpeningBinding {
  projectId: string
  policy: AuthoritativePolicySnapshot
  availabilityVersion: number
}

export interface MapAuthoritativeCapabilityInput {
  capability: unknown
  resourceRef: unknown
  opening: AuthoritativeOpeningBinding
  live: AuthoritativeCapabilityAuthority
}

export interface AuthoritativeProposalOptions {
  correlationIds: readonly string[]
  currency?: string
  estimatedMicrounits?: number
  budgetMicrounits?: number | null
  expiresInSeconds?: number
}

export interface AdaptPresentationCommandInput {
  submission: EditSubmissionProjection
  presentationSession: EditSession
  authoritativeSession: AuthoritativeEditSession
  capability: AuthoritativeEditCapability
  opening: AuthoritativeOpeningBinding
  live: AuthoritativeLiveAuthority
  idempotencyKey: string
  proposal?: AuthoritativeProposalOptions
}

export interface AuthoritativeApplyPatchEnvelope {
  operation: 'apply_patch'
  session_id: string
  expected_version: number
  expected_resource_ref: AuthoritativeResourceRef
  patch: AuthoritativeTypedPatch
  allow_rebase: false
}

export interface ValidatedAuthoritativeEditCommand {
  envelope: AuthoritativeApplyPatchEnvelope
  idempotency_key: string
  request_digest: string
  authority_binding: {
    project_id: string
    capability_id: string
    capability_version: number
    capability_digest: string
    policy_id: string
    policy_version: string
    policy_hash: string
    policy_outcome: AuthoritativePolicyOutcome
    availability_version: number
    author: AuthoritativeAuthor
    registered_action_id: string
    registered_action_version: number
    registered_action_digest: string
  }
  operation_proposal_request: AuthoritativeProposalInput | null
  approval_available: false
  execution_available: false
  transport_available: false
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail('invalid_patch')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object' || value === null) return fail('invalid_patch')
  const source = value as Record<string, unknown>
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const result = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function authoritativeCapabilityWithoutDigest(capability: AuthoritativeEditCapability): Omit<AuthoritativeEditCapability, 'capability_digest'> {
  const { capability_digest: _digest, ...unsigned } = capability
  return unsigned
}

async function assertCapabilityDigest(capability: AuthoritativeEditCapability): Promise<void> {
  if (await sha256(authoritativeCapabilityWithoutDigest(capability)) !== capability.capability_digest) fail('digest_mismatch')
}

function schemaFor(capability: AuthoritativeEditCapability, resourceType: string): AuthoritativeResourceSchema {
  const matches = capability.resource_schemas.filter((schema) => schema.resource_type === resourceType)
  if (matches.length !== 1) fail(matches.length > 1 ? 'ambiguous_mapping' : 'unsupported_resource')
  return matches[0]
}

function presentationKind(resourceType: string): EditCapability['resource']['kind'] {
  if (!(resourceType in RESOURCE_KIND_BY_TYPE)) fail('unsupported_resource')
  return RESOURCE_KIND_BY_TYPE[resourceType as SupportedAuthoritativeResourceType]
}

function valueType(rule: AuthoritativeFieldRule): EditFieldSchema['valueType'] {
  if (rule.kind === 'integer') return 'number'
  return rule.kind
}

function presentationField(rule: AuthoritativeFieldRule, lowRisk: boolean): EditFieldSchema {
  return Object.freeze({
    path: `/${rule.field}`,
    label: rule.field,
    valueType: valueType(rule),
    validation: Object.freeze({
      required: rule.required,
      ...(rule.kind === 'string' ? { maxLength: rule.maximum_length } : {}),
      ...(rule.kind === 'string_list' ? { maximum: rule.maximum_length } : {}),
    }),
    requiredRoles: Object.freeze([]),
    requiredCapabilities: Object.freeze([]),
    effectClass: lowRisk ? 'low_risk' : 'consequential',
  })
}

/**
 * Maps authoritative capability material into the pre-existing presentation model.
 * The single supported resource mapping is deliberately explicit and bijective.
 */
export async function mapAuthoritativeCapabilityToPresentation(
  input: MapAuthoritativeCapabilityInput,
): Promise<EditCapability> {
  const capability = validateAuthoritativeEditCapability(input.capability)
  await assertCapabilityDigest(capability)
  const resourceRef = validateAuthoritativeResourceRef(input.resourceRef)
  const schema = schemaFor(capability, resourceRef.resource_type)
  const kind = presentationKind(resourceRef.resource_type)
  assertCapabilityAuthority(input.opening, input.live, capability, resourceRef)
  return Object.freeze({
    contractVersion: EDITING_CONTRACT_VERSION,
    provenance: EDITING_CONTRACT_PROVENANCE,
    capabilityId: capability.capability_id,
    resource: Object.freeze({ kind, id: resourceRef.resource_id }),
    current: Object.freeze({
      version: resourceRef.version,
      digest: `sha256:${resourceRef.digest.value}`,
    }),
    fields: Object.freeze(schema.fields.map((field) => presentationField(field, schema.low_risk_draft_commit))),
    requiredRoles: Object.freeze([]),
    requiredCapabilities: Object.freeze([]),
    workflow: Object.freeze({
      draftFirst: true,
      publishMode: schema.low_risk_draft_commit ? 'explicit_publish' : 'proposal_only',
      directCommit: schema.low_risk_draft_commit ? 'policy_permitted_low_risk_draft' : 'never',
    }),
    reversibility: Object.freeze({
      mode: 'revert',
      requiresProposal: !schema.low_risk_draft_commit,
    }),
    available: true,
    availability: Object.freeze({ code: 'available', message: 'Editing is available.' }),
    immutableAlternatives: Object.freeze([]),
    policyRevision: input.opening.policy.revision,
  })
}

function assertPresentationAuthor(command: SharedEditCommand, session: AuthoritativeEditSession, live: AuthoritativeLiveAuthority): void {
  const author = command.author
  if (
    !IDENTIFIER.test(session.author.subject)
    || author.principalId !== session.author.subject
    || live.subject !== session.author.subject
    || author.kind !== session.author.kind
  ) {
    fail('identity_conflict')
  }
  if (author.kind === 'human') {
    if (session.author.delegation_id !== null || session.author.delegator !== null || live.activeDelegation !== null) fail('identity_conflict')
    return
  }
  if (
    !IDENTIFIER.test(author.delegationId) || !IDENTIFIER.test(author.delegatedBy)
    || author.delegationId !== session.author.delegation_id
    || author.delegatedBy !== session.author.delegator
    || live.revokedDelegationIds.includes(author.delegationId)
  ) fail('delegation_denied')
  const delegation = live.activeDelegation
  if (
    delegation === null
    || delegation.delegationId !== author.delegationId
    || delegation.delegate !== author.principalId
    || delegation.delegator !== author.delegatedBy
    || delegation.projectId !== live.projectId
    || delegation.capabilityId !== live.capabilityId
    || delegation.capabilityVersion !== live.capabilityVersion
    || delegation.capabilityDigest !== live.capabilityDigest
    || delegation.policyId !== live.policy.id
    || delegation.policyVersion !== live.policy.version
    || delegation.policyHash !== live.policy.hash
    || delegation.policyOutcome !== live.policy.outcome
    || Number.isNaN(Date.parse(delegation.validUntil))
    || Number.isNaN(Date.parse(live.now))
    || Date.parse(live.now) >= Date.parse(delegation.validUntil)
  ) fail('delegation_denied')
}

function assertOpeningAuthority(
  opening: AuthoritativeOpeningBinding,
  live: AuthoritativeCapabilityAuthority,
): void {
  if (
    !IDENTIFIER.test(opening.projectId)
    || opening.projectId !== live.projectId
    || !IDENTIFIER.test(live.projectId)
    || !IDENTIFIER.test(opening.policy.id)
    || !IDENTIFIER.test(opening.policy.version)
    || !DIGEST.test(opening.policy.hash)
    || !IDENTIFIER.test(opening.policy.revision)
    || !Number.isSafeInteger(opening.availabilityVersion)
    || opening.availabilityVersion < 1
  ) fail('policy_changed')
  if (
    opening.policy.id !== live.policy.id
    || opening.policy.version !== live.policy.version
    || opening.policy.hash !== live.policy.hash
    || opening.policy.outcome !== live.policy.outcome
    || opening.availabilityVersion !== live.availabilityVersion
    || live.policy.revision !== opening.policy.revision
  ) fail('policy_changed')
  if (!live.available || live.policy.outcome === 'deny') fail('policy_denied')
}

function assertCapabilityAuthority(
  opening: AuthoritativeOpeningBinding,
  live: AuthoritativeCapabilityAuthority,
  capability: AuthoritativeEditCapability,
  resourceRef: AuthoritativeResourceRef,
): void {
  assertOpeningAuthority(opening, live)
  if (
    live.capabilityId !== capability.capability_id
    || live.capabilityVersion !== capability.capability_version
    || live.capabilityDigest !== capability.capability_digest
  ) fail('capability_changed')
  if (!equal(live.registeredAction, capability.consequential_action)) fail('action_changed')
  if (!equal(validateAuthoritativeResourceRef(live.currentResourceRef), resourceRef)) fail('stale_resource')
  const permission = `edit:${resourceRef.resource_type}`
  if (!live.permissions.includes(permission) && !live.permissions.includes('edit:*')) fail('policy_denied')
}

function assertPolicy(
  opening: AuthoritativeOpeningBinding,
  live: AuthoritativeLiveAuthority,
  authoritativeSession: AuthoritativeEditSession,
  command: SharedEditCommand,
  session: EditSession,
): void {
  assertOpeningAuthority(opening, live)
  if (
    opening.projectId !== authoritativeSession.project_id
    || live.projectId !== authoritativeSession.project_id
  ) fail('identity_conflict')
  if (
    command.policyRevision !== opening.policy.revision
    || session.policyRevision !== opening.policy.revision
  ) fail('policy_changed')
}

function assertCapabilityAndAction(
  capability: AuthoritativeEditCapability,
  session: AuthoritativeEditSession,
  live: AuthoritativeLiveAuthority,
): void {
  if (
    session.capability_id !== capability.capability_id
    || session.capability_version !== capability.capability_version
    || session.capability_digest !== capability.capability_digest
    || live.capabilityId !== capability.capability_id
    || live.capabilityVersion !== capability.capability_version
    || live.capabilityDigest !== capability.capability_digest
  ) fail('capability_changed')
  if (!equal(live.registeredAction, capability.consequential_action)) fail('action_changed')
}

function assertResource(
  command: SharedEditCommand,
  presentationSession: EditSession,
  authoritativeSession: AuthoritativeEditSession,
  live: AuthoritativeLiveAuthority,
): void {
  const expected = authoritativeSession.resource_ref
  const current = validateAuthoritativeResourceRef(live.currentResourceRef)
  if (!equal(expected, current)) fail('stale_resource')
  const kind = presentationKind(expected.resource_type)
  if (
    command.resource.kind !== kind
    || presentationSession.resource.kind !== kind
    || command.resource.id !== expected.resource_id
    || presentationSession.resource.id !== expected.resource_id
  ) fail('ambiguous_mapping')
  const digest = `sha256:${expected.digest.value}`
  if (
    command.expected.version !== expected.version
    || presentationSession.base.version !== expected.version
    || command.expected.digest !== digest
    || presentationSession.base.digest !== digest
  ) fail('stale_resource')
  if (!command.expected.digest.startsWith('sha256:') || command.expected.digest.slice(7) !== expected.digest.value) fail('digest_mismatch')
}

function jsonValue(value: TypedFieldValue): JsonValue {
  if (Array.isArray(value)) return [...value]
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || Object.is(value, -0))) fail('invalid_patch')
  return value as JsonValue
}

function validateRuleValue(rule: AuthoritativeFieldRule, value: JsonValue): void {
  const encodedBytes = new TextEncoder().encode(canonicalJson(value)).length
  if (encodedBytes > 65_536) fail('invalid_patch')
  if (rule.kind === 'string' && (typeof value !== 'string' || new TextEncoder().encode(value).length > rule.maximum_length)) fail('invalid_patch')
  if (rule.kind === 'boolean' && typeof value !== 'boolean') fail('invalid_patch')
  if (rule.kind === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value))) fail('invalid_patch')
  if (rule.kind === 'string_list' && (!Array.isArray(value) || value.length > rule.maximum_length || value.some((item) => typeof item !== 'string' || new TextEncoder().encode(item).length > 4096))) fail('invalid_patch')
}

function patchFromChanges(changes: readonly EditChange[], schema: AuthoritativeResourceSchema): AuthoritativeTypedPatch {
  if (changes.length < 1 || changes.length > 128) fail('invalid_patch')
  const rules = new Map(schema.fields.map((rule) => [rule.field, rule]))
  const seen = new Set<string>()
  const operations = changes.map((change) => {
    if (!FIELD_POINTER.test(change.path)) fail('invalid_pointer')
    const field = change.path.slice(1)
    if (seen.has(field)) fail('ambiguous_mapping')
    seen.add(field)
    const rule = rules.get(field)
    if (!rule) fail('invalid_patch')
    if (change.kind === 'json_patch') {
      // Authoritative v1 collapses add/replace into set, so accepting either would
      // lose the presentation operation. The lossless subset supports remove only.
      if (change.op !== 'remove' || change.value !== undefined || rule.required) fail('invalid_patch')
      return { operation: 'remove' as const, field }
    }
    const value = change.value
    if (value === undefined) fail('invalid_patch')
    const normalized = jsonValue(value)
    validateRuleValue(rule, normalized)
    return { operation: 'set' as const, field, value: normalized }
  })
  return validateAuthoritativeTypedPatch({
    schema_version: 'opensaddle.typed-patch.v1',
    operations,
  })
}

function assertSubmission(
  submission: EditSubmissionProjection,
  command: SharedEditCommand,
  proposalRequired: boolean,
): void {
  if (!equal(submission.command, command) || submission.transportAvailable !== false) fail('identity_conflict')
  if (proposalRequired) {
    if (
      submission.kind !== 'operation_proposal'
      || submission.executionAvailable !== false
      || !equal(submission.lifecycle, ['proposal', 'approval', 'execution'])
    ) fail('proposal_required')
  } else if (submission.kind !== 'direct_commit') {
    fail('policy_denied')
  }
}

async function proposalInput(
  authoritativeSession: AuthoritativeEditSession,
  capability: AuthoritativeEditCapability,
  options: AuthoritativeProposalOptions | undefined,
): Promise<AuthoritativeProposalInput> {
  if (!options) fail('proposal_required')
  const protectedInputDigest = await sha256({
    resource_ref: authoritativeSession.resource_ref,
    draft_digest: authoritativeSession.draft_digest,
    session_version: authoritativeSession.version,
    capability_digest: capability.capability_digest,
    consequential_action: capability.consequential_action,
  })
  const value = {
    project_id: authoritativeSession.project_id,
    registered_action_id: capability.consequential_action.registered_action_id,
    registered_action_version: capability.consequential_action.registered_action_version,
    delegation_chain: authoritativeSession.author.kind === 'agent'
      ? [authoritativeSession.author.delegator, authoritativeSession.author.subject]
      : [],
    targets: [{ resource_ref: authoritativeSession.resource_ref, expected_version: authoritativeSession.resource_ref.version }],
    protected_input_digest: protectedInputDigest,
    validation_results: [
      { code: 'edit.schema_validated', passed: true, message: null },
      { code: 'edit.draft_has_changes', passed: true, message: null },
      { code: 'edit.proposal_required', passed: true, message: null },
      { code: `edit.effect.${capability.consequential_action.effect_class}`, passed: true, message: null },
    ],
    cost_estimate: {
      currency: options.currency ?? 'USD',
      estimated_microunits: options.estimatedMicrounits ?? 0,
      budget_microunits: options.budgetMicrounits ?? null,
    },
    correlation_ids: [...new Set(options.correlationIds)],
    expires_in_seconds: options.expiresInSeconds ?? 3600,
  }
  return validateAuthoritativeProposalInput(value)
}

/**
 * The only presentation-to-authority inverse adapter.
 * It returns validated command data and opaque failures; it cannot send, approve, or execute anything.
 */
export async function adaptPresentationCommandToAuthority(
  input: AdaptPresentationCommandInput,
): Promise<ValidatedAuthoritativeEditCommand> {
  const capability = validateAuthoritativeEditCapability(input.capability)
  const authoritativeSession = validateAuthoritativeEditSession(input.authoritativeSession)
  await assertCapabilityDigest(capability)
  const command = input.submission.command
  const presentationSession = input.presentationSession
  if (
    command.contractVersion !== EDITING_CONTRACT_VERSION
    || presentationSession.contractVersion !== EDITING_CONTRACT_VERSION
  ) fail('unsupported_contract')
  if (command.capabilityId !== capability.capability_id || presentationSession.capabilityId !== capability.capability_id) fail('capability_changed')
  if (presentationSession.sessionId !== authoritativeSession.session_id) fail('stale_session')
  if (
    input.live.currentSessionVersion !== authoritativeSession.version
    || input.live.currentDraftDigest !== authoritativeSession.draft_digest
  ) fail('stale_session')
  if (!equal(presentationSession.author, command.author) || !equal(presentationSession.changes, command.changes)) fail('identity_conflict')
  if (presentationSession.state !== 'ready' || presentationSession.conflict.status !== 'current' || presentationSession.validation.length > 0) fail('stale_session')
  assertCapabilityAndAction(capability, authoritativeSession, input.live)
  assertPolicy(input.opening, input.live, authoritativeSession, command, presentationSession)
  assertPresentationAuthor(command, authoritativeSession, input.live)
  assertResource(command, presentationSession, authoritativeSession, input.live)
  const schema = schemaFor(capability, authoritativeSession.resource_ref.resource_type)
  const permission = `edit:${schema.resource_type}`
  if (!input.live.permissions.includes(permission) && !input.live.permissions.includes('edit:*')) fail('policy_denied')
  const patch = patchFromChanges(command.changes, schema)
  const proposalRequired = input.opening.policy.outcome === 'proposal_required' || !schema.low_risk_draft_commit
  if (!proposalRequired && input.live.policy.outcome !== 'allow_commit') fail('policy_denied')
  assertSubmission(input.submission, command, proposalRequired)
  if (!IDENTIFIER.test(input.idempotencyKey)) fail('invalid_patch')
  const envelope: AuthoritativeApplyPatchEnvelope = {
    operation: 'apply_patch',
    session_id: authoritativeSession.session_id,
    expected_version: authoritativeSession.version,
    expected_resource_ref: authoritativeSession.resource_ref,
    patch,
    allow_rebase: false,
  }
  const requestDigest = await sha256(envelope)
  const proposal = proposalRequired
    ? await proposalInput(authoritativeSession, capability, input.proposal)
    : null
  return Object.freeze({
    envelope: Object.freeze(envelope),
    idempotency_key: input.idempotencyKey,
    request_digest: requestDigest,
    authority_binding: Object.freeze({
      project_id: authoritativeSession.project_id,
      capability_id: capability.capability_id,
      capability_version: capability.capability_version,
      capability_digest: capability.capability_digest,
      policy_id: input.live.policy.id,
      policy_version: input.live.policy.version,
      policy_hash: input.live.policy.hash,
      policy_outcome: input.live.policy.outcome,
      availability_version: input.live.availabilityVersion,
      author: authoritativeSession.author,
      registered_action_id: capability.consequential_action.registered_action_id,
      registered_action_version: capability.consequential_action.registered_action_version,
      registered_action_digest: capability.consequential_action.registered_action_digest,
    }),
    operation_proposal_request: proposal,
    approval_available: false,
    execution_available: false,
    transport_available: false,
  })
}
