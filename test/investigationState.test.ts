import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  HttpInvestigationTransport,
  InvestigationClientError,
  InvestigationController,
  adaptInvestigationProjection,
  type CreateInvestigationInput,
  type InvestigationProjection,
  type InvestigationTransport,
  type ReconcileInvestigationInput,
  type SavePlanDraftInput,
} from '../src/features/investigation/index.ts'

const sha = (value: string) => ({ algorithm: 'sha-256' as const, value })
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

const input: CreateInvestigationInput = {
  projectId: 'p',
  repository: {
    issuer: 'https://knowledge.example.test/provider',
    resourceId: 'repository/northstar',
    resourceType: 'repository',
    version: 'git:one',
    digest: sha(A),
    source: { sourceId: 'source/repository/northstar', origin: 'git:https://example.test/acme/northstar.git', version: 'git:one', digest: sha(A) },
  },
  issue: {
    issuer: 'https://knowledge.example.test/provider',
    resourceId: 'issue/184',
    resourceType: 'issue',
    version: 'git:two',
    digest: sha(B),
    source: { sourceId: 'source/issue/184', origin: 'git:https://example.test/acme/northstar.git', version: 'git:two', digest: sha(B) },
  },
  query: 'Investigate issue 184',
  evaluatedAt: '2026-08-07T15:30:00Z',
}

function wireProjection(overrides: Record<string, unknown> = {}) {
  const wireRef = (ref: CreateInvestigationInput['repository']) => ({
    issuer: ref.issuer, resource_id: ref.resourceId, resource_type: ref.resourceType,
    version: ref.version, digest: ref.digest,
    source: { source_id: ref.source.sourceId, origin: ref.source.origin, version: ref.source.version, digest: ref.source.digest },
  })
  return {
    schema_version: 'opensaddle.grounded-investigation.v1',
    investigation_id: 'inv_0123456789abcdef0123456789abcdef',
    outcome_thread_id: 'thread_0123456789abcdef0123456789abcdef',
    project_id: 'p', repository: wireRef(input.repository), issue: wireRef(input.issue),
    query: input.query, status: 'ready', failure: null, attempt: 1,
    context_brief: { schema_version: 'krail.context-brief.v1', brief_digest: `sha256:${A}`, evidence_packet: { authorization: { shape: 'authorized_projection' } } },
    plan_draft: null, plan_version: 0, plan_digest: null,
    operation_proposal: { path: '/api/v2/operation-proposals', proposal_id: null, execution_available: false, protected_input_digest: null },
    contract: {
      capability_id: 'krail.context-brief.opensaddle-v1',
      descriptor_digest: 'sha256:bfe1bd6af513f24df70b59617565a2262610119f13d0a8a7fb937fbca70098fd',
      manifest_digest: 'sha256:3fa4bb326946fe0555321b0790150dbbb2a92964fba23eae492f448e8c0655a7',
      source_commit: '21da6d42619410e8d1cfc4f823681e4eac47d21a',
    },
    created_at: '2026-08-07T15:30:00Z', updated_at: '2026-08-07T15:30:01Z',
    ...overrides,
  }
}

test('adapts exact authority-qualified refs and keeps plan draft separate from non-executing proposal', () => {
  const projection = adaptInvestigationProjection(wireProjection({
    plan_draft: { schema_version: 'opensaddle.human-plan-draft.v1', title: 'Plan', objective: 'Fix it', steps: ['Inspect'], assumptions: [], authored_by: 'alice' },
    plan_version: 1,
    plan_digest: A,
    operation_proposal: { path: '/api/v2/operation-proposals', proposal_id: 'proposal-1', execution_available: false, protected_input_digest: A },
  }))
  assert.equal(projection.repository.issuer, input.repository.issuer)
  assert.equal(projection.repository.version, 'git:one')
  assert.equal(projection.planDraft?.schemaVersion, 'opensaddle.human-plan-draft.v1')
  assert.equal(projection.operationProposal.executionAvailable, false)
  assert.equal('execute' in projection.operationProposal, false)
})

test('fails closed on drifted contract, ambiguous refs, or execution claims', () => {
  assert.throws(() => adaptInvestigationProjection(wireProjection({ contract: { capability_id: 'wrong' } })), /unrecognized Context Brief contract/)
  assert.throws(() => adaptInvestigationProjection(wireProjection({ repository: { issuer: 'relative' } })), /resource_type is unsupported/)
  assert.throws(() => adaptInvestigationProjection(wireProjection({ operation_proposal: { path: '/api/v2/operation-proposals', proposal_id: null, execution_available: true, protected_input_digest: null } })), /cannot represent execution/)
})

class FakeTransport implements InvestigationTransport {
  creates = 0
  projection = adaptInvestigationProjection(wireProjection())
  gate?: () => Promise<void>
  async create() { this.creates += 1; await this.gate?.(); return this.projection }
  async get() { return this.projection }
  async retry() { return this.projection }
  async cancel() { return adaptInvestigationProjection(wireProjection({ status: 'cancelled', failure: { code: 'cancelled', message: 'Cancelled', retryable: false }, updated_at: '2026-08-07T15:31:00Z' })) }
  async reconcile(_id: string, _input: ReconcileInvestigationInput) { return this.projection }
  async savePlan(_id: string, _input: SavePlanDraftInput) { return this.projection }
}

test('deduplicates create/resume and preserves stable outcome Thread navigation', async () => {
  const transport = new FakeTransport()
  let release = () => {}
  transport.gate = () => new Promise<void>((resolve) => { release = resolve })
  const controller = new InvestigationController(transport)
  const first = controller.createOrResume(input)
  const replay = controller.createOrResume({ ...input })
  assert.equal(first, replay)
  release()
  const projection = await first
  assert.equal(transport.creates, 1)
  assert.equal(controller.forOutcomeThread(projection.outcomeThreadId)?.investigationId, projection.investigationId)
})

test('reconnect/replay ignores out-of-order attempts and survives navigation subscriptions', async () => {
  const transport = new FakeTransport()
  const controller = new InvestigationController(transport)
  const base = controller.accept(transport.projection)
  const snapshots: string[] = []
  const unsubscribe = controller.subscribe(base.investigationId, (snapshot) => snapshots.push(snapshot.lifecycle.phase))
  const newer = adaptInvestigationProjection(wireProjection({ attempt: 2, updated_at: '2026-08-07T15:32:00Z' }))
  controller.accept(newer)
  controller.accept(base)
  assert.equal(controller.projection(base.investigationId)?.attempt, 2)
  transport.projection = newer
  await controller.reconnect(base.investigationId)
  unsubscribe()
  assert.deepEqual(snapshots, ['settled', 'settled', 'requesting', 'settled'])
})

test('cancel publishes a terminal server projection and stale local responses cannot replace it', async () => {
  const transport = new FakeTransport()
  const controller = new InvestigationController(transport)
  const base = controller.accept(transport.projection)
  const cancelled = await controller.cancel(base.investigationId)
  assert.equal(cancelled.status, 'cancelled')
  controller.accept(base)
  assert.equal(controller.projection(base.investigationId)?.status, 'cancelled')
})

test('HTTP adapter maps wire requests, typed conflicts, redaction, and network unavailability', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const client = new HttpInvestigationTransport('https://daemon.test/', () => 'alice', 'token', async (request, init) => {
    calls.push({ url: String(request), init })
    return new Response(JSON.stringify(wireProjection()), { status: 201, headers: { 'Content-Type': 'application/json' } })
  })
  const projection = await client.create(input)
  assert.equal(projection.outcomeThreadId.startsWith('thread_'), true)
  assert.equal(calls[0].url, 'https://daemon.test/api/v2/grounded-investigations')
  assert.equal((calls[0].init?.headers as Record<string, string>)['X-OpenSaddle-User'], 'alice')
  const body = JSON.parse(String(calls[0].init?.body))
  assert.equal(body.repository.resource_id, input.repository.resourceId)
  await client.reconcile(projection.investigationId, { repository: { ...input.repository, version: 'git:new' }, issue: input.issue, query: input.query, evaluatedAt: input.evaluatedAt })
  assert.equal(JSON.parse(String(calls[1].init?.body)).repository.version, 'git:new')
  await client.savePlan(projection.investigationId, {
    expectedVersion: 0, title: 'Plan', objective: 'Investigate', steps: ['Inspect'], assumptions: [],
    registeredActionId: 'action-1', registeredActionVersion: 1,
    costEstimate: { currency: 'USD', estimated_microunits: 0 },
  })
  const plan = JSON.parse(String(calls[2].init?.body))
  assert.equal(plan.expected_version, 0)
  assert.equal('execute' in plan, false)

  const restricted = new HttpInvestigationTransport('https://daemon.test', () => 'alice', undefined, async () => new Response(JSON.stringify({ detail: 'secret source id' }), { status: 404 }))
  await assert.rejects(restricted.get('inv-secret'), (error: unknown) => error instanceof InvestigationClientError && error.failure.code === 'redacted' && !error.message.includes('secret'))

  const conflict = new HttpInvestigationTransport('https://daemon.test', () => 'alice', undefined, async () => new Response(JSON.stringify({ detail: { code: 'version_conflict', message: 'Exact version changed', retryable: false } }), { status: 409 }))
  await assert.rejects(conflict.retry('inv-1'), (error: unknown) => error instanceof InvestigationClientError && error.failure.code === 'version_conflict' && !error.failure.retryable)

  const unavailable = new HttpInvestigationTransport('https://daemon.test', () => 'alice', undefined, async () => { throw new TypeError('socket details') })
  await assert.rejects(unavailable.get('inv-1'), (error: unknown) => error instanceof InvestigationClientError && error.failure.code === 'unavailable' && !error.message.includes('socket'))

  const invalid = new HttpInvestigationTransport('https://daemon.test', () => 'alice', undefined, async () => new Response(JSON.stringify({ secret: 'provider internals' }), { status: 200 }))
  await assert.rejects(invalid.get('inv-1'), (error: unknown) => error instanceof InvestigationClientError && error.failure.code === 'invalid_evidence' && !error.message.includes('provider internals'))
})

test('snapshots exactly match the accepted OpenSaddle and KRAIL bytes', async () => {
  const expected = new Map([
    ['src/features/investigation/domain/snapshots/opensaddle.grounded-investigation.v1/README.md', '8b4379bfdb8dd0150da25c635d24515cbdd657f85c400d168eef51562bcfd8d1'],
    ['src/features/investigation/domain/snapshots/opensaddle.grounded-investigation.v1/schema.json', '322f7724d6f855a5cc9e95f481eff7fa21f8c5f4980bee15094fe77c05f7ed60'],
    ['src/features/investigation/domain/snapshots/opensaddle.grounded-investigation.v1/fixtures/golden.json', 'b45ad5d3f434c748d8f4ba8ee252634dd80fdd06f2002feeb975fa6730bf7ffa'],
    ['src/features/investigation/domain/snapshots/krail.context-brief.v1/bundle.json', 'e6baed1891e5451aa4598e75d3b8fc93595ae8dc98f1b080c0f23d9c10eae434'],
    ['src/features/investigation/domain/snapshots/krail.context-brief.v1/manifest.json', 'b687da9caa99f690f439c84aaf3b767596d4005b678599f1e61a9ad3aed81cff'],
  ])
  for (const [path, digest] of expected) {
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), digest)
  }
})
