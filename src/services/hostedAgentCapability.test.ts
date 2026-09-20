import assert from 'node:assert/strict'
import test from 'node:test'
import { initServices } from './index'

// OS-HOSTED-AGENT-UI-001: hosted capability never masquerades as the personal
// agent_builder_v1/Participant contract.
test('exact hosted capability exposes only the external-agent client for authenticated remote connection', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let subject: string | undefined = 'owner'
  let scope = 'wrong_scope'
  let reviewScope = 'wrong_scope'
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname
    if (path === '/api/health') return Response.json({ mode: 'company', capabilities: [] })
    if (path === '/api/v2/capabilities') return Response.json({ authenticated_subject: subject,
      hosted_external_agent_v1: { available: true, scope, review_required: true,
        project_path_template: '/api/v2/projects/{project_id}/hosted-agent-proposals' },
      hosted_external_agent_result_review_v1: { available: true, schema_version: 'opensaddle.agent-result-review.v1',
        review_path_template: '/api/v2/runs/{run_id}/agent-result/review', scope: reviewScope },
      agent_builder_v1: { available: false, review_required: true, online_research_available: false,
        schema_version: 'opensaddle.agent-proposal.v1' },
      participants: { available: false },
    })
    return Response.json({ detail: 'not found' }, { status: 404 })
  }
  const create = () => initServices({ getGrants: () => [], setGrants: () => {}, currentUserId: 'stale-local',
    connection: { id: 'fixture', name: 'Fixture', mode: 'remote', baseUrl: 'https://core.example',
      token: 'fixture-token', allowMockFallback: false } })
  let services = await create()
  assert.equal(services.hostedAgents, undefined)
  assert.equal(services.agentProfiles, undefined)
  assert.equal(services.hostedAgentResultReview, undefined)
  scope = 'one_external_worker_no_connectors_or_memory'
  services = await create()
  assert.ok(services.hostedAgents)
  assert.equal(services.agentProfiles, undefined)
  assert.equal(services.participants, undefined)
  assert.equal(services.agentResultReview, undefined)
  assert.equal(services.hostedAgentResultReview, undefined)
  reviewScope = 'completed_hosted_external_agent_historical_result_only'
  services = await create()
  assert.ok(services.hostedAgentResultReview)
  assert.equal(services.agentResultReview, undefined)
  subject = undefined
  assert.equal((await create()).hostedAgents, undefined)
  assert.equal((await create()).hostedAgentResultReview, undefined)
})
