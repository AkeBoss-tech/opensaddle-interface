import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteAgentProfileClient } from './remoteAgentProfiles'

// OS-AGENT-BUILDER-001: wire conversion preserves exact scopes, digest, and Run identity.

const digest = 'a'.repeat(64)
const definition = {
  title: 'Repository guide', objective: 'Review a source', instructions: 'Read only.', sourceId: 'src_1',
  harness: 'codex-app-server' as const,
  grants: [{ connector: 'github', action: 'get_repository', argumentEquals: { owner: 'company', repo: 'finance' }, rationale: 'Exact repository' }],
  assumptions: ['The source is current'], evidence: [],
}
const proposal = (status: 'proposed' | 'published' = 'proposed') => ({
  proposal_id: 'agp_1', project_id: 'P1', definition_digest: digest, status,
  definition: { title: definition.title, objective: definition.objective, instructions: definition.instructions, source_id: definition.sourceId, harness: definition.harness,
    grants: [{ connector: 'github', action: 'get_repository', argument_equals: { owner: 'company', repo: 'finance' }, rationale: 'Exact repository' }], assumptions: definition.assumptions, evidence: [] },
  published_at: status === 'published' ? '2026-09-19T00:00:00Z' : null,
  reviewed_by: status === 'published' ? 'owner' : null,
  participant_id: status === 'published' ? 'ptc_1' : null,
})

test('agent-profile client keeps definition, review digest, and task admission on canonical v2 routes', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const client = new RemoteAgentProfileClient('https://control.example/', () => 'owner', 'token', async (url, init) => {
    requests.push({ url: String(url), init })
    const path = new URL(String(url)).pathname
    if (path.endsWith('/agent-builder-options')) return Response.json({ schema_version: 'opensaddle.agent-builder-options.v1', project_id: 'P1', execution_available: true, can_review: true,
      sources: [{ source_id: 'src_1', source_kind: 'git', revision: 'rev-1', snapshot_digest: digest }], harnesses: ['codex-app-server'], connector_actions: [] })
    if (path.endsWith('/participants/ptc_1')) return Response.json({ project_id: 'P1', lifecycle: 'waiting', revision: 3 })
    if (path.endsWith('/agent-proposals') && init?.method !== 'POST') return Response.json({ schema_version: 'opensaddle.agent-proposal-list.v1', items: [proposal()] })
    if (path.endsWith('/agent-proposals')) return Response.json(proposal(), { status: 201 })
    if (path.endsWith('/publish')) return Response.json(proposal('published'))
    return Response.json({ schema_version: 'opensaddle.participant-message.v1', message_id: 'pmsg_1', participant_id: 'ptc_1', project_id: 'P1', run_id: 'run_1', status: 'queued', participant_revision: 0, replayed: false }, { status: 202 })
  })

  assert.equal((await client.options('P1')).sources[0].sourceId, 'src_1')
  assert.deepEqual(await client.participant('ptc_1'), { projectId: 'P1', lifecycle: 'waiting', revision: 3 })
  assert.equal((await client.list('P1'))[0].definition.sourceId, 'src_1')
  await client.propose('P1', definition)
  await client.publish('agp_1', digest)
  const admitted = await client.submitTask('ptc_1', 0, 'Inspect the source', 'same-key')
  assert.equal(admitted.runId, 'run_1')
  assert.equal(new Headers(requests[3].init?.headers).get('authorization'), 'Bearer token')
  assert.deepEqual(JSON.parse(String(requests[3].init?.body)), { title: 'Repository guide', objective: 'Review a source', instructions: 'Read only.', source_id: 'src_1', harness: 'codex-app-server', grants: [{ connector: 'github', action: 'get_repository', argument_equals: { owner: 'company', repo: 'finance' }, rationale: 'Exact repository' }], assumptions: ['The source is current'], evidence: [] })
  assert.deepEqual(JSON.parse(String(requests[4].init?.body)), { expected_digest: digest, acknowledge_assumptions: true })
  assert.equal(new Headers(requests[5].init?.headers).get('idempotency-key'), 'same-key')
  assert.deepEqual(JSON.parse(String(requests[5].init?.body)), { expected_participant_revision: 0, task: 'Inspect the source' })
})

test('agent-profile client rejects task replies that are not participant-message admissions', async () => {
  const client = new RemoteAgentProfileClient('https://control.example', () => 'owner', undefined, async () => Response.json({ run_id: 'run_1' }))
  await assert.rejects(client.submitTask('ptc_1', 0, 'Inspect', 'key'), /Agent task response is malformed/)
})
