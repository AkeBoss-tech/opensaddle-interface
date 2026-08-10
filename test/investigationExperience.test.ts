import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  GroundedInvestigationThread,
  adaptInvestigationProjection,
  isPlanBindingInvalidated,
  operationProposalMatchesProjection,
  presentContextBrief,
  presentOperationProposal,
  proposalBindingKey,
  selectBoundInvestigationSnapshot,
  selectBoundProposalState,
  type InvestigationProjection,
} from '../src/features/investigation/index.ts'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const D = 'd'.repeat(64)
const E = 'e'.repeat(64)
const INV = 'inv_b62283b5cc0dba6da8d060381eb817b3'
const THREAD = 'thread_b62283b5cc0dba6da8d060381eb817b3'

async function contextBrief() {
  const bundle = JSON.parse(await readFile('src/features/investigation/domain/snapshots/krail.context-brief.v1/bundle.json', 'utf8')) as {
    golden: { result: Record<string, unknown> }
  }
  return structuredClone(bundle.golden.result)
}

function projectionWire(context: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const repository = structuredClone(context.repository as Record<string, unknown>)
  const issue = structuredClone(context.issue as Record<string, unknown>)
  return {
    schema_version: 'opensaddle.grounded-investigation.v1', investigation_id: INV, outcome_thread_id: THREAD,
    project_id: 'p', repository, issue,
    query: 'Investigate linux-arm64 verification', status: 'ready', failure: null, attempt: 2,
    context_brief: context,
    plan_draft: { schema_version: 'opensaddle.human-plan-draft.v1', title: 'Verify release', objective: 'Resolve issue 184 safely', steps: ['Inspect exact evidence', 'Verify linux-arm64'], assumptions: ['No external mutation'], authored_by: 'alice' },
    plan_version: 3, plan_digest: E,
    operation_proposal: { path: '/api/v2/operation-proposals', proposal_id: 'prp_0123456789abcdef0123456789abcdef', execution_available: false, protected_input_digest: E },
    contract: { capability_id: 'krail.context-brief.opensaddle-v1', descriptor_digest: 'sha256:bfe1bd6af513f24df70b59617565a2262610119f13d0a8a7fb937fbca70098fd', manifest_digest: 'sha256:3fa4bb326946fe0555321b0790150dbbb2a92964fba23eae492f448e8c0655a7', source_commit: '21da6d42619410e8d1cfc4f823681e4eac47d21a' },
    created_at: '2026-08-07T15:30:00Z', updated_at: '2026-08-07T15:31:00Z',
    ...overrides,
  }
}

function proposalWire(projection: InvestigationProjection, overrides: Record<string, unknown> = {}) {
  const wireRef = (resource: InvestigationProjection['repository']) => ({
    issuer: resource.issuer, resource_id: resource.resourceId, resource_type: resource.resourceType, version: resource.version,
    digest: resource.digest,
    source: { source_id: resource.source.sourceId, origin: resource.source.origin, version: resource.source.version, digest: resource.source.digest },
  })
  return {
    proposal_id: projection.operationProposal.proposalId, schema_version: 'opensaddle.operation-proposal.v1', optimistic_version: 1,
    project_id: projection.projectId, registered_action_id: 'act_0123456789abcdef', registered_action_version: 4,
    actor: 'alice', delegation_chain: ['planner-agent'],
    targets: [
      { resource_ref: wireRef(projection.repository), expected_version: projection.repository.version },
      { resource_ref: wireRef(projection.issue), expected_version: projection.issue.version },
    ],
    protected_input_digest: projection.planDigest,
    declared_effects: [{ effect_class: 'read', bounds: { max_targets: 2, network: 'brokered_read_only' } }],
    policy_decision: { outcome: 'approval_required', policy_id: 'proposal-policy', policy_version: '3', policy_hash: 'policy-approval_required', obligations: {}, reason: 'Human review required' },
    validation_results: [{ code: 'grounded_context.available', passed: true, message: null }],
    required_approvals: [{ kind: 'human', role: 'approver', count: 2 }],
    cost_estimate: { currency: 'USD', estimated_microunits: 10, budget_microunits: 20 },
    blockers: [{ code: 'approval_required', message: 'policy requires approval' }],
    idempotency_key: `${projection.investigationId}:plan:3:${E}`, request_digest: C,
    correlation_ids: [projection.investigationId, projection.outcomeThreadId],
    expires_at: '2026-08-07T16:30:00Z', created_at: '2026-08-07T15:30:00Z', record_digest: D,
    ...overrides,
  }
}

test('shapes Context Brief evidence and policy omissions without leaking counts or provider content', async () => {
  const context = await contextBrief()
  context.omissions = [{ reason: 'authorization-policy', disclosure: 'Additional evidence may exist but is not visible in this authorization context.' }]
  const evidence = context.evidence as { authorization: Record<string, unknown>; results: Array<{ citations: Array<Record<string, unknown>> }> }
  evidence.authorization.omitted_count = 9
  evidence.authorization.count_precision = 'undisclosed'
  evidence.results[0]!.citations[0]!.content = '<script>restricted provider content</script>'

  const projection = adaptInvestigationProjection(projectionWire(context))
  const presented = presentContextBrief(projection.contextBrief!, projection)
  assert.equal(presented.omissions.length, 1)
  assert.equal(JSON.stringify(presented).includes('omitted_count'), false)
  assert.equal(JSON.stringify(presented).includes('restricted provider content'), false)
  assert.equal(presented.evidence.length, 2)
  assert.equal(presented.evidence[0]?.relation, 'direct')
})

test('requires exact proposal binding to project, investigation, Thread, and plan digest', async () => {
  const projection = adaptInvestigationProjection(projectionWire(await contextBrief()))
  const proposal = presentOperationProposal(proposalWire(projection), projection)
  assert.equal(proposal.registeredActionVersion, 4)
  assert.deepEqual(proposal.blockers.map((item) => item.code), ['approval_required'])
  assert.equal(proposal.targets[0]?.expectedVersion, projection.repository.version)

  assert.throws(() => presentOperationProposal(proposalWire(projection, { protected_input_digest: A }), projection), /not bound/)
  assert.throws(() => presentOperationProposal(proposalWire(projection, { correlation_ids: [projection.investigationId] }), projection), /identity binding/)
  assert.throws(() => presentOperationProposal(proposalWire(projection, { blockers: [{ code: 'execute_now', message: 'unsafe' }] }), projection), /blocker is unsupported/)
})

test('rejects Context Brief text before presentation when repository or issue binding drifts', async () => {
  const context = await contextBrief()
  const projection = adaptInvestigationProjection(projectionWire(context))
  for (const resourceName of ['repository', 'issue'] as const) {
    const drifted = structuredClone(context)
    const resource = drifted[resourceName] as { version: string }
    resource.version = `git:unbound-${resourceName}`
    ;(drifted.assertions as Array<{ text: string }>)[0]!.text = 'must never be presented'
    assert.throws(() => presentContextBrief(drifted as never, projection), /not bound/)
  }
})

test('synchronously fences investigation and proposal state by Thread, project, plan, and proposal binding', async () => {
  const projection = adaptInvestigationProjection(projectionWire(await contextBrief()))
  const proposal = presentOperationProposal(proposalWire(projection), projection)
  const settled = { lifecycle: { phase: 'settled' as const, projection }, projection }

  assert.equal(selectBoundInvestigationSnapshot({
    investigationId: projection.investigationId, expectedThreadId: projection.outcomeThreadId,
    expectedProjectId: projection.projectId,
  }, { investigationId: projection.investigationId, snapshot: settled }).projection, projection)
  assert.equal(selectBoundInvestigationSnapshot({
    investigationId: projection.investigationId, expectedThreadId: 'thread_other',
    expectedProjectId: projection.projectId,
  }, { investigationId: projection.investigationId, snapshot: settled }).lifecycle.phase, 'failed')
  assert.equal(selectBoundInvestigationSnapshot({
    investigationId: projection.investigationId, expectedThreadId: projection.outcomeThreadId,
    expectedProjectId: 'project_other',
  }, { investigationId: projection.investigationId, snapshot: settled }).lifecycle.phase, 'failed')
  assert.equal(selectBoundInvestigationSnapshot({
    investigationId: projection.investigationId, expectedThreadId: null,
    expectedProjectId: projection.projectId,
  }, { investigationId: projection.investigationId, snapshot: settled }).lifecycle.phase, 'failed')
  assert.equal(selectBoundInvestigationSnapshot({
    investigationId: 'inv_other', expectedThreadId: projection.outcomeThreadId,
    expectedProjectId: projection.projectId,
  }, { investigationId: projection.investigationId, snapshot: settled }).lifecycle.phase, 'requesting')

  const binding = proposalBindingKey(projection)
  assert.ok(binding)
  assert.deepEqual(selectBoundProposalState(projection, {
    bindingKey: binding, proposal, loading: false, error: 'old error',
  }), { proposal, loading: false, error: 'old error' })
  const nextPlan = { ...projection, planVersion: projection.planVersion + 1, planDigest: A }
  assert.equal(proposalBindingKey(nextPlan), null)
  assert.deepEqual(selectBoundProposalState(nextPlan, {
    bindingKey: binding, proposal, loading: true, error: 'must be fenced',
  }), { loading: false })
  assert.equal(operationProposalMatchesProjection(proposal, nextPlan), false)
  const nextProposal = {
    ...projection,
    operationProposal: { ...projection.operationProposal, proposalId: 'proposal_other' },
  }
  assert.equal(proposalBindingKey(nextProposal) === binding, false)
  assert.deepEqual(selectBoundProposalState(nextProposal, {
    bindingKey: binding, proposal, loading: false, error: 'must be fenced',
  }), { loading: true })
})

test('renders accessible grounded investigation, editable human draft, and non-executing proposal details', async () => {
  const context = await contextBrief()
  context.omissions = [{ reason: 'authorization-policy', disclosure: 'Additional evidence may exist but is not visible in this authorization context.' }]
  const projection = adaptInvestigationProjection(projectionWire(context))
  const proposal = presentOperationProposal(proposalWire(projection), projection)
  const noop = async () => undefined
  const html = renderToStaticMarkup(React.createElement(GroundedInvestigationThread, {
    snapshot: { lifecycle: { phase: 'settled', projection }, projection }, proposal,
    onRetry: noop, onCancel: noop, onReconnect: noop, onSavePlan: noop,
  }))

  for (const expected of [
    'aria-labelledby="gi-title"', 'Issue source', 'Repository source', 'KRAIL Context Brief',
    'Freshness', 'Conflicts', 'Gaps', 'Safe policy omissions', 'Lineage &amp; evidence',
    'Human draft', 'Editable · not authoritative', 'Save draft &amp; prepare dry run',
    'Proposal only · no execution', 'Registered action', 'Delegation chain', 'Targets &amp; expected versions',
    'Declared effects', 'Policy snapshot', 'Required approvals', 'Cost &amp; budget', 'Validation', 'Typed blockers',
    'this screen has no execute control',
    'git:https://example.test/acme/northstar.git', 'repository · direct',
  ]) assert.equal(html.includes(expected), true, expected)

  assert.equal(/<button[^>]*>\s*Execute\s*<\/button>/i.test(html), false)
  assert.equal(/<a[^>]+git:https:\/\/example\.test/i.test(html), false)
  assert.equal(html.includes('<script>'), false)
})

test('presents unknown evidence resource types as inert generic text', async () => {
  const context = await contextBrief()
  const evidence = context.evidence as { results: Array<{ citations: Array<Record<string, unknown>> }> }
  evidence.results[0]!.citations[0]!.resource = {
    ...(evidence.results[0]!.citations[0]!.resource as Record<string, unknown>),
    resource_type: 'customer-defined-record',
  }
  const projection = adaptInvestigationProjection(projectionWire(context))
  const noop = async () => undefined
  const html = renderToStaticMarkup(React.createElement(GroundedInvestigationThread, {
    snapshot: { lifecycle: { phase: 'settled', projection }, projection },
    onRetry: noop, onCancel: noop, onReconnect: noop, onSavePlan: noop,
  }))
  assert.equal(html.includes('customer-defined-record · direct'), true)
  assert.equal(html.includes('<customer-defined-record'), false)
})

test('draft edits invalidate the immutable proposal binding', async () => {
  const projection = adaptInvestigationProjection(projectionWire(await contextBrief()))
  assert.equal(isPlanBindingInvalidated({ title: 'Verify release', objective: 'Resolve issue 184 safely', steps: 'Inspect exact evidence\nVerify linux-arm64', assumptions: 'No external mutation' }, projection), false)
  assert.equal(isPlanBindingInvalidated({ title: 'Changed plan', objective: 'Resolve issue 184 safely', steps: 'Inspect exact evidence\nVerify linux-arm64', assumptions: 'No external mutation' }, projection), true)
})
