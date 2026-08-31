import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteProjectGoalClient } from '../src/services/remoteProjectGoals.ts'

const wire = {
  goal_id: 'goal-1', project_id: 'project/a', version: 2, revision: 3,
  objective: 'Ship the visual demo', acceptance_criteria: ['Tests pass'], status: 'working',
  policy_receipt: { authority_mode: 'trusted_local' }, root_thread_id: 'thread-1',
  supervisor_run_id: 'run-1', evidence: [], created_at: '2026-08-25T00:00:00Z',
  updated_at: '2026-08-25T00:01:00Z',
  available_actions: { start: false, pause: true, resume: false, stop: true },
} as const

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

test('maps project goals and sends every authoritative lifecycle action', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ path: string; method: string; body?: unknown }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({
      path: input.toString().replace('http://daemon.test', ''),
      method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    })
    return json(wire)
  }
  try {
    const client = new RemoteProjectGoalClient('http://daemon.test', () => 'owner')
    assert.equal((await client.get('project/a'))?.rootThreadId, 'thread-1')
    await client.set('project/a', { objective: 'Ship', acceptanceCriteria: ['Pass'] })
    await client.start('project/a', { harness: 'codex', idempotencyKey: 'start-1' })
    await client.pause('project/a', 3)
    await client.resume('project/a', 4)
    await client.stop('project/a', 5)
    assert.deepEqual(requests, [
      { path: '/api/projects/project%2Fa/goal', method: 'GET' },
      { path: '/api/projects/project%2Fa/goal', method: 'PUT', body: { objective: 'Ship', acceptance_criteria: ['Pass'] } },
      { path: '/api/projects/project%2Fa/goal/start', method: 'POST', body: { harness: 'codex', idempotency_key: 'start-1' } },
      { path: '/api/projects/project%2Fa/goal/pause', method: 'POST', body: { expected_revision: 3 } },
      { path: '/api/projects/project%2Fa/goal/resume', method: 'POST', body: { expected_revision: 4 } },
      { path: '/api/projects/project%2Fa/goal/stop', method: 'POST', body: { expected_revision: 5 } },
    ])
  } finally { globalThis.fetch = originalFetch }
})

test('treats only a missing GET as an unconfigured goal and surfaces other errors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => json({ detail: 'goal transition rejected' }, 409)
  try {
    const client = new RemoteProjectGoalClient('http://daemon.test', () => 'owner')
    await assert.rejects(client.pause('project', 1), /goal transition rejected/)
  } finally { globalThis.fetch = originalFetch }
})
