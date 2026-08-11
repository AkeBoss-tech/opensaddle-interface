import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  AuthorityAdapterFailure,
  AuthoritativeEditValidationError,
  adaptPostPatchResultToProposal,
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
  type AuthoritativeEditResult,
  type AuthoritativeLiveAuthority,
  type AuthoritativeProposalInput,
  type AuthoritativeProposalContinuation,
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
  }
}

function postPatchResult(input: AdaptPresentationCommandInput, afterDigest = 'f'.repeat(64)): AuthoritativeEditResult {
  const pre = input.authoritativeSession
  return {
    schema_version: 'opensaddle.edit-result.v1',
    session: {
      ...pre,
      version: pre.version + 1,
      draft_digest: afterDigest,
      last_autosaved_at: '2026-08-11T00:01:00+00:00',
      recovery_token_digest: 'a'.repeat(64),
      history_length: pre.history_length + 1,
    },
    diff: {
      changed_fields: input.submission.command.changes.map((change) => change.path.slice(1)).sort(),
      before_digest: pre.draft_digest,
      after_digest: afterDigest,
      validation: [],
    },
    applied: true,
    rebased: false,
    omissions_present: false,
    proposal_required: true,
    published: false,
  }
}

function postPatchLive(input: AdaptPresentationCommandInput, result: AuthoritativeEditResult): AuthoritativeLiveAuthority {
  return {
    ...input.live,
    currentSessionVersion: result.session.version,
    currentDraftDigest: result.session.draft_digest,
  }
}

async function completeProposal(
  input: AdaptPresentationCommandInput,
): Promise<{ proposal: AuthoritativeProposalInput; result: AuthoritativeEditResult }> {
  const command = await adaptPresentationCommandToAuthority(input)
  assert.ok(command.proposal_continuation)
  const result = postPatchResult(input)
  const proposal = await adaptPostPatchResultToProposal({
    continuation: command.proposal_continuation,
    authoritativeResult: result,
    live: postPatchLive(input, result),
    proposal: { correlationIds: ['investigation:184'] },
  })
  return { proposal, result }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const source = value as Record<string, unknown>
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function resignContinuation(value: AuthoritativeProposalContinuation): AuthoritativeProposalContinuation {
  const cloned = structuredClone(value) as unknown as Record<string, unknown>
  delete cloned.integrity
  return {
    ...cloned,
    integrity: {
      algorithm: 'sha-256/canonical-json',
      value: digestJson(cloned),
      authoritative: false,
    },
  } as unknown as AuthoritativeProposalContinuation
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
  assert.ok(adapted.proposal_continuation)
  assert.equal('operation_proposal_request' in adapted, false)
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
  const humanInput = await setup('human')
  const agentInput = await setup('agent')
  const human = await adaptPresentationCommandToAuthority(humanInput)
  const agent = await adaptPresentationCommandToAuthority(agentInput)
  assert.deepEqual(agent.envelope, human.envelope)
  assert.equal(agent.request_digest, human.request_digest)
  assert.deepEqual((await completeProposal(humanInput)).proposal.delegation_chain, [])
  assert.deepEqual((await completeProposal(agentInput)).proposal.delegation_chain, ['user-1', 'agent-1'])
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

  const nullBypass = await setup('agent')
  const nullAuthor = {
    ...nullBypass.submission.command.author,
    delegatedBy: null,
    delegationId: null,
  }
  nullBypass.submission = {
    ...nullBypass.submission,
    command: { ...nullBypass.submission.command, author: nullAuthor },
  } as unknown as EditSubmissionProjection
  nullBypass.presentationSession = {
    ...nullBypass.presentationSession,
    author: nullAuthor,
  } as unknown as EditSession
  nullBypass.authoritativeSession = {
    ...nullBypass.authoritativeSession,
    author: { ...nullBypass.authoritativeSession.author, delegation_id: null, delegator: null },
  }
  nullBypass.live = {
    ...nullBypass.live,
    activeDelegation: {
      ...nullBypass.live.activeDelegation!,
      delegationId: null,
      delegator: null,
    } as unknown as NonNullable<AuthoritativeLiveAuthority['activeDelegation']>,
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(nullBypass)), 'delegation_denied')
})

test('timestamps require explicit RFC3339 timezone and runtime policy outcomes are exact enums', async () => {
  const autosave = await setup()
  autosave.authoritativeSession = {
    ...autosave.authoritativeSession,
    last_autosaved_at: '2026-08-11T00:00:00',
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(autosave)), 'invalid_document')

  const delegationTime = await setup('agent')
  delegationTime.live = {
    ...delegationTime.live,
    activeDelegation: { ...delegationTime.live.activeDelegation!, validUntil: '2026-08-12T00:00:00' },
  }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(delegationTime)), 'delegation_denied')

  const liveTime = await setup('agent')
  liveTime.live = { ...liveTime.live, now: '2026-08-11T00:00:00' }
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(liveTime)), 'delegation_denied')

  const offset = await setup('agent')
  offset.live = {
    ...offset.live,
    now: '2026-08-11T05:30:00+05:30',
    activeDelegation: { ...offset.live.activeDelegation!, validUntil: '2026-08-12T05:30:00+05:30' },
  }
  assert.ok((await adaptPresentationCommandToAuthority(offset)).proposal_continuation)

  const policy = await setup()
  const invalidOutcome = 'allow_everything'
  policy.opening = {
    ...policy.opening,
    policy: { ...policy.opening.policy, outcome: invalidOutcome },
  } as unknown as AdaptPresentationCommandInput['opening']
  policy.live = {
    ...policy.live,
    policy: { ...policy.live.policy, outcome: invalidOutcome },
  } as unknown as AuthoritativeLiveAuthority
  assert.equal(await failureCode(() => adaptPresentationCommandToAuthority(policy)), 'policy_changed')

  const mapping = await capabilityMappingInput()
  mapping.opening = {
    ...mapping.opening,
    policy: { ...mapping.opening.policy, outcome: invalidOutcome },
  } as unknown as AuthoritativeOpeningBinding
  mapping.live = {
    ...mapping.live,
    policy: { ...mapping.live.policy, outcome: invalidOutcome },
  } as unknown as AuthoritativeCapabilityAuthority
  assert.equal(await failureCode(() => mapAuthoritativeCapabilityToPresentation(mapping)), 'policy_changed')
})

test('proposal input is a result-bound N+1 continuation and never an atomic pre-patch body', async () => {
  const input = await setup('agent')
  const command = await adaptPresentationCommandToAuthority(input)
  assert.ok(command.proposal_continuation)
  assert.equal('operation_proposal_request' in command, false)

  const post = postPatchResult(input)
  const preVersion = {
    ...post,
    session: {
      ...post.session,
      version: input.authoritativeSession.version,
      history_length: input.authoritativeSession.history_length,
    },
  }
  assert.equal(await failureCode(() => adaptPostPatchResultToProposal({
    continuation: command.proposal_continuation!,
    authoritativeResult: preVersion,
    live: input.live,
    proposal: { correlationIds: ['investigation:184'] },
  })), 'stale_session')

  const wrongDigest = {
    ...post,
    session: { ...post.session, draft_digest: 'b'.repeat(64) },
  }
  assert.equal(await failureCode(() => adaptPostPatchResultToProposal({
    continuation: command.proposal_continuation!,
    authoritativeResult: wrongDigest,
    live: postPatchLive(input, wrongDigest),
    proposal: { correlationIds: ['investigation:184'] },
  })), 'invalid_patch')

  const recovered = JSON.parse(JSON.stringify(command.proposal_continuation)) as AuthoritativeProposalContinuation
  const proposal = await adaptPostPatchResultToProposal({
    continuation: recovered,
    authoritativeResult: post,
    live: postPatchLive(input, post),
    proposal: { correlationIds: ['investigation:184'] },
  })
  const expectedPostDigest = digestJson({
    resource_ref: post.session.resource_ref,
    draft_digest: post.session.draft_digest,
    session_version: post.session.version,
    capability_digest: input.capability.capability_digest,
    consequential_action: input.capability.consequential_action,
  })
  const forbiddenPreDigest = digestJson({
    resource_ref: input.authoritativeSession.resource_ref,
    draft_digest: input.authoritativeSession.draft_digest,
    session_version: input.authoritativeSession.version,
    capability_digest: input.capability.capability_digest,
    consequential_action: input.capability.consequential_action,
  })
  assert.equal(proposal.protected_input_digest, expectedPostDigest)
  assert.notEqual(proposal.protected_input_digest, forbiddenPreDigest)
  assert.deepEqual(proposal.delegation_chain, ['user-1', 'agent-1'])
})

test('proposal continuation survives JSON recovery and fails closed for every authority binding tamper', async () => {
  const input = await setup('agent')
  const command = await adaptPresentationCommandToAuthority(input)
  assert.ok(command.proposal_continuation)
  assert.equal(command.proposal_continuation.authority, 'non-authoritative')
  assert.equal(command.proposal_continuation.integrity.authoritative, false)
  const result = postPatchResult(input)
  const live = postPatchLive(input, result)

  const recovered = JSON.parse(JSON.stringify(command.proposal_continuation)) as AuthoritativeProposalContinuation
  assert.ok(await adaptPostPatchResultToProposal({
    continuation: recovered,
    authoritativeResult: result,
    live,
    proposal: { correlationIds: ['investigation:184'] },
  }))

  const mutations: Array<[string, (continuation: any) => void]> = [
    ['request digest', (c) => { c.request_digest = '1'.repeat(64) }],
    ['envelope session', (c) => { c.envelope.session_id = `edit_${'2'.repeat(32)}` }],
    ['envelope version', (c) => { c.envelope.expected_version += 1 }],
    ['envelope resource', (c) => { c.envelope.expected_resource_ref.resource_id = 'plan-other' }],
    ['envelope patch', (c) => { c.envelope.patch.operations[0].field = 'title' }],
    ['pre-patch session', (c) => { c.pre_patch.session_id = `edit_${'2'.repeat(32)}` }],
    ['pre-patch project', (c) => { c.pre_patch.project_id = 'project-other' }],
    ['pre-patch capability id', (c) => { c.pre_patch.capability_id = 'resource.other' }],
    ['pre-patch capability version', (c) => { c.pre_patch.capability_version += 1 }],
    ['pre-patch capability digest', (c) => { c.pre_patch.capability_digest = '1'.repeat(64) }],
    ['pre-patch resource', (c) => { c.pre_patch.resource_ref.resource_id = 'plan-other' }],
    ['pre-patch author', (c) => { c.pre_patch.author.subject = 'agent-other' }],
    ['pre-patch delegation', (c) => { c.pre_patch.author.delegation_id = 'delegation-other' }],
    ['pre-patch delegator', (c) => { c.pre_patch.author.delegator = 'user-other' }],
    ['pre-patch version', (c) => { c.pre_patch.version += 1 }],
    ['pre-patch draft', (c) => { c.pre_patch.draft_digest = '1'.repeat(64) }],
    ['pre-patch resource state', (c) => { c.pre_patch.resource_state = 'published' }],
    ['pre-patch history', (c) => { c.pre_patch.history_length += 1 }],
    ['capability binding id', (c) => { c.capability_binding.capability_id = 'resource.other' }],
    ['capability binding version', (c) => { c.capability_binding.capability_version += 1 }],
    ['capability binding digest', (c) => { c.capability_binding.capability_digest = '1'.repeat(64) }],
    ['action id', (c) => { c.capability_binding.consequential_action.registered_action_id = 'act_Other1' }],
    ['action version', (c) => { c.capability_binding.consequential_action.registered_action_version += 1 }],
    ['action digest', (c) => { c.capability_binding.consequential_action.registered_action_digest = '1'.repeat(64) }],
    ['action effect', (c) => { c.capability_binding.consequential_action.effect_class = 'destructive' }],
    ['opening project', (c) => { c.opening_binding.projectId = 'project-other' }],
    ['opening policy id', (c) => { c.opening_binding.policy.id = 'policy.other' }],
    ['opening policy version', (c) => { c.opening_binding.policy.version = 'v13' }],
    ['opening policy hash', (c) => { c.opening_binding.policy.hash = '1'.repeat(64) }],
    ['opening policy revision', (c) => { c.opening_binding.policy.revision = 'policy:13' }],
    ['opening policy outcome', (c) => { c.opening_binding.policy.outcome = 'deny' }],
    ['opening availability', (c) => { c.opening_binding.availabilityVersion += 1 }],
    ['changed fields', (c) => { c.changed_fields[0] = 'title' }],
    ['coordinated cross-project binding', (c) => {
      c.opening_binding.projectId = 'project-other'
      c.pre_patch.project_id = 'project-other'
    }],
    ['unknown continuation field', (c) => { c.unexpected = true }],
  ]

  for (const [label, mutate] of mutations) {
    const forged = structuredClone(recovered)
    mutate(forged)
    const resigned = resignContinuation(forged)
    assert.ok(await failureCode(() => adaptPostPatchResultToProposal({
      continuation: resigned,
      authoritativeResult: result,
      live,
      proposal: { correlationIds: ['investigation:184'] },
    })), `${label} must fail closed even with a recomputed public checksum`)
  }

  const corrupted = structuredClone(recovered)
  corrupted.opening_binding.projectId = 'project-other'
  assert.equal(await failureCode(() => adaptPostPatchResultToProposal({
    continuation: corrupted,
    authoritativeResult: result,
    live,
    proposal: { correlationIds: ['investigation:184'] },
  })), 'proposal_required')
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

  const validInput = await setup()
  const valid = await adaptPresentationCommandToAuthority(validInput)
  assert.ok(valid.proposal_continuation)
  assert.equal('operation_proposal_request' in valid, false)
  const completed = await completeProposal(validInput)
  assert.deepEqual(completed.proposal.validation_results.map((item) => item.code), [
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
