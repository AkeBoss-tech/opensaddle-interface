import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteKrailProposalClient } from './remoteKrailProposals'

const digest = 'a'.repeat(64)
const proposal = {
  proposal_id: 'prp_1', project_id: 'project-1', record_digest: digest, protected_input_digest: digest,
  registered_action_id: 'krail.promote', registered_action_version: 1,
  actor: 'requester', delegation_chain: ['requester', 'agent-1'],
  targets: [{ expected_version: '7', resource_ref: { issuer: 'opensaddle', resource_type: 'candidate', resource_id: 'candidate-1', version: '7', digest: { value: digest }, source: { source_id: 'source-1', origin: 'workspace', version: '8', digest: { value: digest } } } }],
  declared_effects: [{ effect_class: 'code_mutation', bounds: {} }],
  policy_decision: { outcome: 'approval_required', policy_id: 'policy-1', policy_version: '1', policy_hash: digest, reason: 'review' },
  required_approvals: [{ kind: 'human', role: 'approver', count: 1 }],
  cost_estimate: { currency: 'USD', estimated_microunits: 1_000_000, budget_microunits: 2_000_000 },
  validation_results: [{ code: 'candidate.current', passed: true, message: null }], blockers: [],
  expires_at: '2026-09-08T03:00:00Z', created_at: '2026-09-07T03:00:00Z',
}

test('loads the immutable proposal before approving and only posts a bounded approval TTL', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; method?: string; body?: unknown }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return requests.length === 1 ? Response.json(proposal) : Response.json({ approval_id: 'kap_1', proposal_id: 'prp_1', approved_by: 'reviewer', proposal_record_digest: digest, expires_at: '2026-09-07T04:00:00Z' }, { status: 201 })
  }
  try {
    const client = new RemoteKrailProposalClient('https://control.example/', () => 'reviewer', 'token-1')
    const loaded = await client.get('prp_1')
    const approved = await client.approve(loaded.proposalId, 3600)
    assert.equal(loaded.recordDigest, digest)
    assert.equal(loaded.targets[0]?.expectedVersion, '7')
    assert.equal(loaded.actor, 'requester')
    assert.equal(approved.recordDigest, digest)
    assert.deepEqual(requests, [
      { url: 'https://control.example/api/v2/operation-proposals/prp_1', method: undefined, body: undefined },
      { url: 'https://control.example/api/v2/krail/proposals/prp_1/approval', method: 'POST', body: { ttl_seconds: 3600 } },
    ])
  } finally { globalThis.fetch = originalFetch }
})

test('surfaces a terminal expired proposal response without a local fallback', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ detail: 'KRAIL proposal has expired' }, { status: 409 })
  try { await assert.rejects(new RemoteKrailProposalClient('https://control.example', () => 'reviewer').approve('prp_1', 3600), /expired/) }
  finally { globalThis.fetch = originalFetch }
})
