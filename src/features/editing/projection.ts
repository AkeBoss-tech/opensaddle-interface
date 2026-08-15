import {
  EDITING_CONTRACT_VERSION,
  type EditCapability,
  type EditEffectClass,
  type EditSession,
  type EditSubmissionProjection,
  type LiveEditPolicy,
  type SharedEditCommand,
} from './contracts'
import { EditingUnavailableError } from './errors'
import { sameEditResourceVersion } from './version'

function containsAll(actual: readonly string[], required: readonly string[]): boolean {
  const values = new Set(actual)
  return required.every((item) => values.has(item))
}

function normalizedChangeSet(changes: EditSession['changes']): string {
  return JSON.stringify(changes.map((change) => change.kind === 'field'
    ? ['field', change.path, change.value]
    : ['json_patch', change.op, change.path, change.op === 'remove' ? null : change.value]))
}

function changeSetFingerprint(changes: EditSession['changes']): SharedEditCommand['changeSetFingerprint'] {
  // Presentation identity only: deliberately named as non-cryptographic and never used as server authority.
  let fingerprint = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(normalizedChangeSet(changes))) {
    fingerprint ^= BigInt(byte)
    fingerprint = BigInt.asUintN(64, fingerprint * 0x100000001b3n)
  }
  return Object.freeze({
    algorithm: 'presentation-fnv1a64/v1',
    value: fingerprint.toString(16).padStart(16, '0'),
    authoritative: false,
  })
}

function commandId(session: EditSession, fingerprint: SharedEditCommand['changeSetFingerprint']): string {
  return `edit:${session.sessionId}:${session.base.digest}:${encodeURIComponent(fingerprint.value)}`
}

function strongestEffect(effects: readonly EditEffectClass[]): EditEffectClass {
  if (effects.includes('consequential')) return 'consequential'
  if (effects.includes('low_risk')) return 'low_risk'
  return 'draft'
}

/** Shared projection for human and agent authors. Author kind changes eligibility, never mutation semantics. */
export function projectEditSubmission(
  session: EditSession,
  capability: EditCapability,
  livePolicy: LiveEditPolicy,
): EditSubmissionProjection {
  if (!capability.available) throw new EditingUnavailableError(capability.availability.code === 'immutable_resource' ? 'immutable_resource' : 'unavailable')
  if (session.state !== 'ready' || session.conflict.status !== 'current') throw new EditingUnavailableError('validation_failed')
  if (session.validation.length > 0 || session.changes.length === 0) throw new EditingUnavailableError('validation_failed')
  if (session.capabilityId !== capability.capabilityId || session.resource.kind !== capability.resource.kind || session.resource.id !== capability.resource.id) {
    throw new EditingUnavailableError('validation_failed')
  }
  if (!sameEditResourceVersion(session.base, capability.current)) throw new EditingUnavailableError('stale_resource')
  if (!livePolicy.active || session.policyRevision !== capability.policyRevision || livePolicy.revision !== capability.policyRevision) {
    throw new EditingUnavailableError('policy_changed')
  }
  if (!livePolicy.permittedCapabilityIds.includes(capability.capabilityId)) throw new EditingUnavailableError('policy_denied')
  if (!containsAll(livePolicy.principalRoles, capability.requiredRoles) || !containsAll(livePolicy.principalCapabilities, capability.requiredCapabilities)) {
    throw new EditingUnavailableError('policy_denied')
  }
  if (!containsAll(session.author.roles, capability.requiredRoles) || !containsAll(session.author.capabilities, capability.requiredCapabilities)) {
    throw new EditingUnavailableError('policy_denied')
  }
  const fields = new Map(capability.fields.map((field) => [field.path, field]))
  const effects: EditEffectClass[] = []
  for (const change of session.changes) {
    const field = fields.get(change.path)
    if (
      !field
      || !containsAll(livePolicy.principalRoles, field.requiredRoles)
      || !containsAll(livePolicy.principalCapabilities, field.requiredCapabilities)
      || !containsAll(session.author.roles, field.requiredRoles)
      || !containsAll(session.author.capabilities, field.requiredCapabilities)
    ) {
      throw new EditingUnavailableError('policy_denied')
    }
    effects.push(field.effectClass)
  }
  if (session.author.kind === 'agent' && !session.author.delegatedCapabilityIds.includes(capability.capabilityId)) {
    throw new EditingUnavailableError('delegation_denied')
  }
  const fingerprint = changeSetFingerprint(session.changes)
  const command: SharedEditCommand = Object.freeze({
    contractVersion: EDITING_CONTRACT_VERSION,
    commandId: commandId(session, fingerprint),
    capabilityId: capability.capabilityId,
    resource: capability.resource,
    expected: session.base,
    policyRevision: livePolicy.revision,
    author: session.author,
    changes: session.changes,
    changeSetFingerprint: fingerprint,
  })
  const effectClass = strongestEffect(effects)
  const proposalReason = effectClass === 'consequential'
    ? 'consequential_effect'
    : capability.reversibility.requiresProposal
      ? 'reversibility_required'
      : 'workflow_required'
  if (effectClass === 'consequential' || capability.workflow.publishMode === 'proposal_only' || capability.reversibility.requiresProposal) {
    return Object.freeze({
      kind: 'operation_proposal',
      command,
      effectClass,
      proposalReason,
      lifecycle: Object.freeze(['proposal', 'approval', 'execution'] as const),
      executionAvailable: false,
      transportAvailable: false,
    })
  }
  if (
    capability.workflow.directCommit !== 'policy_permitted_low_risk_draft'
    || !livePolicy.allowLowRiskDraftDirectCommit
    || effects.some((effect) => effect !== 'draft' && effect !== 'low_risk')
  ) throw new EditingUnavailableError('policy_denied')
  return Object.freeze({ kind: 'direct_commit', command, transportAvailable: false })
}

export function assertAuthoritativeTransportAvailable(): never {
  throw new EditingUnavailableError('transport_unavailable')
}
