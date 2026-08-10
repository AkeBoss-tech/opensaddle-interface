import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSeedData } from '../src/data/seed.ts'
import {
  GroundedInvestigationThread,
  InvestigationClientError,
  InvestigationController,
  adaptInvestigationProjection,
  operationProposalMatchesProjection,
  presentContextBrief,
  presentOperationProposal,
  proposalBindingKey,
  selectBoundInvestigationSnapshot,
  selectBoundProposalState,
  type CreateInvestigationInput,
  type InvestigationProjection,
  type InvestigationTransport,
  type ReconcileInvestigationInput,
  type SavePlanDraftInput,
} from '../src/features/investigation/index.ts'
import { OperationController } from '../src/features/runs/operationController.ts'
import type { SessionEvent } from '../src/services/contracts.ts'
import type { AgentRunBlock } from '../src/types.ts'
import { applyEvidencePolicy } from '../src/features/evidence/index.ts'
import { phase1EvidencePacket, phase1EvidencePolicy } from './fixtures/phase1Evidence.ts'

const A = 'a'.repeat(64)
const C = 'c'.repeat(64)
const D = 'd'.repeat(64)
const E = 'e'.repeat(64)
const F = 'f'.repeat(64)
const INV = 'inv_b62283b5cc0dba6da8d060381eb817b3'
const THREAD = 'thread_b62283b5cc0dba6da8d060381eb817b3'

async function acceptedFixtures() {
  const [contextBundle, golden] = await Promise.all([
    readFile('src/features/investigation/domain/snapshots/krail.context-brief.v1/bundle.json', 'utf8'),
    readFile('src/features/investigation/domain/snapshots/opensaddle.grounded-investigation.v1/fixtures/golden.json', 'utf8'),
  ])
  const context = JSON.parse(contextBundle) as { golden: { result: Record<string, unknown> } }
  const contract = JSON.parse(golden) as { create_request: Record<string, unknown> }
  return {
    context: structuredClone(context.golden.result),
    createRequest: structuredClone(contract.create_request),
  }
}

function projectionWire(context: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'opensaddle.grounded-investigation.v1',
    investigation_id: INV,
    outcome_thread_id: THREAD,
    project_id: 'p',
    repository: structuredClone(context.repository),
    issue: structuredClone(context.issue),
    query: 'Northstar issue 184 linux-arm64 verification',
    status: 'ready',
    failure: null,
    attempt: 2,
    context_brief: context,
    plan_draft: {
      schema_version: 'opensaddle.human-plan-draft.v1',
      title: 'Verify release',
      objective: 'Resolve issue 184 safely',
      steps: ['Inspect exact evidence', 'Verify linux-arm64'],
      assumptions: ['No external mutation'],
      authored_by: 'alice',
    },
    plan_version: 3,
    plan_digest: E,
    operation_proposal: {
      path: '/api/v2/operation-proposals',
      proposal_id: 'prp_0123456789abcdef0123456789abcdef',
      execution_available: false,
      protected_input_digest: E,
    },
    contract: {
      capability_id: 'krail.context-brief.opensaddle-v1',
      descriptor_digest: 'sha256:bfe1bd6af513f24df70b59617565a2262610119f13d0a8a7fb937fbca70098fd',
      manifest_digest: 'sha256:3fa4bb326946fe0555321b0790150dbbb2a92964fba23eae492f448e8c0655a7',
      source_commit: '21da6d42619410e8d1cfc4f823681e4eac47d21a',
    },
    created_at: '2026-08-07T15:30:00Z',
    updated_at: '2026-08-07T15:31:00Z',
    ...overrides,
  }
}

function proposalWire(projection: InvestigationProjection, overrides: Record<string, unknown> = {}) {
  const wireRef = (resource: InvestigationProjection['repository']) => ({
    issuer: resource.issuer,
    resource_id: resource.resourceId,
    resource_type: resource.resourceType,
    version: resource.version,
    digest: resource.digest,
    source: {
      source_id: resource.source.sourceId,
      origin: resource.source.origin,
      version: resource.source.version,
      digest: resource.source.digest,
    },
  })
  return {
    proposal_id: projection.operationProposal.proposalId,
    schema_version: 'opensaddle.operation-proposal.v1',
    optimistic_version: 1,
    project_id: projection.projectId,
    registered_action_id: 'act_0123456789abcdef',
    registered_action_version: 4,
    actor: 'alice',
    delegation_chain: ['planner-agent'],
    targets: [
      { resource_ref: wireRef(projection.repository), expected_version: projection.repository.version },
      { resource_ref: wireRef(projection.issue), expected_version: projection.issue.version },
    ],
    protected_input_digest: projection.planDigest,
    declared_effects: [{ effect_class: 'read', bounds: { max_targets: 2, network: 'brokered_read_only' } }],
    policy_decision: {
      outcome: 'approval_required',
      policy_id: 'proposal-policy',
      policy_version: '3',
      policy_hash: 'policy-approval-required',
      obligations: {},
      reason: 'Human review required',
    },
    validation_results: [{ code: 'grounded_context.available', passed: true, message: null }],
    required_approvals: [{ kind: 'human', role: 'approver', count: 2 }],
    cost_estimate: { currency: 'USD', estimated_microunits: 10, budget_microunits: 20 },
    blockers: [{ code: 'approval_required', message: 'policy requires approval' }],
    idempotency_key: `${projection.investigationId}:plan:${projection.planVersion}:${projection.planDigest}`,
    request_digest: C,
    correlation_ids: [projection.investigationId, projection.outcomeThreadId],
    expires_at: '2026-08-07T16:30:00Z',
    created_at: '2026-08-07T15:30:00Z',
    record_digest: D,
    ...overrides,
  }
}

function createInput(request: Record<string, unknown>): CreateInvestigationInput {
  const projection = adaptInvestigationProjection(projectionWire({
    ...(request as { repository: Record<string, unknown>; issue: Record<string, unknown> }),
    schema_version: 'krail.context-brief.v1',
    brief_digest: `sha256:${A}`,
  }, { context_brief: null, plan_draft: null, plan_version: 0, plan_digest: null, operation_proposal: { path: '/api/v2/operation-proposals', proposal_id: null, execution_available: false, protected_input_digest: null } }))
  return {
    projectId: projection.projectId,
    repository: projection.repository,
    issue: projection.issue,
    query: typeof request.query === 'string' ? request.query : null,
    evaluatedAt: String(request.evaluated_at),
  }
}

class JourneyTransport implements InvestigationTransport {
  creates = 0
  retries = 0
  cancels = 0
  gets = 0
  saves: SavePlanDraftInput[] = []
  projection: InvestigationProjection
  createGate?: Promise<void>
  retryFailure?: InvestigationClientError

  constructor(projection: InvestigationProjection) { this.projection = projection }
  async create() { this.creates += 1; await this.createGate; return this.projection }
  async get() { this.gets += 1; return this.projection }
  async retry() {
    this.retries += 1
    if (this.retryFailure) throw this.retryFailure
    return this.projection
  }
  async cancel() {
    this.cancels += 1
    return adaptInvestigationProjection(projectionWire(this.projection.contextBrief as Record<string, unknown>, {
      status: 'cancelled',
      failure: { code: 'cancelled', message: 'Refresh cancelled', retryable: true },
      attempt: this.projection.attempt + 1,
      updated_at: '2026-08-07T15:33:00Z',
    }))
  }
  async reconcile(_id: string, _input: ReconcileInvestigationInput) { return this.projection }
  async savePlan(_id: string, input: SavePlanDraftInput) {
    this.saves.push(input)
    this.projection = adaptInvestigationProjection(projectionWire(this.projection.contextBrief as Record<string, unknown>, {
      plan_draft: {
        schema_version: 'opensaddle.human-plan-draft.v1',
        title: input.title,
        objective: input.objective,
        steps: input.steps,
        assumptions: input.assumptions,
        authored_by: 'alice',
      },
      plan_version: input.expectedVersion + 1,
      plan_digest: F,
      operation_proposal: {
        path: '/api/v2/operation-proposals',
        proposal_id: 'prp_fedcba9876543210fedcba9876543210',
        execution_available: false,
        protected_input_digest: F,
      },
      updated_at: '2026-08-07T15:34:00Z',
    }))
    return this.projection
  }
}

const noops = {
  onRetry: async () => undefined,
  onCancel: async () => undefined,
  onReconnect: async () => undefined,
  onSavePlan: async () => undefined,
}

test('golden read-only issue journey resumes one Thread, reviews evidence, edits a draft, and creates only a governed dry-run proposal', async () => {
  const fixtures = await acceptedFixtures()
  const initial = adaptInvestigationProjection(projectionWire(fixtures.context))
  const transport = new JourneyTransport(initial)
  let releaseCreate = () => undefined
  transport.createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
  const controller = new InvestigationController(transport)
  const input = createInput(fixtures.createRequest)

  const first = controller.createOrResume(input)
  const replay = controller.createOrResume(structuredClone(input))
  assert.equal(first, replay, 'same authority-qualified issue must share one in-flight create/resume')
  releaseCreate()
  const opened = await first
  assert.equal(transport.creates, 1)
  assert.equal(opened.outcomeThreadId, THREAD)
  assert.equal(controller.forOutcomeThread(THREAD)?.investigationId, INV)

  const context = presentContextBrief(opened.contextBrief!, opened)
  assert.equal(context.repository.resourceId, 'repository/northstar')
  assert.equal(context.issue.resourceId, 'issue/184')
  assert.equal(context.evidence.length, 2)

  const edited = await controller.savePlanDraft(opened.investigationId, {
    expectedVersion: opened.planVersion,
    title: 'Verify release safely',
    objective: 'Resolve issue 184 using only pinned evidence',
    steps: ['Review authorized citations', 'Verify linux-arm64 without mutation'],
    assumptions: ['Read-only investigation'],
    registeredActionId: 'act_0123456789abcdef',
    registeredActionVersion: 4,
    costEstimate: { currency: 'USD', estimated_microunits: 10, budget_microunits: 20 },
  })
  assert.equal(edited.planVersion, 4)
  assert.equal(edited.planDraft?.objective, 'Resolve issue 184 using only pinned evidence')
  assert.equal(edited.operationProposal.executionAvailable, false)

  const proposal = presentOperationProposal(proposalWire(edited), edited)
  const html = renderToStaticMarkup(React.createElement(GroundedInvestigationThread, {
    snapshot: { lifecycle: { phase: 'settled', projection: edited }, projection: edited },
    proposal,
    ...noops,
  }))
  for (const checkpoint of [
    'Grounded investigation', 'Issue source', 'Repository source', 'KRAIL Context Brief',
    'Versioned source links', 'Editable · not authoritative', 'Resolve issue 184 using only pinned evidence',
    'Governed dry run', 'Approval required', 'Proposal only · no execution', 'this screen has no execute control',
  ]) assert.ok(html.includes(checkpoint), `golden journey omitted ${checkpoint}`)
  assert.doesNotMatch(html, /<(button|a)[^>]*(execute|authorize|approve)[^>]*>/i)
  assert.equal('execute' in edited.operationProposal, false)
})

test('concurrent investigations survive navigation/reconnect and suppress duplicate or out-of-order replay independently', async () => {
  const { context } = await acceptedFixtures()
  const first = adaptInvestigationProjection(projectionWire(context))
  const second = adaptInvestigationProjection(projectionWire(context, {
    investigation_id: 'inv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    outcome_thread_id: 'thread_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    query: 'Concurrent investigation',
  }))
  const transport = new JourneyTransport(first)
  const controller = new InvestigationController(transport)
  controller.accept(first)
  controller.accept(second)
  const firstPhases: string[] = []
  const secondPhases: string[] = []
  const releaseFirst = controller.subscribe(first.investigationId, (snapshot) => firstPhases.push(snapshot.lifecycle.phase))
  const releaseSecond = controller.subscribe(second.investigationId, (snapshot) => secondPhases.push(snapshot.lifecycle.phase))
  releaseFirst()
  releaseSecond()

  const firstNewer = adaptInvestigationProjection(projectionWire(context, { attempt: 4, updated_at: '2026-08-07T15:40:00Z' }))
  const secondNewer = adaptInvestigationProjection(projectionWire(context, {
    investigation_id: second.investigationId,
    outcome_thread_id: second.outcomeThreadId,
    query: second.query,
    attempt: 3,
    updated_at: '2026-08-07T15:39:00Z',
  }))
  controller.accept(firstNewer)
  controller.accept(firstNewer)
  controller.accept(first)
  controller.accept(secondNewer)
  controller.accept(second)
  assert.equal(controller.projection(first.investigationId)?.attempt, 4)
  assert.equal(controller.projection(second.investigationId)?.attempt, 3)

  transport.projection = firstNewer
  const navigatedPhases: string[] = []
  const unsubscribe = controller.subscribe(first.investigationId, (snapshot) => navigatedPhases.push(snapshot.lifecycle.phase))
  await controller.reconnect(first.investigationId)
  unsubscribe()
  assert.deepEqual(navigatedPhases, ['settled', 'requesting', 'settled'])
  assert.deepEqual(firstPhases, ['settled'])
  assert.deepEqual(secondPhases, ['settled'])
})

test('stale Context Brief refresh exposes retry, cancel, unavailable, and version-conflict states without discarding the last projection', async () => {
  const { context } = await acceptedFixtures()
  const staleContext = structuredClone(context)
  ;(staleContext.freshness as Array<Record<string, unknown>>)[0]!.status = 'stale'
  const stale = adaptInvestigationProjection(projectionWire(staleContext, {
    status: 'needs_attention',
    failure: { code: 'stale_evidence', message: 'Pinned evidence is stale', retryable: true },
  }))
  const transport = new JourneyTransport(stale)
  const controller = new InvestigationController(transport)
  controller.accept(stale)
  const snapshots: Array<{ phase: string; code?: string; retained?: boolean }> = []
  controller.subscribe(stale.investigationId, (snapshot) => snapshots.push({
    phase: snapshot.lifecycle.phase,
    code: snapshot.lifecycle.phase === 'failed' ? snapshot.lifecycle.failure.code : undefined,
    retained: snapshot.lifecycle.phase === 'failed' ? snapshot.lifecycle.lastProjection === stale : undefined,
  }))

  for (const failure of [
    { code: 'version_conflict' as const, message: 'Exact source version changed', retryable: false },
    { code: 'unavailable' as const, message: 'Context provider unavailable', retryable: true },
  ]) {
    transport.retryFailure = new InvestigationClientError(failure)
    await assert.rejects(controller.retry(stale.investigationId), InvestigationClientError)
  }
  transport.retryFailure = undefined
  await controller.retry(stale.investigationId)
  const cancelled = await controller.cancel(stale.investigationId)
  assert.equal(cancelled.status, 'cancelled')
  assert.ok(snapshots.some((item) => item.code === 'version_conflict' && item.retained))
  assert.ok(snapshots.some((item) => item.code === 'unavailable' && item.retained))
  assert.equal(transport.retries, 3)
  assert.equal(transport.cancels, 1)

  for (const failure of [
    { code: 'stale_evidence', message: 'Pinned evidence is stale', retryable: true },
    { code: 'version_conflict', message: 'Exact source version changed', retryable: false },
    { code: 'unavailable', message: 'Context provider unavailable', retryable: true },
  ] as const) {
    const html = renderToStaticMarkup(React.createElement(GroundedInvestigationThread, {
      snapshot: { lifecycle: { phase: 'failed', failure, lastProjection: stale }, projection: stale },
      ...noops,
    }))
    assert.ok(html.includes(failure.code.replaceAll('_', ' ')))
    assert.ok(html.includes(failure.message))
    assert.ok(html.includes('Reconnect'))
    assert.equal(html.includes('Retry'), failure.retryable)
  }
})

test('unauthorized evidence is filtered before presentation with one opaque omission and no content, identifier, or count leakage', async () => {
  const { context } = await acceptedFixtures()
  const secret = 'restricted-provider-payload-9f84'
  const secretId = 'evidence/restricted-2048'
  const evidence = context.evidence as { authorization: Record<string, unknown>; results: Array<{ citations: Array<Record<string, unknown>> }> }
  evidence.authorization.omitted_count = 37
  evidence.authorization.count_precision = 'undisclosed'
  evidence.authorization.reason_codes = ['policy-internal-secret']
  evidence.results[0]!.citations[0]!.content = secret
  evidence.results[0]!.citations[0]!.restricted_id = secretId
  context.omissions = [{ reason: 'authorization-policy', disclosure: 'Additional evidence may exist but is not visible in this authorization context.' }]
  const projection = adaptInvestigationProjection(projectionWire(context))
  const presented = presentContextBrief(projection.contextBrief!, projection)
  const serialized = JSON.stringify(presented)

  assert.deepEqual(presented.omissions, ['Additional evidence may exist but is not visible in this authorization context.'])
  for (const leak of [secret, secretId, 'omitted_count', 'count_precision', 'policy-internal-secret']) {
    assert.equal(serialized.includes(leak), false, `presentation leaked ${leak}`)
  }
  assert.equal(presented.evidence.length, 2)
  assert.equal((presented as unknown as Record<string, unknown>).omittedCount, undefined)
  assert.deepEqual(Object.keys(presented.omissions), ['0'])
})

test('Context Brief drift fails before assertion or evidence text can become a presentation', async () => {
  const { context } = await acceptedFixtures()
  const projection = adaptInvestigationProjection(projectionWire(context))
  for (const resourceName of ['repository', 'issue'] as const) {
    const drifted = structuredClone(context)
    ;(drifted[resourceName] as { version: string }).version = `git:drifted-${resourceName}`
    ;(drifted.assertions as Array<{ text: string }>)[0]!.text = `never-present-${resourceName}-assertion`
    ;((drifted.evidence as { results: Array<{ citations: Array<Record<string, unknown>> }> }).results[0]!.citations[0]!).content = `never-present-${resourceName}-content`
    let presentation: unknown
    assert.throws(() => { presentation = presentContextBrief(drifted as never, projection) }, /not bound/)
    assert.equal(presentation, undefined)
  }
})

test('snapshot, proposal, loading, and error state never cross any identity or immutable binding boundary', async () => {
  const { context } = await acceptedFixtures()
  const projection = adaptInvestigationProjection(projectionWire(context))
  const proposal = presentOperationProposal(proposalWire(projection), projection)
  const settled = { lifecycle: { phase: 'settled' as const, projection }, projection }
  const wrongSessionCases = [
    { investigationId: 'inv_wrong', expectedThreadId: projection.outcomeThreadId, expectedProjectId: projection.projectId },
    { investigationId: projection.investigationId, expectedThreadId: 'thread_wrong', expectedProjectId: projection.projectId },
    { investigationId: projection.investigationId, expectedThreadId: projection.outcomeThreadId, expectedProjectId: 'project_wrong' },
  ]
  for (const identity of wrongSessionCases) {
    const selected = selectBoundInvestigationSnapshot(identity, { investigationId: projection.investigationId, snapshot: settled })
    assert.equal(selected.projection, undefined)
    assert.equal(selected.lifecycle.phase === 'settled', false)
    const html = renderToStaticMarkup(React.createElement(GroundedInvestigationThread, { snapshot: selected, ...noops }))
    assert.equal(html.includes(projection.planDraft!.objective), false)
    assert.equal(html.includes(projection.issue.resourceId), false)
  }

  const binding = proposalBindingKey(projection)
  assert.ok(binding)
  const boundState = { bindingKey: binding, proposal, loading: false, error: 'bound error' }
  assert.equal(selectBoundProposalState(projection, boundState).proposal, proposal)
  const crossed: Array<{ projection: InvestigationProjection; directMatch: boolean }> = [
    { projection: { ...projection, investigationId: 'inv_wrong' }, directMatch: false },
    { projection: { ...projection, outcomeThreadId: 'thread_wrong' }, directMatch: false },
    { projection: { ...projection, projectId: 'project_wrong' }, directMatch: false },
    // Plan version is fenced by the binding key; it is intentionally not duplicated in the proposal presentation.
    { projection: { ...projection, planVersion: projection.planVersion + 1 }, directMatch: true },
    { projection: { ...projection, planDigest: A }, directMatch: false },
    { projection: { ...projection, operationProposal: { ...projection.operationProposal, proposalId: 'prp_wrong' } }, directMatch: false },
    { projection: { ...projection, operationProposal: { ...projection.operationProposal, protectedInputDigest: A } }, directMatch: false },
  ]
  for (const { projection: next, directMatch } of crossed) {
    const selected = selectBoundProposalState(next, boundState)
    assert.equal(selected.proposal, undefined)
    assert.equal(selected.error, undefined)
    assert.equal(selected.loading, proposalBindingKey(next) !== null)
    assert.equal(operationProposalMatchesProjection(proposal, next), directMatch)
  }
})

test('dry-run presentation covers approval, denial, budget, validation, and unavailable states but never offers execution', async () => {
  const { context } = await acceptedFixtures()
  const projection = adaptInvestigationProjection(projectionWire(context))
  const cases = [
    ['approval_required', 'approval_required', 'Approval required'],
    ['denied', 'policy_denied', 'Policy denied'],
    ['budget', 'budget_exceeded', 'Budget exceeded'],
    ['validation', 'validation_failed', 'Validation failed'],
    ['unavailable', 'action_unavailable', 'Action unavailable'],
  ] as const
  for (const [policyOutcome, blockerCode, label] of cases) {
    const proposal = presentOperationProposal(proposalWire(projection, {
      policy_decision: {
        outcome: policyOutcome,
        policy_id: 'proposal-policy',
        policy_version: '3',
        policy_hash: `policy-${policyOutcome}`,
        obligations: {},
        reason: label,
      },
      blockers: [{ code: blockerCode, message: `${label} blocks this dry run` }],
      validation_results: blockerCode === 'validation_failed'
        ? [{ code: 'grounded_context.available', passed: false, message: 'Context validation failed' }]
        : [{ code: 'grounded_context.available', passed: true, message: null }],
    }), projection)
    const html = renderToStaticMarkup(React.createElement(GroundedInvestigationThread, {
      snapshot: { lifecycle: { phase: 'settled', projection }, projection },
      proposal,
      ...noops,
    }))
    assert.ok(html.includes(label))
    assert.ok(html.includes(blockerCode))
    assert.ok(html.includes('Proposal only · no execution'))
    assert.doesNotMatch(html, /<(button|a)[^>]*(execute|authorize|approve)[^>]*>/i)
  }
  const unavailableHtml = renderToStaticMarkup(React.createElement(GroundedInvestigationThread, {
    snapshot: { lifecycle: { phase: 'settled', projection }, projection },
    proposalError: 'Operation proposal is unavailable or restricted',
    ...noops,
  }))
  assert.match(unavailableHtml, /role="alert"/)
  assert.match(unavailableHtml, /unavailable or restricted/)
  assert.doesNotMatch(unavailableHtml, /<(button|a)[^>]*(execute|authorize|approve)[^>]*>/i)
})

test('objective, Context Brief, evidence links, editable plan, and proposal retain keyboard-accessible semantics', async () => {
  const { context } = await acceptedFixtures()
  const projection = adaptInvestigationProjection(projectionWire(context))
  const proposal = presentOperationProposal(proposalWire(projection), projection)
  const html = renderToStaticMarkup(React.createElement(GroundedInvestigationThread, {
    snapshot: { lifecycle: { phase: 'settled', projection }, projection },
    proposal,
    ...noops,
  }))
  for (const semantic of [
    '<article class="grounded-investigation" aria-labelledby="gi-title">',
    '<h1 id="gi-title">',
    '<section class="gi-card gi-context" aria-labelledby="gi-context-title">',
    '<h2 id="gi-context-title">',
    '<section class="gi-card gi-plan" aria-labelledby="gi-plan-title">',
    '<h2 id="gi-plan-title">Investigation plan</h2>',
    '<label>Objective<textarea',
    '<label>Steps <small>One reviewable step per line</small><textarea',
    '<section class="gi-card gi-proposal " aria-labelledby="gi-proposal-title">',
    '<h2 id="gi-proposal-title">Operation proposal</h2>',
    '<a href="#context-evidence-',
    '<button type="button"',
  ]) assert.ok(html.includes(semantic), `missing accessible semantic: ${semantic}`)
  assert.doesNotMatch(html, /tabindex="[1-9]/i)
  assert.doesNotMatch(html, /onkey|onclick=/i)
})

test('Phase 2 projections stay out of the legacy workspace blob and retain Phase 1 evidence/reconnect guarantees', async () => {
  const { context } = await acceptedFixtures()
  const projection = adaptInvestigationProjection(projectionWire(context))
  const workspace = createSeedData()
  const before = JSON.stringify(workspace)
  presentContextBrief(projection.contextBrief!, projection)
  assert.equal(JSON.stringify(workspace), before)
  for (const forbidden of [projection.investigationId, projection.outcomeThreadId, projection.contextBrief!.brief_digest, projection.operationProposal.proposalId!]) {
    assert.equal(before.includes(forbidden), false)
  }

  const evidence = applyEvidencePolicy(phase1EvidencePacket, phase1EvidencePolicy)
  assert.ok(evidence.citations.length > 0)
  assert.ok(evidence.omissions.length > 0)
  assert.equal(JSON.stringify(evidence).includes('never-present-secret-id'), false)

  const run = (id: string): AgentRunBlock => ({
    id, kind: 'coding', title: id, model: 'test', harness: 'test', runtime: 'test',
    statusText: 'Starting', done: false, tools: [], plan: [], artifacts: [],
  })
  const event = (runId: string, sequence: number, text: string): SessionEvent => ({
    event_id: `${runId}-${sequence}`, session_id: `session-${runId}`, run_id: runId,
    sequence, timestamp: '2026-08-07T12:00:00Z', type: 'agent.output.delta', payload: { text },
  })
  const listeners = new Map<string, (item: SessionEvent) => void>()
  const runs = new OperationController()
  const attach = (runId: string) => runs.attach({
    runId,
    initialRun: run(runId),
    subscribe: (id, listener) => { listeners.set(id, listener); return () => undefined },
    onUpdate: () => undefined,
  })
  attach('run-a')
  attach('run-b')
  listeners.get('run-a')!(event('run-a', 1, 'alpha '))
  listeners.get('run-b')!(event('run-b', 1, 'bravo '))
  runs.release('run-a')
  attach('run-a')
  listeners.get('run-a')!(event('run-a', 1, 'duplicate '))
  listeners.get('run-a')!(event('run-a', 2, 'resumed'))
  assert.equal(runs.get('run-a')?.text, 'alpha resumed')
  assert.equal(runs.get('run-b')?.text, 'bravo ')
})
