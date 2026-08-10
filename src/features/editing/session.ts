import {
  EDITING_CONTRACT_VERSION,
  type EditCapability,
  type EditAuthor,
  type EditChange,
  type EditDiffEntry,
  type EditSession,
  type EditValidationIssue,
  type FieldValueType,
  type LocalRecoveryPolicy,
  type TypedFieldValue,
} from './contracts'
import { EditingUnavailableError } from './errors'

function typeMatches(valueType: FieldValueType, value: TypedFieldValue | undefined): boolean {
  if (value === undefined) return false
  if (valueType === 'string' || valueType === 'enum') return typeof value === 'string'
  if (valueType === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (valueType === 'boolean') return typeof value === 'boolean'
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function validateEditChanges(capability: EditCapability, changes: readonly EditChange[]): readonly EditValidationIssue[] {
  const fields = new Map(capability.fields.map((field) => [field.path, field]))
  const issues: EditValidationIssue[] = []
  for (const change of changes) {
    const field = fields.get(change.path)
    if (!field) {
      issues.push({ code: 'unavailable', message: 'A change targets an unavailable field.' })
      continue
    }
    const value = change.kind === 'json_patch' && change.op === 'remove' ? undefined : change.value
    if (value === undefined) {
      if (field.validation.required) issues.push({ path: field.path, code: 'required', message: 'A required value cannot be removed.' })
      continue
    }
    if (!typeMatches(field.valueType, value)) {
      issues.push({ path: field.path, code: 'type', message: 'The value has an unsupported type.' })
      continue
    }
    if (typeof value === 'string') {
      if (field.validation.minLength !== undefined && value.length < field.validation.minLength) issues.push({ path: field.path, code: 'length', message: 'The value is too short.' })
      if (field.validation.maxLength !== undefined && value.length > field.validation.maxLength) issues.push({ path: field.path, code: 'length', message: 'The value is too long.' })
      if (field.validation.pattern !== undefined && !new RegExp(field.validation.pattern, 'u').test(value)) issues.push({ path: field.path, code: 'pattern', message: 'The value has an invalid format.' })
      if (field.validation.options !== undefined && !field.validation.options.includes(value)) issues.push({ path: field.path, code: 'option', message: 'The value is not an available option.' })
    }
    if (typeof value === 'number') {
      if (field.validation.minimum !== undefined && value < field.validation.minimum) issues.push({ path: field.path, code: 'range', message: 'The value is below the allowed range.' })
      if (field.validation.maximum !== undefined && value > field.validation.maximum) issues.push({ path: field.path, code: 'range', message: 'The value is above the allowed range.' })
    }
  }
  return Object.freeze(issues)
}

export function buildEditDiff(capability: EditCapability, changes: readonly EditChange[]): readonly EditDiffEntry[] {
  const allowed = new Set(capability.fields.map((field) => field.path))
  return Object.freeze(changes.flatMap((change): EditDiffEntry[] => {
    if (!allowed.has(change.path)) return []
    if (change.kind === 'field') return [{ path: change.path, operation: 'replace', value: change.value }]
    return [{ path: change.path, operation: change.op, ...(change.value === undefined ? {} : { value: change.value }) }]
  }))
}

function retainAllowedChanges(capability: EditCapability, changes: readonly EditChange[]): readonly EditChange[] {
  const allowed = new Set(capability.fields.map((field) => field.path))
  return Object.freeze(changes.flatMap((change): EditChange[] => {
    if (!allowed.has(change.path)) return []
    if (change.kind === 'field') {
      const value = Array.isArray(change.value) ? Object.freeze([...change.value]) : change.value
      return [Object.freeze({ ...change, value })]
    }
    if (change.op === 'remove') return [Object.freeze({ kind: 'json_patch', op: 'remove', path: change.path })]
    const value = Array.isArray(change.value) ? Object.freeze([...change.value]) : change.value
    return [Object.freeze({ ...change, ...(value === undefined ? {} : { value }) })]
  }))
}

function freezeAuthor(author: EditAuthor): EditAuthor {
  if (author.kind === 'human') {
    return Object.freeze({ ...author, roles: Object.freeze([...author.roles]), capabilities: Object.freeze([...author.capabilities]) })
  }
  return Object.freeze({
    ...author,
    delegatedCapabilityIds: Object.freeze([...author.delegatedCapabilityIds]),
    roles: Object.freeze([...author.roles]),
    capabilities: Object.freeze([...author.capabilities]),
  })
}

export interface CreateEditSessionInput {
  sessionId: string
  capability: EditCapability
  author: EditSession['author']
  changes?: readonly EditChange[]
  recovery?: LocalRecoveryPolicy
}

export function createEditSession(input: CreateEditSessionInput): EditSession {
  if (!input.capability.available) {
    throw new EditingUnavailableError(input.capability.availability.code === 'immutable_resource' ? 'immutable_resource' : 'unavailable')
  }
  const requestedChanges = input.changes ?? []
  const changes = retainAllowedChanges(input.capability, requestedChanges)
  const validation = [
    ...(requestedChanges.length === changes.length ? [] : [{ code: 'unavailable', message: 'A change targets an unavailable field.' } as const]),
    ...validateEditChanges(input.capability, changes),
  ]
  const recovery: LocalRecoveryPolicy = input.recovery ?? { mode: 'memory', authoritative: false }
  return Object.freeze({
    contractVersion: EDITING_CONTRACT_VERSION,
    sessionId: input.sessionId,
    capabilityId: input.capability.capabilityId,
    resource: input.capability.resource,
    base: input.capability.current,
    policyRevision: input.capability.policyRevision,
    state: validation.length === 0 ? 'ready' : 'draft',
    changes,
    undoStack: Object.freeze([]),
    recovery: Object.freeze(recovery),
    validation,
    diff: buildEditDiff(input.capability, changes),
    author: freezeAuthor(input.author),
    conflict: Object.freeze({ status: 'current' }),
  })
}

export function replaceEditChanges(session: EditSession, capability: EditCapability, changes: readonly EditChange[]): EditSession {
  const next = retainAllowedChanges(capability, changes)
  const validation = [
    ...(changes.length === next.length ? [] : [{ code: 'unavailable', message: 'A change targets an unavailable field.' } as const]),
    ...validateEditChanges(capability, next),
  ]
  return Object.freeze({
    ...session,
    state: validation.length === 0 ? 'ready' : 'draft',
    changes: next,
    undoStack: Object.freeze([...session.undoStack, session.changes]),
    validation,
    diff: buildEditDiff(capability, next),
  })
}


export function markEditSessionStale(
  session: EditSession,
  latest: EditSession['base'],
  canRebase: boolean,
): EditSession {
  return Object.freeze({
    ...session,
    state: 'draft',
    conflict: Object.freeze({ status: 'stale', latest, canCompare: true, canRebase }),
  })
}

export function rebaseEditSession(
  session: EditSession,
  capability: EditCapability,
  latest: EditSession['base'],
  conflictingPaths: readonly string[] = [],
): EditSession {
  const visiblePaths = new Set(capability.fields.map((field) => field.path))
  const safeConflicts = Object.freeze(conflictingPaths.filter((path) => visiblePaths.has(path)))
  return Object.freeze({
    ...session,
    base: latest,
    conflict: safeConflicts.length > 0
      ? Object.freeze({ status: 'conflicted', latest, paths: safeConflicts })
      : Object.freeze({ status: 'current' }),
  })
}

export function undoEditChanges(session: EditSession, capability: EditCapability): EditSession {
  const previous = session.undoStack.at(-1)
  if (!previous) return session
  const validation = validateEditChanges(capability, previous)
  return Object.freeze({
    ...session,
    state: validation.length === 0 ? 'ready' : 'draft',
    changes: previous,
    undoStack: Object.freeze(session.undoStack.slice(0, -1)),
    validation,
    diff: buildEditDiff(capability, previous),
  })
}
