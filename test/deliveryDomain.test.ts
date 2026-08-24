import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  GovernedDeliveryValidationError,
  adaptGovernedDeliveryProjection,
  bindDeliveryReviewSession,
} from '../src/features/delivery/index.ts'
import type { EditSession, EditSubmissionProjection } from '../src/features/editing/index.ts'
import type { GitComparisonResult } from '../src/services/contracts.ts'

const SNAPSHOT_ROOT = new URL('../src/features/delivery/domain/snapshots/opensaddle.governed-delivery.v1/', import.meta.url)
const BASE = `git:${'a'.repeat(40)}`
const HEAD = `git:${'b'.repeat(40)}`

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL('fixtures/golden.json', SNAPSHOT_ROOT), 'utf8')) as Record<string, unknown>
}

function comparison(base = BASE, head = HEAD): GitComparisonResult {
  return {
    repository: '/fixture/northstar',
    base,
    head,
    mergeBase: base,
    additions: 12,
    deletions: 3,
    files: [{ path: 'src/release_controller.py', additions: 12, deletions: 3, binary: false }],
    patch: '',
    truncated: false,
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const source = value as Record<string, unknown>
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`
}

test('snapshots retain exact reviewed bytes and governed-delivery manifest digests', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', SNAPSHOT_ROOT), 'utf8')) as {
    schema_digest: string
    fixtures: Record<string, string>
  }
  const expected = {
    'schema.json': { raw: '45594d00c515f17fd95dde94276b751d703b0578181200c938268f038695743a', canonical: manifest.schema_digest },
    'fixtures/golden.json': { raw: 'defe5c5c3e9e7f99d5c324aacd83d140b8e828db38d268d05b9f72b19044e8ca', canonical: manifest.fixtures['golden.json'] },
    'fixtures/conformance.json': { raw: 'c33544fda8c24713e99c98c26584edddebdc6b214c6874410f7e083d711ab22d', canonical: manifest.fixtures['conformance.json'] },
  }
  for (const [path, digests] of Object.entries(expected)) {
    const bytes = await readFile(new URL(path, SNAPSHOT_ROOT))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digests.raw)
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown
    assert.equal(`sha256:${createHash('sha256').update(canonicalJson(parsed)).digest('hex')}`, digests.canonical)
  }
})

test('adapts exact change, check, KRAIL evidence, PR, approval, CI, and receipt bindings', async () => {
  const projection = adaptGovernedDeliveryProjection({
    document: await fixture(),
    currentRepositoryRevision: HEAD,
    comparison: comparison(),
  })
  assert.equal(projection.changeSet.status, 'current')
  assert.equal(projection.changeSet.countsStatus, 'observed')
  assert.equal(projection.changeSet.additions, 12)
  assert.equal(projection.changeSet.deletions, 3)
  assert.equal(projection.changeSet.files[0]?.additions, 12)
  assert.equal(projection.changeSet.baseRevision, BASE)
  assert.equal(projection.changeSet.headRevision, HEAD)
  assert.equal(projection.changeSet.commits[0]?.resourceId, 'b'.repeat(40))
  assert.equal(projection.checks[0]?.status, 'passed')
  assert.equal(projection.checks[0]?.observedRevision, HEAD)
  assert.equal(projection.verification.capabilityId, 'krail.verification-evidence')
  assert.equal(projection.verification.freshness, 'current')
  assert.equal(projection.provider.pullRequest.number, 184)
  assert.equal(projection.provider.ci.state, 'passed')
  assert.equal(projection.approval.consumed, true)
  assert.equal(projection.receipt.idempotencyResult, 'committed')
  assert.equal(projection.terminal, 'completed_verified')
  assert.deepEqual(projection.progress.map((item) => item.phase), ['provisioning', 'executing', 'verifying', 'publishing'])
})

test('stale heads and stale line observations cannot appear current or verified', async () => {
  const projection = adaptGovernedDeliveryProjection({
    document: await fixture(),
    currentRepositoryRevision: `git:${'c'.repeat(40)}`,
    comparison: comparison(BASE, `git:${'c'.repeat(40)}`),
  })
  assert.equal(projection.changeSet.status, 'stale_head')
  assert.equal(projection.changeSet.countsStatus, 'stale_observation')
  assert.equal(projection.changeSet.additions, null)
  assert.equal(projection.changeSet.files[0]?.deletions, null)
  assert.equal(projection.verification.freshness, 'stale')
  assert.equal(projection.provider.ci.freshness, 'stale')
  assert.equal(projection.terminal, 'uncertain')
})

test('pending CI remains distinct from verified completion and incomplete verification remains explicit', async () => {
  const document = await fixture()
  const execution = document.execution as Record<string, unknown>
  const evidence = execution.evidence as Record<string, unknown>
  evidence.verification_state = 'partial'
  const publication = document.publication_proposal as Record<string, unknown>
  publication.verification_state = 'partial'
  const receipt = document.effect_receipt as Record<string, unknown>
  receipt.outcome = 'effect_applied_not_verified'
  receipt.verified_completion = false
  const ci = receipt.ci as Record<string, unknown>
  ci.state = 'pending'
  const projection = adaptGovernedDeliveryProjection({ document, currentRepositoryRevision: HEAD })

  assert.equal(projection.provider.ci.state, 'pending')
  assert.equal(projection.terminal, 'completed_incomplete_verification')
  assert.equal(projection.progress.find((item) => item.phase === 'verifying')?.status, 'uncertain')
  assert.notEqual(projection.terminal, 'completed_verified')
})

test('a contradictory failed check cannot inherit a passed aggregate as verified completion', async () => {
  const document = await fixture()
  const execution = document.execution as Record<string, unknown>
  const evidence = execution.evidence as Record<string, unknown>
  const checks = evidence.checks as Array<Record<string, unknown>>
  checks[0] = { ...checks[0], status: 'failed' }
  const projection = adaptGovernedDeliveryProjection({ document, currentRepositoryRevision: HEAD })
  assert.equal(projection.checks[0]?.status, 'failed')
  assert.equal(projection.terminal, 'completed_incomplete_verification')
})

test('unavailable checks and safe omissions survive while restricted fields are absent before presentation', async () => {
  const document = await fixture()
  const execution = document.execution as Record<string, unknown>
  const evidence = execution.evidence as Record<string, unknown>
  const first = (evidence.checks as Array<Record<string, unknown>>)[0]
  evidence.checks = [
    { ...first, check_id: 'ci-partial', status: 'partial', command: { secret_material: 'never-present' } },
    { check_id: 'security-redacted', kind: 'security', status: 'redacted', provider_selector: 'private' },
    { check_id: 'unknown-check', kind: 'other', status: 'future-state', raw_provider_body: 'private' },
  ]
  evidence.verification_state = 'unavailable'
  const verificationReceipt = execution.verification_receipt as Record<string, unknown>
  verificationReceipt.omissions = ['verification-redacted']
  const publication = document.publication_proposal as Record<string, unknown>
  publication.verification_state = 'unavailable'
  const receipt = document.effect_receipt as Record<string, unknown>
  receipt.outcome = 'effect_applied_not_verified'
  receipt.verified_completion = false
  receipt.omissions = ['ci_observation_unavailable']
  ;(receipt.ci as Record<string, unknown>).state = 'unavailable'
  ;(receipt.ci as Record<string, unknown>).checks_ref = null

  const projection = adaptGovernedDeliveryProjection({ document, currentRepositoryRevision: HEAD })
  assert.deepEqual(projection.checks.map((item) => item.status), ['incomplete', 'unavailable', 'uncertain'])
  assert.deepEqual(projection.omissions, ['verification-redacted', 'ci_observation_unavailable'])
  const serialized = JSON.stringify(projection)
  for (const forbidden of ['secret_material', 'raw_provider_body', 'provider_selector', 'credential_lease', 'principal']) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('authority substitution fails closed', async () => {
  const document = await fixture()
  const receipt = document.effect_receipt as Record<string, unknown>
  receipt.head_revision = `git:${'f'.repeat(40)}`
  assert.throws(
    () => adaptGovernedDeliveryProjection({ document, currentRepositoryRevision: HEAD }),
    (error) => error instanceof GovernedDeliveryValidationError && error.code === 'authority_mismatch',
  )
})

function reviewFixture(): { session: EditSession; submission: EditSubmissionProjection } {
  const version = { version: 'revision:7', digest: `sha256:${'a'.repeat(64)}` }
  const session: EditSession = {
    contractVersion: 'opensaddle.interface-editing.presentation/v1',
    sessionId: 'review-1',
    capabilityId: 'resource.edit',
    resource: { kind: 'plan_draft', id: 'plan-1' },
    base: version,
    policyRevision: 'policy:12',
    state: 'ready',
    changes: [{ kind: 'field', path: '/objective', value: 'Review exact change set' }],
    undoStack: [],
    recovery: { mode: 'memory', authoritative: false },
    validation: [],
    diff: [{ path: '/objective', operation: 'replace', value: 'Review exact change set' }],
    author: { kind: 'human', principalId: 'user-1', roles: [], capabilities: [] },
    conflict: { status: 'current' },
  }
  const command = {
    contractVersion: session.contractVersion,
    commandId: 'command-1',
    capabilityId: session.capabilityId,
    resource: session.resource,
    expected: session.base,
    policyRevision: session.policyRevision,
    author: session.author,
    changes: session.changes,
    changeSetFingerprint: { algorithm: 'presentation-fnv1a64/v1' as const, value: 'abc', authoritative: false as const },
  }
  return {
    session,
    submission: {
      kind: 'operation_proposal',
      command,
      effectClass: 'consequential',
      proposalReason: 'workflow_required',
      lifecycle: ['proposal', 'approval', 'execution'],
      executionAvailable: false,
      transportAvailable: false,
    },
  }
}

test('delivery review state binds only to the shared edit-command surface', () => {
  const { session, submission } = reviewFixture()
  const binding = bindDeliveryReviewSession(session, submission)
  assert.equal(binding.transport, 'shared_edit_command_only')
  assert.equal(binding.submission.command.commandId, 'command-1')
  assert.throws(
    () => bindDeliveryReviewSession({ ...session, conflict: { status: 'stale', latest: session.base, canCompare: true, canRebase: false } }, submission),
    GovernedDeliveryValidationError,
  )
})
