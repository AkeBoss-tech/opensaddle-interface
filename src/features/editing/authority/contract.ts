export const AUTHORITATIVE_EDIT_SOURCE_COMMIT = '742da04bf46a27ef5bd7988d0b1007f4a08338a0' as const

export const AUTHORITATIVE_EDIT_SNAPSHOT_SHA256 = Object.freeze({
  schema: '13442f5b5a6e0d3d7bc76025091d1dc2007cf28336a2eca0c88cfd0889d2dc38',
  fixture: '837757617b03f3d6eba2428b4dc63f63fce8a651fb3bc09b71d64158f1f278fd',
  readme: 'c75a122c00e1f7b41fb606efe27e567cf205be89db537e70f2bddc5eff721574',
} as const)

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type AuthoritativeFieldKind = 'string' | 'boolean' | 'integer' | 'string_list'
export type AuthoritativeEffectClass = 'external_write' | 'code_mutation' | 'runtime_execution' | 'destructive'

export interface AuthoritativeShaDigest {
  algorithm: 'sha-256'
  value: string
}

export interface AuthoritativeSourceVersion {
  source_id: string
  origin: string
  version: string
  digest: AuthoritativeShaDigest
}

export interface AuthoritativeResourceRef {
  issuer: string
  resource_id: string
  resource_type: string
  version: string
  digest: AuthoritativeShaDigest
  source: AuthoritativeSourceVersion
}

export interface AuthoritativeAuthor {
  subject: string
  kind: 'human' | 'agent'
  delegation_id: string | null
  delegator: string | null
}

export interface AuthoritativeFieldRule {
  field: string
  kind: AuthoritativeFieldKind
  required: boolean
  maximum_length: number
}

export interface AuthoritativeResourceSchema {
  resource_type: string
  fields: AuthoritativeFieldRule[]
  low_risk_draft_commit: boolean
}

export interface AuthoritativeConsequentialAction {
  registered_action_id: string
  registered_action_version: number
  registered_action_digest: string
  effect_class: AuthoritativeEffectClass
  requires_proposal: true
}

export interface AuthoritativeEditCapability {
  schema_version: 'opensaddle.edit-capability.v1'
  capability_id: string
  capability_version: number
  issuer: string
  resource_schemas: AuthoritativeResourceSchema[]
  consequential_action: AuthoritativeConsequentialAction
  effects: { draft_edit: true; external_effects: false }
  capability_digest: string
}

export interface AuthoritativePatchOperation {
  operation: 'set' | 'remove'
  field: string
  value?: JsonValue
}

export interface AuthoritativeTypedPatch {
  schema_version: 'opensaddle.typed-patch.v1'
  operations: AuthoritativePatchOperation[]
}

export interface AuthoritativeEditSession {
  schema_version: 'opensaddle.edit-session.v1'
  session_id: string
  project_id: string
  capability_id: string
  capability_version: number
  capability_digest: string
  resource_ref: AuthoritativeResourceRef
  author: AuthoritativeAuthor
  version: number
  draft_digest: string
  resource_state: 'draft' | 'published'
  last_autosaved_at: string
  recovery_token_digest: string
  history_length: number
}

export interface AuthoritativeValidationFinding {
  code: string
  level: 'info' | 'warning' | 'error'
  field: string | null
  disclosure: string
}

export interface AuthoritativeEditResult {
  schema_version: 'opensaddle.edit-result.v1'
  session: AuthoritativeEditSession
  diff: {
    changed_fields: string[]
    before_digest: string
    after_digest: string
    validation: AuthoritativeValidationFinding[]
  }
  applied: boolean
  rebased: boolean
  omissions_present: boolean
  proposal_required: boolean
  published: boolean
}

export interface AuthoritativeProposalInput {
  project_id: string
  registered_action_id: string
  registered_action_version: number
  delegation_chain: string[]
  targets: [{ resource_ref: AuthoritativeResourceRef; expected_version: string }]
  protected_input_digest: string
  validation_results: Array<{ code: string; passed: boolean; message: string | null }>
  cost_estimate: { currency: string; estimated_microunits: number; budget_microunits: number | null }
  correlation_ids: string[]
  expires_in_seconds: number
}

export type AuthoritativeEditDocument =
  | AuthoritativeEditCapability
  | AuthoritativeTypedPatch
  | AuthoritativeEditSession
  | AuthoritativeEditResult
  | AuthoritativeProposalInput

export interface AuthoritativeClientFixture {
  capability: AuthoritativeEditCapability
  patch: AuthoritativeTypedPatch
  operation_proposal_request: AuthoritativeProposalInput
  typed_failures: string[]
  immutable_correction_commands: string[]
}

const DIGEST = /^[a-f0-9]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const FIELD = /^[a-z][a-z0-9_]{0,127}$/
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/

export type AuthoritativeValidationCode =
  | 'unsupported_schema'
  | 'invalid_document'
  | 'invalid_identity'
  | 'invalid_digest'
  | 'invalid_patch'

export class AuthoritativeEditValidationError extends Error {
  readonly code: AuthoritativeValidationCode

  constructor(code: AuthoritativeValidationCode) {
    super('The authoritative edit document is invalid or unsupported.')
    this.name = 'AuthoritativeEditValidationError'
    this.code = code
  }
}

function fail(code: AuthoritativeValidationCode = 'invalid_document'): never {
  throw new AuthoritativeEditValidationError(code)
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

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) return fail()
  return value
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) return fail()
  return value as number
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') return fail()
  return value
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) return fail('invalid_digest')
  return value
}

function uri(value: unknown, max = Number.MAX_SAFE_INTEGER): string {
  const result = text(value, 1, max)
  if (!URI.test(result)) return fail('invalid_identity')
  return result
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(jsonValue)
  const source = object(value)
  const result: { [key: string]: JsonValue } = {}
  for (const [key, item] of Object.entries(source)) result[key] = jsonValue(item)
  return result
}

function shaDigest(value: unknown): AuthoritativeShaDigest {
  const source = object(value)
  exact(source, ['algorithm', 'value'])
  if (source.algorithm !== 'sha-256') fail('invalid_digest')
  return { algorithm: 'sha-256', value: digest(source.value) }
}

function sourceVersion(value: unknown): AuthoritativeSourceVersion {
  const source = object(value)
  exact(source, ['source_id', 'origin', 'version', 'digest'])
  return {
    source_id: text(source.source_id, 1, 512),
    origin: uri(source.origin, 932),
    version: text(source.version, 1, 200),
    digest: shaDigest(source.digest),
  }
}

export function validateAuthoritativeResourceRef(value: unknown): AuthoritativeResourceRef {
  const source = object(value)
  exact(source, ['issuer', 'resource_id', 'resource_type', 'version', 'digest', 'source'])
  const resourceType = text(source.resource_type, 1, 200)
  if (!IDENTIFIER.test(resourceType)) fail('invalid_identity')
  return {
    issuer: uri(source.issuer, 512),
    resource_id: text(source.resource_id, 1, 512),
    resource_type: resourceType,
    version: text(source.version, 1, 256),
    digest: shaDigest(source.digest),
    source: sourceVersion(source.source),
  }
}

function author(value: unknown): AuthoritativeAuthor {
  const source = object(value)
  exact(source, ['subject', 'kind', 'delegation_id', 'delegator'])
  if (source.kind !== 'human' && source.kind !== 'agent') fail('invalid_identity')
  const nullable = (item: unknown): string | null => item === null ? null : text(item, 0, 200)
  return {
    subject: text(source.subject, 1, 200),
    kind: source.kind,
    delegation_id: nullable(source.delegation_id),
    delegator: nullable(source.delegator),
  }
}

function fieldRule(value: unknown): AuthoritativeFieldRule {
  const source = object(value)
  exact(source, ['field', 'kind', 'required', 'maximum_length'])
  const field = text(source.field, 1, 128)
  if (!FIELD.test(field)) fail('invalid_patch')
  if (!['string', 'boolean', 'integer', 'string_list'].includes(source.kind as string)) fail('invalid_patch')
  return {
    field,
    kind: source.kind as AuthoritativeFieldKind,
    required: bool(source.required),
    maximum_length: integer(source.maximum_length, 1, 65_536),
  }
}

function resourceSchema(value: unknown): AuthoritativeResourceSchema {
  const source = object(value)
  exact(source, ['resource_type', 'fields', 'low_risk_draft_commit'])
  if (!Array.isArray(source.fields) || source.fields.length < 1 || source.fields.length > 128) fail()
  const fields = source.fields.map(fieldRule)
  if (new Set(fields.map((item) => item.field)).size !== fields.length) fail('invalid_patch')
  return {
    resource_type: text(source.resource_type, 1, 200),
    fields,
    low_risk_draft_commit: bool(source.low_risk_draft_commit),
  }
}

function action(value: unknown): AuthoritativeConsequentialAction {
  const source = object(value)
  exact(source, ['registered_action_id', 'registered_action_version', 'registered_action_digest', 'effect_class', 'requires_proposal'])
  const actionId = text(source.registered_action_id, 1, 200)
  if (!/^act_[A-Za-z0-9]+$/.test(actionId) || !['external_write', 'code_mutation', 'runtime_execution', 'destructive'].includes(source.effect_class as string) || source.requires_proposal !== true) fail('invalid_identity')
  return {
    registered_action_id: actionId,
    registered_action_version: integer(source.registered_action_version, 1),
    registered_action_digest: digest(source.registered_action_digest),
    effect_class: source.effect_class as AuthoritativeEffectClass,
    requires_proposal: true,
  }
}

function capability(value: unknown): AuthoritativeEditCapability {
  const source = object(value)
  exact(source, ['schema_version', 'capability_id', 'capability_version', 'issuer', 'resource_schemas', 'consequential_action', 'effects', 'capability_digest'])
  if (source.schema_version !== 'opensaddle.edit-capability.v1') fail('unsupported_schema')
  if (!Array.isArray(source.resource_schemas) || source.resource_schemas.length < 1 || source.resource_schemas.length > 64) fail()
  const effects = object(source.effects)
  exact(effects, ['draft_edit', 'external_effects'])
  if (effects.draft_edit !== true || effects.external_effects !== false) fail()
  const schemas = source.resource_schemas.map(resourceSchema)
  if (new Set(schemas.map((item) => item.resource_type)).size !== schemas.length) fail('invalid_identity')
  return {
    schema_version: 'opensaddle.edit-capability.v1',
    capability_id: text(source.capability_id, 1, 200),
    capability_version: integer(source.capability_version, 1),
    issuer: uri(source.issuer),
    resource_schemas: schemas,
    consequential_action: action(source.consequential_action),
    effects: { draft_edit: true, external_effects: false },
    capability_digest: digest(source.capability_digest),
  }
}

function patch(value: unknown): AuthoritativeTypedPatch {
  const source = object(value)
  exact(source, ['schema_version', 'operations'])
  if (source.schema_version !== 'opensaddle.typed-patch.v1') fail('unsupported_schema')
  if (!Array.isArray(source.operations) || source.operations.length < 1 || source.operations.length > 128) fail('invalid_patch')
  const operations = source.operations.map((raw): AuthoritativePatchOperation => {
    const item = object(raw)
    if (item.operation === 'set') {
      exact(item, ['operation', 'field', 'value'])
      const field = text(item.field, 1, 128)
      if (!FIELD.test(field)) fail('invalid_patch')
      return { operation: 'set', field, value: jsonValue(item.value) }
    }
    if (item.operation === 'remove') {
      exact(item, ['operation', 'field'])
      const field = text(item.field, 1, 128)
      if (!FIELD.test(field)) fail('invalid_patch')
      return { operation: 'remove', field }
    }
    return fail('invalid_patch')
  })
  if (new Set(operations.map((item) => item.field)).size !== operations.length) fail('invalid_patch')
  return { schema_version: 'opensaddle.typed-patch.v1', operations }
}

function session(value: unknown): AuthoritativeEditSession {
  const source = object(value)
  exact(source, ['schema_version', 'session_id', 'project_id', 'capability_id', 'capability_version', 'capability_digest', 'resource_ref', 'author', 'version', 'draft_digest', 'resource_state', 'last_autosaved_at', 'recovery_token_digest', 'history_length'])
  if (source.schema_version !== 'opensaddle.edit-session.v1') fail('unsupported_schema')
  const sessionId = text(source.session_id, 37, 37)
  if (!/^edit_[a-f0-9]{32}$/.test(sessionId)) fail('invalid_identity')
  const at = text(source.last_autosaved_at, 1, 200)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) fail()
  if (source.resource_state !== 'draft' && source.resource_state !== 'published') fail()
  return {
    schema_version: 'opensaddle.edit-session.v1',
    session_id: sessionId,
    project_id: text(source.project_id, 1, 200),
    capability_id: text(source.capability_id, 0, Number.MAX_SAFE_INTEGER),
    capability_version: integer(source.capability_version, 1),
    capability_digest: digest(source.capability_digest),
    resource_ref: validateAuthoritativeResourceRef(source.resource_ref),
    author: author(source.author),
    version: integer(source.version, 0),
    draft_digest: digest(source.draft_digest),
    resource_state: source.resource_state,
    last_autosaved_at: at,
    recovery_token_digest: digest(source.recovery_token_digest),
    history_length: integer(source.history_length, 0, 128),
  }
}

function finding(value: unknown): AuthoritativeValidationFinding {
  const source = object(value)
  exact(source, ['code', 'level', 'field', 'disclosure'])
  if (!['info', 'warning', 'error'].includes(source.level as string)) fail()
  return {
    code: text(source.code, 1, 200),
    level: source.level as AuthoritativeValidationFinding['level'],
    field: source.field === null ? null : text(source.field, 0, 128),
    disclosure: text(source.disclosure, 1, 1024),
  }
}

function result(value: unknown): AuthoritativeEditResult {
  const source = object(value)
  exact(source, ['schema_version', 'session', 'diff', 'applied', 'rebased', 'omissions_present', 'proposal_required', 'published'])
  if (source.schema_version !== 'opensaddle.edit-result.v1') fail('unsupported_schema')
  const diff = object(source.diff)
  exact(diff, ['changed_fields', 'before_digest', 'after_digest', 'validation'])
  if (!Array.isArray(diff.changed_fields) || diff.changed_fields.length > 128 || diff.changed_fields.some((item) => typeof item !== 'string') || new Set(diff.changed_fields).size !== diff.changed_fields.length) fail()
  if (!Array.isArray(diff.validation) || diff.validation.length > 128) fail()
  return {
    schema_version: 'opensaddle.edit-result.v1',
    session: session(source.session),
    diff: {
      changed_fields: [...diff.changed_fields] as string[],
      before_digest: digest(diff.before_digest),
      after_digest: digest(diff.after_digest),
      validation: diff.validation.map(finding),
    },
    applied: bool(source.applied),
    rebased: bool(source.rebased),
    omissions_present: bool(source.omissions_present),
    proposal_required: bool(source.proposal_required),
    published: bool(source.published),
  }
}

function proposal(value: unknown): AuthoritativeProposalInput {
  const source = object(value)
  exact(source, ['project_id', 'registered_action_id', 'registered_action_version', 'delegation_chain', 'targets', 'protected_input_digest', 'validation_results', 'cost_estimate', 'correlation_ids', 'expires_in_seconds'])
  const actionId = text(source.registered_action_id, 1, 200)
  if (!/^act_[A-Za-z0-9]+$/.test(actionId)) fail('invalid_identity')
  if (!Array.isArray(source.delegation_chain) || source.delegation_chain.length > 32) fail()
  const delegationChain = source.delegation_chain.map((item) => text(item, 1, 200))
  if (!Array.isArray(source.targets) || source.targets.length !== 1) fail()
  const target = object(source.targets[0])
  exact(target, ['resource_ref', 'expected_version'])
  if (!Array.isArray(source.validation_results) || source.validation_results.length < 1 || source.validation_results.length > 16) fail()
  const validationResults = source.validation_results.map((raw) => {
    const item = object(raw)
    exact(item, ['code', 'passed', 'message'])
    return { code: text(item.code, 1, 200), passed: bool(item.passed), message: item.message === null ? null : text(item.message, 0, 1000) }
  })
  const cost = object(source.cost_estimate)
  exact(cost, ['currency', 'estimated_microunits', 'budget_microunits'])
  const currency = text(cost.currency, 3, 16)
  if (!/^[A-Z][A-Z0-9_]{2,15}$/.test(currency)) fail()
  if (!Array.isArray(source.correlation_ids) || source.correlation_ids.length < 1 || source.correlation_ids.length > 32) fail()
  const correlationIds = source.correlation_ids.map((item) => {
    const value = text(item, 1, 200)
    if (!IDENTIFIER.test(value)) fail('invalid_identity')
    return value
  })
  if (new Set(correlationIds).size !== correlationIds.length) fail()
  return {
    project_id: text(source.project_id, 1, 200),
    registered_action_id: actionId,
    registered_action_version: integer(source.registered_action_version, 1),
    delegation_chain: delegationChain,
    targets: [{ resource_ref: validateAuthoritativeResourceRef(target.resource_ref), expected_version: text(target.expected_version, 1, 256) }],
    protected_input_digest: digest(source.protected_input_digest),
    validation_results: validationResults,
    cost_estimate: {
      currency,
      estimated_microunits: integer(cost.estimated_microunits, 0),
      budget_microunits: cost.budget_microunits === null ? null : integer(cost.budget_microunits, 0),
    },
    correlation_ids: correlationIds,
    expires_in_seconds: integer(source.expires_in_seconds, 60, 86_400),
  }
}

export function validateAuthoritativeEditDocument(value: unknown): AuthoritativeEditDocument {
  const source = object(value)
  if ('schema_version' in source) {
    if (source.schema_version === 'opensaddle.edit-capability.v1') return capability(source)
    if (source.schema_version === 'opensaddle.typed-patch.v1') return patch(source)
    if (source.schema_version === 'opensaddle.edit-session.v1') return session(source)
    if (source.schema_version === 'opensaddle.edit-result.v1') return result(source)
    return fail('unsupported_schema')
  }
  return proposal(source)
}

export function validateAuthoritativeEditCapability(value: unknown): AuthoritativeEditCapability {
  const document = validateAuthoritativeEditDocument(value)
  if (!('schema_version' in document) || document.schema_version !== 'opensaddle.edit-capability.v1') fail('unsupported_schema')
  return document
}

export function validateAuthoritativeTypedPatch(value: unknown): AuthoritativeTypedPatch {
  const document = validateAuthoritativeEditDocument(value)
  if (!('schema_version' in document) || document.schema_version !== 'opensaddle.typed-patch.v1') fail('unsupported_schema')
  return document
}

export function validateAuthoritativeEditSession(value: unknown): AuthoritativeEditSession {
  const document = validateAuthoritativeEditDocument(value)
  if (!('schema_version' in document) || document.schema_version !== 'opensaddle.edit-session.v1') fail('unsupported_schema')
  return document
}

export function validateAuthoritativeProposalInput(value: unknown): AuthoritativeProposalInput {
  const document = validateAuthoritativeEditDocument(value)
  if ('schema_version' in document) fail('unsupported_schema')
  return document
}

export function validateAuthoritativeClientFixture(value: unknown): AuthoritativeClientFixture {
  const source = object(value)
  exact(source, ['capability', 'patch', 'operation_proposal_request', 'typed_failures', 'immutable_correction_commands'])
  if (!Array.isArray(source.typed_failures) || source.typed_failures.some((item) => typeof item !== 'string')) fail()
  if (!Array.isArray(source.immutable_correction_commands) || source.immutable_correction_commands.some((item) => typeof item !== 'string')) fail()
  return {
    capability: capability(source.capability),
    patch: patch(source.patch),
    operation_proposal_request: proposal(source.operation_proposal_request),
    typed_failures: [...source.typed_failures] as string[],
    immutable_correction_commands: [...source.immutable_correction_commands] as string[],
  }
}
