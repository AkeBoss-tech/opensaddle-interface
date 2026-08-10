import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EDITING_CONTRACT_PROVENANCE,
  EDITING_CONTRACT_VERSION,
  EditingUnavailableError,
  adaptEditCapabilitySnapshot,
  assertAuthoritativeTransportAvailable,
  createEditSession,
  markEditSessionStale,
  parseEditResourceVersion,
  projectEditSubmission,
  rebaseEditSession,
  replaceEditChanges,
  undoEditChanges,
} from '../src/features/editing/index.ts'
import {
  DIGEST_A,
  DIGEST_B,
  agentAuthor,
  humanAuthor,
  immutableEvidenceSnapshot,
  livePolicy,
  planCapabilitySnapshot,
} from './fixtures/editingConformance.ts'

function errorCode(action: () => unknown): string | undefined {
  try { action() } catch (error) {
    assert.ok(error instanceof EditingUnavailableError)
    return error.code
  }
  return undefined
}

test('adapts only the versioned client snapshot with explicit non-authoritative provenance', () => {
  const capability = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
  assert.equal(capability.contractVersion, EDITING_CONTRACT_VERSION)
  assert.deepEqual(capability.provenance, EDITING_CONTRACT_PROVENANCE)
  assert.deepEqual(capability.current, { version: 'revision:7', digest: DIGEST_A })
  assert.deepEqual(capability.fields.map((field) => field.path), ['/objective', '/publish'])
  assert.equal(JSON.stringify(capability).includes('SECRET'), false)
  assert.equal(errorCode(() => adaptEditCapabilitySnapshot({ ...planCapabilitySnapshot, contract_version: 'opensaddle.interface-editing.presentation/v2' })), 'unsupported_contract')
  assert.equal(errorCode(() => adaptEditCapabilitySnapshot({ ...planCapabilitySnapshot, availability: 'policy_denied' })), 'invalid_snapshot')
})

test('version parsing is exact and unknown forms fail closed', () => {
  assert.deepEqual(parseEditResourceVersion('revision:7', DIGEST_A), { version: 'revision:7', digest: DIGEST_A })
  assert.deepEqual(parseEditResourceVersion('etag:"abc"', DIGEST_A), { version: 'etag:"abc"', digest: DIGEST_A })
  assert.equal(parseEditResourceVersion('7', DIGEST_A), undefined)
  assert.equal(parseEditResourceVersion('revision:', DIGEST_A), undefined)
  assert.equal(parseEditResourceVersion('revision:7', 'sha256:ABC'), undefined)
})

test('human and delegated agent authors project through the same command semantics', () => {
  const capability = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
  const changes = [{ kind: 'field', path: '/objective', value: 'Ship grounded editing' }] as const
  const human = projectEditSubmission(createEditSession({ sessionId: 'session-1', capability, author: humanAuthor, changes }), capability, livePolicy)
  const agent = projectEditSubmission(createEditSession({ sessionId: 'session-1', capability, author: agentAuthor, changes }), capability, livePolicy)
  assert.equal(human.kind, 'direct_commit')
  assert.equal(agent.kind, 'direct_commit')
  assert.deepEqual({ ...human.command, author: undefined }, { ...agent.command, author: undefined })
  assert.equal(human.transportAvailable, false)
  assert.equal(human.command.changeSetFingerprint.authoritative, false)
})

test('add and replace JSON Patch operations always require a value', () => {
  const capability = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
  for (const op of ['add', 'replace'] as const) {
    const session = createEditSession({
      sessionId: `missing-${op}`,
      capability,
      author: humanAuthor,
      changes: [{ kind: 'json_patch', op, path: '/objective' }],
    })
    assert.equal(session.state, 'draft')
    assert.deepEqual(session.validation, [{ path: '/objective', code: 'required', message: 'This patch operation requires a value.' }])
    assert.equal(errorCode(() => projectEditSubmission(session, capability, livePolicy)), 'validation_failed')
  }
  const remove = createEditSession({
    sessionId: 'remove-optional', capability, author: humanAuthor,
    changes: [{ kind: 'json_patch', op: 'remove', path: '/objective' }],
  })
  assert.equal(remove.validation[0]?.code, 'required', 'required schema still independently rejects removal')
})

test('command identity binds exact normalized changes and remains stable for equivalent content', () => {
  const capability = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
  const session = (value: string) => createEditSession({
    sessionId: 'identity-session', capability, author: humanAuthor,
    changes: [{ kind: 'field', path: '/objective', value }],
  })
  const first = projectEditSubmission(session('First objective'), capability, livePolicy)
  const equivalent = projectEditSubmission(session('First objective'), capability, livePolicy)
  const changed = projectEditSubmission(session('Changed objective'), capability, livePolicy)
  assert.equal(first.command.commandId, equivalent.command.commandId)
  assert.deepEqual(first.command.changeSetFingerprint, equivalent.command.changeSetFingerprint)
  assert.notEqual(first.command.commandId, changed.command.commandId)
  assert.notDeepEqual(first.command.changeSetFingerprint, changed.command.changeSetFingerprint)
  assert.equal(first.command.changeSetFingerprint.algorithm, 'presentation-fnv1a64/v1')
})

test('human and agent permission failures are equivalent while agents also require exact delegation', () => {
  const capability = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
  const changes = [{ kind: 'field', path: '/objective', value: 'Ship grounded editing' }] as const
  const deniedPolicy = { ...livePolicy, principalCapabilities: [] }
  const human = createEditSession({ sessionId: 'human', capability, author: humanAuthor, changes })
  const agent = createEditSession({ sessionId: 'agent', capability, author: agentAuthor, changes })
  assert.equal(errorCode(() => projectEditSubmission(human, capability, deniedPolicy)), 'policy_denied')
  assert.equal(errorCode(() => projectEditSubmission(agent, capability, deniedPolicy)), 'policy_denied')
  const undelegated = { ...agentAuthor, delegatedCapabilityIds: [] }
  const undelegatedSession = createEditSession({ sessionId: 'agent-2', capability, author: undelegated, changes })
  assert.equal(errorCode(() => projectEditSubmission(undelegatedSession, capability, livePolicy)), 'delegation_denied')
})

test('stale version or digest and policy change or revocation races fail closed', () => {
  const capability = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
  const session = createEditSession({
    sessionId: 'session-race', capability, author: humanAuthor,
    changes: [{ kind: 'field', path: '/objective', value: 'Race-safe objective' }],
  })
  const staleVersion = { ...capability, current: { version: 'revision:8', digest: DIGEST_A } }
  const staleDigest = { ...capability, current: { version: 'revision:7', digest: DIGEST_B } }
  assert.equal(errorCode(() => projectEditSubmission(session, staleVersion, livePolicy)), 'stale_resource')
  assert.equal(errorCode(() => projectEditSubmission(session, staleDigest, livePolicy)), 'stale_resource')
  assert.equal(errorCode(() => projectEditSubmission(session, capability, { ...livePolicy, revision: 'policy:13' })), 'policy_changed')
  assert.equal(errorCode(() => projectEditSubmission(session, capability, { ...livePolicy, active: false })), 'policy_changed')
  assert.equal(errorCode(() => projectEditSubmission(session, capability, { ...livePolicy, permittedCapabilityIds: [] })), 'policy_denied')
})

test('consequential effects can only project to immutable proposal approval execution intent', () => {
  const capability = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
  const session = createEditSession({
    sessionId: 'session-publish', capability, author: humanAuthor,
    changes: [{ kind: 'field', path: '/publish', value: true }],
  })
  const projection = projectEditSubmission(session, capability, livePolicy)
  assert.deepEqual(projection, {
    kind: 'operation_proposal',
    command: projection.command,
    effectClass: 'consequential',
    proposalReason: 'consequential_effect',
    lifecycle: ['proposal', 'approval', 'execution'],
    executionAvailable: false,
    transportAvailable: false,
  })
  assert.equal(errorCode(assertAuthoritativeTransportAvailable), 'transport_unavailable')
})

test('immutable truth records reject direct edit and expose correction workflows only', () => {
  const capability = adaptEditCapabilitySnapshot(immutableEvidenceSnapshot)
  assert.equal(capability.available, false)
  assert.equal(capability.availability.code, 'immutable_resource')
  assert.deepEqual(capability.fields, [])
  assert.deepEqual(capability.immutableAlternatives.map((item) => item.kind), ['annotation', 'correction', 'supersession'])
  assert.ok(capability.immutableAlternatives.every((item) => !item.available && item.availability.code === 'unconfirmed_capability'))
  assert.equal(errorCode(() => createEditSession({ sessionId: 'immutable', capability, author: humanAuthor })), 'immutable_resource')
})

test('capability-level denial strips field schemas and policy metadata before presentation', () => {
  const secret = 'CAPABILITY-DENIED-SECRET'
  const denied = adaptEditCapabilitySnapshot({
    ...planCapabilitySnapshot,
    available: false,
    availability: 'policy_denied',
    policy_revision: secret,
    required_roles: [`role-${secret}`],
    required_capabilities: [`capability-${secret}`],
    fields: [{
      path: `/private/${secret}`,
      label: secret,
      value_type: 'string',
      validation: { pattern: secret },
      required_roles: [secret],
      required_capabilities: [secret],
      effect_class: 'draft',
      availability: 'available',
      sensitivity: 'normal',
    }],
  })
  assert.equal(denied.available, false)
  assert.equal(denied.availability.code, 'policy_denied')
  assert.deepEqual(denied.fields, [])
  assert.deepEqual(denied.requiredRoles, [])
  assert.deepEqual(denied.requiredCapabilities, [])
  assert.equal(denied.policyRevision, 'unavailable')
  assert.equal(JSON.stringify(denied).includes(secret), false)
})

test('denied and secret fields never enter validation, diffs, recovery, conflicts, or errors', () => {
  const mislabeledSecret = 'MISLABELED-CREDENTIAL-VALUE'
  const capability = adaptEditCapabilitySnapshot({
    ...planCapabilitySnapshot,
    fields: [...planCapabilitySnapshot.fields, {
      ...planCapabilitySnapshot.fields[0],
      path: '/credentials/api_key',
      label: `API key ${mislabeledSecret}`,
      sensitivity: 'normal',
    }],
  })
  const secret = 'DO-NOT-LEAK-TOKEN'
  const session = createEditSession({
    sessionId: 'session-secret', capability, author: humanAuthor,
    recovery: { mode: 'device_encrypted', authoritative: false, ttlMs: 60_000 },
    changes: [{ kind: 'field', path: '/connector/token', value: secret }],
  })
  const stale = markEditSessionStale(session, { version: 'revision:8', digest: DIGEST_B }, true)
  const rebased = rebaseEditSession(stale, capability, { version: 'revision:8', digest: DIGEST_B }, ['/connector/token'])
  for (const projection of [session, stale, rebased]) {
    const serialized = JSON.stringify(projection)
    assert.equal(serialized.includes(secret), false)
    assert.equal(serialized.includes('/connector/token'), false)
    assert.equal(serialized.includes('SECRET'), false)
    assert.equal(serialized.includes(mislabeledSecret), false)
  }
  assert.deepEqual(session.changes, [])
  assert.deepEqual(session.diff, [])
  assert.deepEqual(session.validation, [{ code: 'unavailable', message: 'A change targets an unavailable field.' }])
})

test('draft sessions support deterministic diff, validation, undo, and safe rebasing', () => {
  const capability = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
  const first = createEditSession({
    sessionId: 'session-draft', capability, author: humanAuthor,
    changes: [{ kind: 'field', path: '/objective', value: 'Initial objective' }],
  })
  const invalid = replaceEditChanges(first, capability, [{ kind: 'field', path: '/objective', value: 'x' }])
  assert.equal(invalid.state, 'draft')
  assert.equal(invalid.validation[0]?.code, 'length')
  assert.deepEqual(invalid.diff, [{ path: '/objective', operation: 'replace', value: 'x' }])
  const undone = undoEditChanges(invalid, capability)
  assert.deepEqual(undone.changes, first.changes)
  const stale = markEditSessionStale(undone, { version: 'revision:8', digest: DIGEST_B }, true)
  assert.deepEqual(stale.conflict, { status: 'stale', latest: { version: 'revision:8', digest: DIGEST_B }, canCompare: true, canRebase: true })
  assert.deepEqual(rebaseEditSession(stale, capability, { version: 'revision:8', digest: DIGEST_B }).conflict, { status: 'current' })
})

test('submission rejects non-ready and unresolved conflict states while clean rebase revalidates', () => {
  const original = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
  const session = createEditSession({
    sessionId: 'session-state', capability: original, author: humanAuthor,
    changes: [{ kind: 'field', path: '/objective', value: 'Conflict-safe objective' }],
  })
  const latest = { version: 'revision:8', digest: DIGEST_B }
  const capability = { ...original, current: latest }
  const stale = markEditSessionStale(session, latest, true)
  assert.equal(errorCode(() => projectEditSubmission(stale, capability, livePolicy)), 'validation_failed')
  const conflicted = rebaseEditSession(stale, capability, latest, ['/objective'])
  assert.equal(conflicted.state, 'draft')
  assert.equal(errorCode(() => projectEditSubmission(conflicted, capability, livePolicy)), 'validation_failed')
  assert.equal(errorCode(() => projectEditSubmission({ ...session, state: 'submitted' }, original, livePolicy)), 'validation_failed')
  assert.equal(errorCode(() => projectEditSubmission({ ...session, conflict: { status: 'rebasing', latest } }, original, livePolicy)), 'validation_failed')
  const clean = rebaseEditSession(stale, capability, latest)
  assert.equal(clean.state, 'ready')
  assert.deepEqual(clean.conflict, { status: 'current' })
  assert.equal(projectEditSubmission(clean, capability, livePolicy).kind, 'direct_commit')
})

test('reversibility requiring a proposal cannot direct commit a low-risk draft', () => {
  const original = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
  const capability = { ...original, reversibility: { ...original.reversibility, requiresProposal: true } }
  const session = createEditSession({
    sessionId: 'session-reversibility', capability, author: humanAuthor,
    changes: [{ kind: 'field', path: '/objective', value: 'Proposal-bound objective' }],
  })
  const projection = projectEditSubmission(session, capability, livePolicy)
  assert.equal(projection.kind, 'operation_proposal')
  if (projection.kind === 'operation_proposal') {
    assert.equal(projection.effectClass, 'draft')
    assert.equal(projection.proposalReason, 'reversibility_required')
  }
})

test('incoherent field schemas fail closed', () => {
  const field = planCapabilitySnapshot.fields[0]
  assert.equal(errorCode(() => adaptEditCapabilitySnapshot({
    ...planCapabilitySnapshot,
    fields: [{ ...field, value_type: 'enum', validation: {} }],
  })), 'invalid_snapshot')
  assert.equal(errorCode(() => adaptEditCapabilitySnapshot({
    ...planCapabilitySnapshot,
    fields: [{ ...field, validation: { minLength: 10, maxLength: 2 } }],
  })), 'invalid_snapshot')
})
