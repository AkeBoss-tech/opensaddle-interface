import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteCommandCenterClient } from './remoteCommandCenter'

test('maps the authoritative command center projection without inventing missing sections', async () => {
  const originalFetch = globalThis.fetch
  let headers: Headers | undefined
  globalThis.fetch = async (_input, init) => {
    headers = new Headers(init?.headers)
    return Response.json({
      generated_at: '2026-09-07T03:00:00Z',
      priority: { project_id: 'project-1', goal_id: 'goal-1', objective: 'Ship the daily loop', acceptance_criteria: ['Review one decision'], status: 'working' },
      attention_items: [{ id: 'attention-1', kind: 'approval', project_id: 'project-1', approval_id: 'approval-1', proposal_id: 'prp_1', record_digest: 'a'.repeat(64), title: 'Approve write', reason: 'External mutation', requested_action: 'Review exact arguments', available_actions: ['approve', 'deny'] }],
      active_runs: [{ run_id: 'run-1', project_id: 'project-1', task: 'Build UI', status: 'running' }],
      projects: [{ project_id: 'project-1', status: 'active', next_action: 'Review the run' }],
      outcomes: [{ id: 'outcome-1', project_id: 'project-1', run_id: 'run-0', title: 'Contract verified', verified: true, completed_at: '2026-09-07T02:00:00Z' }],
      unavailable_sections: ['recurring_jobs', 'operation_proposals'],
    })
  }
  try {
    const snapshot = await new RemoteCommandCenterClient('https://control.example/', () => 'user-1', 'token-1').get()
    assert.equal(snapshot.priority?.goalId, 'goal-1')
    assert.equal(snapshot.attentionItems[0]?.approvalId, 'approval-1')
    assert.equal(snapshot.attentionItems[0]?.proposalId, 'prp_1')
    assert.equal(snapshot.outcomes[0]?.verified, true)
    assert.deepEqual(snapshot.unavailableSections, ['recurring_jobs', 'operation_proposals'])
    assert.equal(headers?.get('X-OpenSaddle-User'), 'user-1')
    assert.equal(headers?.get('Authorization'), 'Bearer token-1')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('surfaces server errors instead of falling back to renderer data', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ detail: 'project membership required' }, { status: 403 })
  try {
    await assert.rejects(
      new RemoteCommandCenterClient('https://control.example', () => 'user-1').get(),
      /project membership required/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('maps exact Goal revision and distinguishes empty, ambiguous, and unavailable priority', async () => {
  const originalFetch = globalThis.fetch
  const states = ['available', 'empty', 'ambiguous', 'unavailable'] as const
  let index = 0
  globalThis.fetch = async () => Response.json({
    generated_at: '2026-09-07T05:00:00Z',
    priority: index === 0 ? { project_id: 'project-1', goal_id: 'goal-1', goal_revision: 7, objective: 'Ship the daily loop', acceptance_criteria: ['Find the real objective'], status: 'working', updated_at: '2026-09-07T04:59:00Z' } : null,
    section_status: { priority: { state: states[index], reason: index === 0 ? null : `${states[index]} reason` } },
    projects: [], unavailable_sections: index === 3 ? ['priority'] : [],
  })
  try {
    const client = new RemoteCommandCenterClient('https://control.example', () => 'user-1')
    for (const state of states) {
      const snapshot = await client.get() as unknown as { priority?: { goalRevision?: number }; priorityStatus?: { state: string; reason?: string } }
      assert.equal(snapshot.priorityStatus?.state, state)
      if (state === 'available') assert.equal(snapshot.priority?.goalRevision, 7)
      index += 1
    }
  } finally { globalThis.fetch = originalFetch }
})
