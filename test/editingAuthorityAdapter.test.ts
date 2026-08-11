import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  AuthorityAdapterFailure,
  AuthoritativeEditValidationError,
  adaptPresentationCommandToAuthority,
  createEditSession,
  mapAuthoritativeCapabilityToPresentation,
  projectEditSubmission,
  validateAuthoritativeClientFixture,
  validateAuthoritativeEditDocument,
  type AdaptPresentationCommandInput,
  type AuthoritativeAuthor,
  type AuthoritativeCapabilityAuthority,
  type AuthoritativeClientFixture,
  type AuthoritativeEditSession,
  type AuthoritativeLiveAuthority,
  type AuthoritativeOpeningBinding,
  type EditAuthor,
  type EditSession,
  type EditSubmissionProjection,
  type MapAuthoritativeCapabilityInput,
} from '../src/features/editing/index.ts'

const SNAPSHOT_ROOT = new URL('../src/features/editing/authority/opensaddle.edit-command.v1/', import.meta.url)
const POLICY = Object.freeze({
  id: 'policy.edit',
  version: 'v12',
  hash: 'd'.repeat(64),
  revision: 'policy:12',
  outcome: 'proposal_required' as const,
})
const NOW = '2026-08-11T00:00:00+00:00'

async function fixture(): Promise<AuthoritativeClientFixture> {
  return validateAuthoritativeClientFixture(JSON.parse(await readFile(new URL('fixtures/client.json', SNAPSHOT_ROOT), 'utf8')))
}

function authoritativeAuthor(kind: 'human' | 'agent'): AuthoritativeAuthor {
  return kind === 'human'
    ? { subject: 'user-1', kind, delegation_id: null, delegator: null }
    : { subject: 'agent-1', kind, delegation_id: 'delegation-1', delegator: 'user-1' }
}

function presentationAuthor(kind: 'human' | 'agent'): EditAuthor {
  return kind === 'human'
    ? { kind, principalId: 'user-1', roles: [], capabilities: [] }
    : {
        kind,
        principalId: 'agent-1',
        delegatedBy: 'user-1',
        delegationId: 'delegation-1',
        delegatedCapabilityIds: ['resource.edit'],
        roles: [],
        capabilities: [],
      }
}

async function capabilityMappingInput(): Promise<MapAuthoritativeCapabilityInput> {
  const source = await fixture()
  const resourceRef = source.operation_proposal_request.targets[0].resource_ref
  const opening: AuthoritativeOpeningBinding = {
    projectId: 'project-184',
    policy: POLICY,
    availabilityVersion: 7,
  }
  const live: AuthoritativeCapabilityAuthority = {
    projectId: opening.projectId,
    permissions: ['edit:investigation.plan-draft'],
    policy: POLICY,
    availabilityVersion: opening.availabilityVersion,
    available: true,
    capabilityId: source.capability.capability_id,
    capabilityVersion: source.capability.capability_version,
    capabilityDigest: source.capability.capability_digest,
    currentResourceRef: resourceRef,
    registeredAction: source.capability.consequential_action,
  }
  return { capability: source.capability, resourceRef, opening, live }
}

async function setup(kind: 'human' | 'agent' = 'human'): Promise<AdaptPresentationCommandInput> {
  const source = await fixture()
  const ref = source.operation_proposal_request.targets[0].resource_ref
  const mapping = await capabilityMappingInput()
  const capability = await mapAuthoritativeCapabilityToPresentation(mapping)
  const changes = source.patch.operations.map((operation) => operation.operation === 'remove'
    ? { kind: 'json_patch' as const, op: 'remove' as const, path: `/${operation.field}` }
    : { kind: 'field' as const, path: `/${operation.field}`, value: operation.value as string | readonly string[] })
  const session = createEditSession({
    sessionId: `edit_${'1'.repeat(32)}`,
    capability,
    author: presentationAuthor(kind),
    changes,
  })
  const livePolicy = {
    revision: POLICY.revision,
    active: true,
    principalRoles: [],
    principalCapabilities: [],
    permittedCapabilityIds: ['resource.edit'],
    allowLowRiskDraftDirectCommit: false,
  }
  const submission = projectEditSubmission(session, capability, livePolicy)
  const authSession: AuthoritativeEditSession = {
    schema_version: 'opensaddle.edit-session.v1',
    session_id: session.sessionId,
    project_id: 'project-184',
    capability_id: source.capability.capability_id,
    capability_version: source.capability.capability_version,
    capability_digest: source.capability.capability_digest,
    resource_ref: ref,
    author: authoritativeAuthor(kind),
    version: 1,
    draft_digest: 'c'.repeat(64),
    resource_state: 'draft',
    last_autosaved_at: NOW,
    recovery_token_digest: 'e'.repeat(64),
    history_length: 1,
  }
  const live: AuthoritativeLiveAuthority = {
    ...mapping.live,
    subject: authSession.author.subject,
    currentSessionVersion: authSession.version,
    currentDraftDigest: authSession.draft_digest,
    activeDelegation: kind === 'human' ? null : {
      delegationId: 'delegation-1',
      delegate: 'agent-1',
      delegator: 'user-1',
      projectId: authSession.project_id,
      capabilityId: source.capability.capability_id,
      capabilityVersion: source.capability.capability_version,
      capabilityDigest: source.capability.capability_digest,
      policyId: POLICY.id,
      policyVersion: POLICY.version,
      policyHash: POLICY.hash,
      policyOutcome: POLICY.outcome,
      validUntil: '2026-08-12T00:00:00+00:00',
    },
    revokedDelegationIds: [],
    now: NOW,
  }
  return {
    submission,
    presentationSession: session,
    authoritativeSession: authSession,
    capability: source.capability,
    opening: mapping.opening,
    live,
    idempotencyKey: 'edit-command-184',
    proposal: { correlationIds: ['investigation:184'] },
  }
}

async function failureCode(action: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await action()
  } catch (error) {
    assert.ok(error instanceof AuthorityAdapterFailure || error instanceof AuthoritativeEditValidationError)
    assert.equal(error.message.includes('secret'), false)
    return error.code
  }
  return undefined
}

test('snapshots retain their exact accepted OpenSaddle SHA-256 provenance', async () => {
  const expected = {
    'schema.json': '13442f5b5a6e0d3d7bc76025091d1dc2007cf28336a2eca0c88cfd0889d2dc38',
    'fixtures/client.json': '837757617b03f3d6eba2428b4dc63f63fce8a651fb3bc09b71d64158f1f278fd',
    'README.md': 'c75a122c00e1f7b41fb606efe27e567cf205be89db537e70f2bddc5eff721574',
  }
  for (const [path, digest] of Object.entries(expected)) {
    assert.equal(createHash('sha256').update(await readFile(new URL(path, SNAPSHOT_ROOT))).digest('hex'), digest)
  }
})

test('authoritative fixture documents strictly validate and its supported patch round-trips losslessly', async () => {
  const source = await fixture()
  assert.equal(source.capability.schema_version, 'opensaddle.edit-capability.v1')
  assert.equal(source.patch.schema_version, 'opensaddle.typed-patch.v1')
  assert.equal(source.operation_proposal_request.registered_action_id, 'act_EditPublish1')
  const adapted = await adaptPresentationCommandToAuthority(await setup())
  assert.deepEqual(adapted.envelope.patch, source.patch)
  assert.equal(adapted.envelope.expected_resource_ref.version, source.operation_proposal_request.targets[0].expected_version)
  assert.equal(adapted.transport_available, false)
  assert.equal(adapted.approval_available, false)
  assert.equal(adapted.execution_available, false)
})

test('capability mapping requires exact project, live permission, availability, policy, capability, action, and resource authority', async () => {
  const valid = await capabilityMappingInput()
  const mapped = await mapAuthoritativeCapabilityToPresentation(valid)
  assert.equal(mapped.available, true)
  assert.deepEqual(mapped.fields.map((field) => field.path), ['/title', '/objective', '/steps', '/assumptions'])

  const denied = await capabilityMappingInput()
  denied.opening = {
    ...denied.opening,
    policy: { ...denied.opening.policy, outcome: 'deny' },
  }
  denied.live = {
    ...denied.live,
    policy: { ...denied.live.policy, outcome: 'deny' },
  }
  assert.equal(await failureCode(() => mapAuthoritativeCapabilityToPresentation(denied)), 'policy_denied')

  const unavailable = await capabilityMappingInput()
  unavailable.live = { ...unavailable.live, available: false }
  assert.equal(await failureCode(() => mapAuthoritativeCapabilityToPresentation(unavailable)), 'policy_denied')

  const crossProject = await capabilityMappingInput()
  crossProject.live = { ...crossProject.live, projectId: 'project-other' }
  assert.equal(await failureCode(() => mapAuthoritativeCapabilityToPresentation(crossProject)), 'policy_changed')

  const staleResource = await capabilityMappingInput()
  staleResource.live = {
    ...staleResource.live,
    currentResourceRef: { ...staleResource.live.currentResourceRef, version: 'git:bbbbbbbb' },
  }
  assert.equal(await failureCode(() => mapAuthoritativeCapabilityToPresentation(staleResource)), 'stale_resource')

  const permission = await capabilityMappingInput()
  permission.live = { ...permission.live, permissions: [] }
  assert.equal(await failureCode(() => mapAuthoritativeCapabilityToPresentation(permission)), 'policy_denied')

  const capability = await capabilityMappingInput()
  capability.live = { ...capability.live, capabilityVersion: 2 }
  assert.equal(await failureCode(() => mapAuthoritativeCapabilityToPresentation(capability)), 'capability_changed')

  const action = await capabilityMappingInput()
  action.live = {
    ...action.live,
    registeredAction: { ...action.live.registeredAction, registered_action_version: 2 },
  }
  assert.equal(await failureCode(() => mapAuthoritativeCapabilityToPresentation(action)), 'action_changed')
})

test('human and harness-agent callers share command semantics with exact delegation differences', async () => {
  const human = await adaptPresentationCommandToAuthority(await setup('human'))
  const agent = await adaptPresentationCommandToAuthority(await setup('agent'))
  assert.deepEqual(agent.envelope, human.envelope)
  assert.equal(agent.request_digest, human.request_digest)
  assert.deepEqual(human.operation_proposal_request?.delegation_chain, [])
  assert.deepEqual(agent.operation_proposal_request?.delegation_chain, ['user-1', 'agent-1'])
  assert.equal(agent.authority_binding.author.delegation_id, 'delegation-1')
})

test('human and agent command adaptation bind opening and live authority to the authoritative session project', async () => {
  for (const kind of ['human', 'agent'] as const) {
    const crossProject = await setup(kind)
    crossProject.opening = { ...crossProject.opening, projectId: 'project-other' }
    crossProject.live = {
      ...crossProject.live,
      projectId: 'project-other',
      ...(kind === 'agent'
        ? { activeDelegation: { ...crossProject.live.activeDelegation!, projectId: 'project-other' } }
        : {}),
    }
    assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(crossProject)), 'identity_conflict')
  }
})

test('authoritative request digest ignores presentation FNV identity but binds every command field', async () => {
  const first = await setup()
  const alternateCommand = {
    ...first.submission.command,
    commandId: 'presentation-only-different',
    changeSetFingerprint: {
      algorithm: 'presentation-fnv1a64/v1' as const,
      value: '0000000000000000',
      authoritative: false as const,
    },
  }
  const alternate = {
    ...first,
    submission: { ...first.submission, command: alternateCommand } as EditSubmissionProjection,
  }
  const one = await adaptPresentationCommandToAuthority(first)
  const two = await adaptPresentationCommandToAuthority(alternate)
  assert.equal(one.request_digest, two.request_digest)
  const changed = await setup()
  changed.authoritativeSession = { ...changed.authoritativeSession, version: 2 }
  changed.live = { ...changed.live, currentSessionVersion: 2 }
  assert.notEqual((await adaptPresentationCommandToAuthority(changed)).request_digest, one.request_digest)
})

test('stale version/digest, policy changes, availability revocation, and action mismatch fail closed', async () => {
  const staleSession = await setup()
  staleSession.live = { ...staleSession.live, currentSessionVersion: 2 }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(staleSession)), 'stale_session')

  const staleDraft = await setup()
  staleDraft.live = { ...staleDraft.live, currentDraftDigest: 'f'.repeat(64) }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(staleDraft)), 'stale_session')

  const staleVersion = await setup()
  staleVersion.live = {
    ...staleVersion.live,
    currentResourceRef: { ...staleVersion.live.currentResourceRef, version: 'git:bbbbbbbb' },
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(staleVersion)), 'stale_resource')

  const staleDigest = await setup()
  staleDigest.live = {
    ...staleDigest.live,
    currentResourceRef: {
      ...staleDigest.live.currentResourceRef,
      digest: { algorithm: 'sha-256', value: 'b'.repeat(64) },
    },
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(staleDigest)), 'stale_resource')

  const policy = await setup()
  policy.live = { ...policy.live, policy: { ...policy.live.policy, version: 'v13' } }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(policy)), 'policy_changed')

  const unavailable = await setup()
  unavailable.live = { ...unavailable.live, available: false }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(unavailable)), 'policy_denied')

  const availability = await setup()
  availability.live = { ...availability.live, availabilityVersion: 8 }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(availability)), 'policy_changed')

  const action = await setup()
  action.live = {
    ...action.live,
    registeredAction: { ...action.live.registeredAction, registered_action_version: 2 },
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(action)), 'action_changed')

  const actionDigest = await setup()
  actionDigest.live = {
    ...actionDigest.live,
    registeredAction: { ...actionDigest.live.registeredAction, registered_action_digest: 'f'.repeat(64) },
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(actionDigest)), 'action_changed')

  const capabilityDigest = await setup()
  capabilityDigest.live = { ...capabilityDigest.live, capabilityDigest: 'f'.repeat(64) }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(capabilityDigest)), 'capability_changed')
})

test('agent delegation must be exact, unrevoked, unexpired, and live-policy bound', async () => {
  const revoked = await setup('agent')
  revoked.live = { ...revoked.live, revokedDelegationIds: ['delegation-1'] }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(revoked)), 'delegation_denied')

  const expired = await setup('agent')
  expired.live = {
    ...expired.live,
    activeDelegation: { ...expired.live.activeDelegation!, validUntil: NOW },
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(expired)), 'delegation_denied')

  const rebound = await setup('agent')
  rebound.live = {
    ...rebound.live,
    activeDelegation: { ...rebound.live.activeDelegation!, policyHash: 'f'.repeat(64) },
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(rebound)), 'delegation_denied')
})

test('ambiguous resource, unsafe pointer, unsupported patch, digest encoding, and secret fields are rejected opaquely', async () => {
  const resource = await setup()
  resource.presentationSession = {
    ...resource.presentationSession,
    resource: { ...resource.presentationSession.resource, kind: 'workflow_definition' },
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(resource)), 'ambiguous_mapping')

  for (const path of ['/objective/child', '/objective~1child', '//objective', '/__proto__']) {
    const unsafe = await setup()
    const command = { ...unsafe.submission.command, changes: [{ kind: 'field' as const, path, value: 'secret-value' }] }
    unsafe.submission = { ...unsafe.submission, command } as EditSubmissionProjection
    unsafe.presentationSession = { ...unsafe.presentationSession, changes: command.changes }
    assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(unsafe)), 'invalid_pointer')
  }

  const unsupported = await setup()
  const unsupportedCommand = {
    ...unsupported.submission.command,
    changes: [{ kind: 'json_patch', op: 'move', path: '/objective', value: 'secret-value' }],
  }
  unsupported.submission = { ...unsupported.submission, command: unsupportedCommand } as unknown as EditSubmissionProjection
  unsupported.presentationSession = { ...unsupported.presentationSession, changes: unsupportedCommand.changes as never }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(unsupported)), 'invalid_patch')

  for (const op of ['add', 'replace'] as const) {
    const lossy = await setup()
    const lossyCommand = {
      ...lossy.submission.command,
      changes: [{ kind: 'json_patch' as const, op, path: '/objective', value: 'secret-value' }],
    }
    lossy.submission = { ...lossy.submission, command: lossyCommand } as EditSubmissionProjection
    lossy.presentationSession = { ...lossy.presentationSession, changes: lossyCommand.changes }
    assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(lossy)), 'invalid_patch')
  }

  const secret = await setup()
  const secretCommand = {
    ...secret.submission.command,
    changes: [{ kind: 'field' as const, path: '/secret_token', value: 'secret-value' }],
  }
  secret.submission = { ...secret.submission, command: secretCommand } as EditSubmissionProjection
  secret.presentationSession = { ...secret.presentationSession, changes: secretCommand.changes }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(secret)), 'invalid_patch')

  const digestEncoding = await setup()
  digestEncoding.submission = {
    ...digestEncoding.submission,
    command: {
      ...digestEncoding.submission.command,
      expected: { ...digestEncoding.submission.command.expected, digest: 'a'.repeat(64) },
    },
  } as EditSubmissionProjection
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(digestEncoding)), 'stale_resource')

  const idempotency = await setup()
  idempotency.idempotencyKey = 'not safe'
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(idempotency)), 'invalid_patch')
})

test('consequential and reversibility-required edits cannot bypass immutable proposal flow', async () => {
  const input = await setup()
  input.submission = {
    kind: 'direct_commit',
    command: input.submission.command,
    transportAvailable: false,
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(input)), 'proposal_required')

  const valid = await adaptPresentationCommandToAuthority(await setup())
  assert.ok(valid.operation_proposal_request)
  assert.deepEqual(valid.operation_proposal_request?.validation_results.map((item) => item.code), [
    'edit.schema_validated',
    'edit.draft_has_changes',
    'edit.proposal_required',
    'edit.effect.external_write',
  ])
})

test('unknown versions and additional wire fields fail closed', async () => {
  assert.equal(await failureCode(async () => validateAuthoritativeEditDocument({
    schema_version: 'opensaddle.typed-patch.v2',
    operations: [{ operation: 'set', field: 'title', value: 'x' }],
  })), 'unsupported_schema')
  const source = await fixture()
  assert.equal(await failureCode(async () => validateAuthoritativeEditDocument({
    ...source.patch,
    transport: '/api/edit',
  })), 'invalid_document')
})
