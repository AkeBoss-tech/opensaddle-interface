import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthoritativeLocalProjectClient } from '../src/services/authoritativeLocalProjects.ts'

const statuses = ['running', 'approval_required', 'committed', 'verification_failed', 'rejected', 'applied', 'failed', 'interrupted'] as const
for (const status of statuses) test(`projects sanitized ${status} run summary`, async () => {
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'owner', undefined, async (input) => {
    assert.equal(input.toString(), 'http://daemon.test/api/onboarding/runs?limit=7')
    return new Response(JSON.stringify({ contract: 'opensaddle.onboarding-run-list/v1', runs: [{ run_id: `run-${status}`, project_id: 'demo', recommendation_id: 'recommendation', recommendation_kind: 'project_action', status, fingerprint: null, diff_digest: null, changed_file_count: 0, checks: [], commit: null, ref: null, recoverable: false, materialization_validation: null, last_activity: null, created_at: '2026-08-17T00:00:00+00:00', updated_at: '2026-08-17T00:00:01+00:00' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const [run] = await client.listOnboardingRuns(7)
  assert.equal(run?.status, status)
  assert.equal(run?.projectId, 'demo')
  assert.equal(run?.updatedAt, Date.parse('2026-08-17T00:00:01+00:00'))
})

for (const [name, limit] of [['zero', 0], ['negative', -1], ['fractional', 1.5], ['too-large', 1001]] as const) {
  test(`rejects ${name} onboarding run limit before fetch`, async () => {
    const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'owner', undefined, async () => { throw new Error('fetch should not run') })
    await assert.rejects(client.listOnboardingRuns(limit), /between 1 and 1000/)
  })
}

for (const [name, payload] of [
  ['wrong run-list contract', { contract: 'opensaddle.onboarding-runs/v0', runs: [] }],
  ['missing run array', { contract: 'opensaddle.onboarding-run-list/v1' }],
  ['unknown run status', { contract: 'opensaddle.onboarding-run-list/v1', runs: [{ run_id: 'x', project_id: 'demo', status: 'unknown', changed_file_count: 0, checks: [], created_at: '2026-08-17T00:00:00Z', updated_at: '2026-08-17T00:00:00Z' }] }],
  ['negative changed-file count', { contract: 'opensaddle.onboarding-run-list/v1', runs: [{ run_id: 'x', project_id: 'demo', status: 'running', changed_file_count: -1, checks: [], created_at: '2026-08-17T00:00:00Z', updated_at: '2026-08-17T00:00:00Z' }] }],
  ['invalid run timestamp', { contract: 'opensaddle.onboarding-run-list/v1', runs: [{ run_id: 'x', project_id: 'demo', status: 'running', changed_file_count: 0, checks: [], created_at: 'today', updated_at: 'today' }] }],
] as const) test(`fails closed for ${name}`, async () => {
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'owner', undefined, async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await assert.rejects(client.listOnboardingRuns())
})
