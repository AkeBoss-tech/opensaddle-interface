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
  assert.equal(errorCode(() => createEditSession({ sessionId: 'immutable', capability, author: humanAuthor })), 'immutable_resource')
})

test('denied and secret fields never enter validation, diffs, recovery, conflicts, or errors', () => {
  const capability = adaptEditCapabilitySnapshot(planCapabilitySnapshot)
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
