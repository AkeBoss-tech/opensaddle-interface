import {
  EDITING_CONTRACT_PROVENANCE,
  EDITING_CONTRACT_VERSION,
  type EditAvailabilityCode,
  type EditCapability,
  type EditableResourceKind,
  type EditEffectClass,
  type EditFieldSchema,
  type EditResourceKind,
  type FieldValidation,
  type FieldValueType,
  type ImmutableAlternativeCapability,
  type ImmutableResourceKind,
  type SafeAvailability,
} from './contracts'
import { EditingUnavailableError } from './errors'
import { parseEditResourceVersion } from './version'

const EDITABLE_KINDS = new Set<EditableResourceKind>([
  'thread', 'plan_draft', 'workflow_definition', 'factory_definition', 'agent_configuration',
  'schedule', 'automation', 'semantic_package_draft', 'ontology_package_draft', 'connector_manifest',
])
const IMMUTABLE_KINDS = new Set<ImmutableResourceKind>([
  'evidence', 'capture', 'approval', 'audit_event', 'verification_event', 'receipt',
])
const EFFECTS = new Set<EditEffectClass>(['draft', 'low_risk', 'consequential'])
const VALUE_TYPES = new Set<FieldValueType>(['string', 'number', 'boolean', 'string_list', 'enum'])
const SAFE_AVAILABILITY: Readonly<Record<EditAvailabilityCode, SafeAvailability>> = Object.freeze({
  available: { code: 'available', message: 'Editing is available.' },
  immutable_resource: { code: 'immutable_resource', message: 'This record is immutable.' },
  policy_denied: { code: 'policy_denied', message: 'Editing is unavailable under the active policy.' },
  provider_unavailable: { code: 'provider_unavailable', message: 'Editing is temporarily unavailable.' },
  unsupported_resource: { code: 'unsupported_resource', message: 'This resource cannot be edited here.' },
})

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new EditingUnavailableError('invalid_snapshot')
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw new EditingUnavailableError('invalid_snapshot')
  return value
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 256)) {
    throw new EditingUnavailableError('invalid_snapshot')
  }
  return Object.freeze([...value])
}

function availability(value: unknown): SafeAvailability {
  if (typeof value !== 'string' || !(value in SAFE_AVAILABILITY)) throw new EditingUnavailableError('invalid_snapshot')
  return SAFE_AVAILABILITY[value as EditAvailabilityCode]
}

function validation(value: unknown): FieldValidation {
  const source = record(value)
  const result: FieldValidation = {}
  if (source.required !== undefined) {
    if (typeof source.required !== 'boolean') throw new EditingUnavailableError('invalid_snapshot')
    result.required = source.required
  }
  for (const key of ['minLength', 'maxLength', 'minimum', 'maximum'] as const) {
    const raw = source[key]
    if (raw !== undefined) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new EditingUnavailableError('invalid_snapshot')
      result[key] = raw
    }
  }
  if (source.pattern !== undefined) {
    const pattern = text(source.pattern)
    try { new RegExp(pattern, 'u') } catch { throw new EditingUnavailableError('invalid_snapshot') }
    result.pattern = pattern
  }
  if (source.options !== undefined) result.options = stringList(source.options)
  return Object.freeze(result)
}

function field(value: unknown): EditFieldSchema | undefined {
  const source = record(value)
  // Secret and denied field descriptors are dropped wholesale, including their path and validation metadata.
  if (source.sensitivity === 'secret' || source.availability === 'policy_denied') return undefined
  if (source.availability !== 'available') throw new EditingUnavailableError('invalid_snapshot')
  const path = text(source.path)
  if (!path.startsWith('/') || path.includes('//') || path.includes('/-') || /(?:^|\/)__proto__(?:\/|$)/.test(path)) {
    throw new EditingUnavailableError('invalid_snapshot')
  }
  if (typeof source.value_type !== 'string' || !VALUE_TYPES.has(source.value_type as FieldValueType)) {
    throw new EditingUnavailableError('invalid_snapshot')
  }
  if (typeof source.effect_class !== 'string' || !EFFECTS.has(source.effect_class as EditEffectClass)) {
    throw new EditingUnavailableError('invalid_snapshot')
  }
  return Object.freeze({
    path,
    label: text(source.label),
    valueType: source.value_type as FieldValueType,
    validation: validation(source.validation ?? {}),
    requiredRoles: stringList(source.required_roles ?? []),
    requiredCapabilities: stringList(source.required_capabilities ?? []),
    effectClass: source.effect_class as EditEffectClass,
  })
}

function immutableAlternatives(kind: ImmutableResourceKind): readonly ImmutableAlternativeCapability[] {
  const correction = kind === 'evidence' || kind === 'capture' || kind === 'receipt'
  return Object.freeze([
    { kind: 'annotation', available: true, availability: SAFE_AVAILABILITY.available },
    { kind: 'correction', available: correction, availability: correction ? SAFE_AVAILABILITY.available : SAFE_AVAILABILITY.unsupported_resource },
    { kind: 'supersession', available: true, availability: SAFE_AVAILABILITY.available },
  ])
}

export function adaptEditCapabilitySnapshot(value: unknown): EditCapability {
  const source = record(value)
  if (source.contract_version !== EDITING_CONTRACT_VERSION) throw new EditingUnavailableError('unsupported_contract')
  const resource = record(source.resource)
  const kind = text(resource.kind) as EditResourceKind
  if (!EDITABLE_KINDS.has(kind as EditableResourceKind) && !IMMUTABLE_KINDS.has(kind as ImmutableResourceKind)) {
    throw new EditingUnavailableError('unavailable')
  }
  const current = record(source.current)
  const version = parseEditResourceVersion(current.version, current.digest)
  if (!version) throw new EditingUnavailableError('invalid_snapshot')
  const immutable = IMMUTABLE_KINDS.has(kind as ImmutableResourceKind)
  if (typeof source.available !== 'boolean') throw new EditingUnavailableError('invalid_snapshot')
  const declaredAvailability = availability(source.availability)
  if (!immutable && source.available !== (declaredAvailability.code === 'available')) {
    throw new EditingUnavailableError('invalid_snapshot')
  }
  const available = source.available && !immutable
  const fields = immutable
    ? []
    : (() => {
        if (!Array.isArray(source.fields)) throw new EditingUnavailableError('invalid_snapshot')
        return source.fields.map(field).filter((item): item is EditFieldSchema => item !== undefined)
      })()
  const workflow = record(source.workflow)
  const reversibility = record(source.reversibility)
  if (workflow.draft_first !== true) throw new EditingUnavailableError('invalid_snapshot')
  if (workflow.publish_mode !== 'none' && workflow.publish_mode !== 'explicit_publish' && workflow.publish_mode !== 'proposal_only') {
    throw new EditingUnavailableError('invalid_snapshot')
  }
  if (workflow.direct_commit !== 'never' && workflow.direct_commit !== 'policy_permitted_low_risk_draft') {
    throw new EditingUnavailableError('invalid_snapshot')
  }
  if (reversibility.mode !== 'undo' && reversibility.mode !== 'revert' && reversibility.mode !== 'supersede' && reversibility.mode !== 'none') {
    throw new EditingUnavailableError('invalid_snapshot')
  }
  if (typeof reversibility.requires_proposal !== 'boolean') throw new EditingUnavailableError('invalid_snapshot')
  return Object.freeze({
    contractVersion: EDITING_CONTRACT_VERSION,
    provenance: EDITING_CONTRACT_PROVENANCE,
    capabilityId: text(source.capability_id),
    resource: Object.freeze({ kind, id: text(resource.id) }),
    current: version,
    fields: Object.freeze(fields),
    requiredRoles: stringList(source.required_roles ?? []),
    requiredCapabilities: stringList(source.required_capabilities ?? []),
    workflow: Object.freeze({
      draftFirst: true,
      publishMode: workflow.publish_mode,
      directCommit: workflow.direct_commit,
    }),
    reversibility: Object.freeze({ mode: reversibility.mode, requiresProposal: reversibility.requires_proposal }),
    available,
    availability: immutable ? SAFE_AVAILABILITY.immutable_resource : declaredAvailability,
    immutableAlternatives: immutable ? immutableAlternatives(kind as ImmutableResourceKind) : Object.freeze([]),
    policyRevision: text(source.policy_revision),
  })
}
