import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import type { KrailProposalClient, OperationProposal } from '../../services/contracts'
import { ProposalReviewSurface } from './ProposalReviewPage'
import { effectBoundsSummary, formatMicrounits, fullEffectBounds, isApprovalCurrent } from './proposalReviewModel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
void React
const digest = (letter: string) => letter.repeat(64)
function proposal(id: string, letter = 'a'): OperationProposal { const hash = digest(letter); return { proposalId: id, projectId: 'project-1', recordDigest: hash, protectedInputDigest: hash, registeredActionId: 'actPromote', registeredActionVersion: 1, actor: 'requester', delegationChain: ['requester', 'agent-1'], targets: [{ issuer: 'opensaddle', resourceType: 'candidate', resourceId: `candidate-${id}`, resourceVersion: '2', expectedVersion: '2', digest: hash, source: { sourceId: 'source-1', origin: 'workspace', version: '3', digest: hash } }], declaredEffects: [{ effectClass: 'code_mutation', bounds: { paths: ['memory/candidate'], max_files: 1 } }], policy: { outcome: 'approval_required', id: 'policy-1', version: '1', hash, reason: 'human review' }, requiredApprovals: [{ kind: 'human', role: 'approver', count: 1 }], costEstimate: { currency: 'USD', estimatedMicrounits: 1_000_000, budgetMicrounits: 2_000_000 }, validationResults: [{ code: 'current', passed: true, message: null }], blockers: [], expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-09-07T00:00:00Z' } }
function surface(client: KrailProposalClient, proposalId: string) { return <MemoryRouter><ProposalReviewSurface client={client} proposalId={proposalId} /></MemoryRouter> }
async function mount(client: KrailProposalClient, id = 'prp_1') { let renderer!: ReactTestRenderer; await act(async () => { renderer = create(surface(client, id)); await Promise.resolve() }); return renderer }

test('mounted review fences a deferred old proposal route before the new record resolves', async () => {
  let resolveOld!: (value: OperationProposal) => void; let resolveNew!: (value: OperationProposal) => void
  const client: KrailProposalClient = { get: async (id) => new Promise((resolve) => { if (id === 'prp_old') resolveOld = resolve; else resolveNew = resolve }), approve: async () => { throw new Error('unused') } }
  const renderer = await mount(client, 'prp_old'); await act(async () => { renderer.update(surface(client, 'prp_new')) })
  await act(async () => { resolveOld(proposal('prp_old')) }); assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /candidate-prp_old|Grant approval/)
  const current = proposal('prp_new', 'b'); current.declaredEffects = [{ effectClass: 'external_write', bounds: { key_1: 'one', key_2: 'two', key_3: 'three', key_4: 'four', key_5: 'five', key_6: 'six', key_7: 'seven', key_8: 'eight', recipients: [{ id: 'user-9', email: 'review@example.test' }], scope: { repository: 'repo-1', branch: 'main' } } }]
  await act(async () => { resolveNew(current) })
  const markup = JSON.stringify(renderer.toJSON()); assert.match(markup, /candidate-prp_new/); assert.match(markup, /requester/); assert.match(markup, /agent-1/); assert.match(markup, /workspace.*source-1.*3/); assert.match(markup, /1\.00 USD \(1,000,000 microunits\).*Show exact declared bounds.*user-9.*review@example\.test.*repository.*repo-1.*branch.*main/s)
})

test('mounted review rejects a returned approval for another immutable proposal', async () => {
  let resolveApproval!: (value: Awaited<ReturnType<KrailProposalClient['approve']>>) => void
  const reviewed = proposal('prp_1'); const client: KrailProposalClient = { get: async () => reviewed, approve: async () => new Promise((resolve) => { resolveApproval = resolve }) }
  const renderer = await mount(client); const button = renderer.root.findAllByType('button').find((item) => item.findAllByProps({ className: 'os-button__label' }).some((label) => label.children.join('') === 'Grant approval'))!
  await act(async () => { button.props.onClick() }); await act(async () => { resolveApproval({ approvalId: 'kap_1', proposalId: 'prp_other', approvedBy: 'reviewer', recordDigest: digest('b'), expiresAt: '2099-01-01T00:00:00Z' }) })
  const markup = JSON.stringify(renderer.toJSON()); assert.match(markup, /Approval could not be recorded.*does not match the reviewed immutable proposal/s); assert.doesNotMatch(markup, /Approval recorded/)
})

test('formats base currency precisely and rejects expired replay authority', () => {
  assert.equal(formatMicrounits(1_000_000, 'USD'), '1.00 USD (1,000,000 microunits)')
  assert.equal(effectBoundsSummary({ long: 'x'.repeat(300) }).endsWith('…'), true)
  assert.equal(isApprovalCurrent({ approvalId: 'kap_1', proposalId: 'prp_1', approvedBy: 'reviewer', recordDigest: digest('a'), expiresAt: '2000-01-01T00:00:00Z' }), false)
})

test('does not approve an effect whose full bounds cannot be safely reviewed', () => {
  assert.equal(fullEffectBounds({ body: 'x'.repeat(16_385) }).reviewable, false)
})
