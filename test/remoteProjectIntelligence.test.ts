import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteProjectIntelligenceClient } from '../src/services/remoteProjectIntelligence.ts'

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

const wire = {
  snapshot: {
    schema_version: 'opensaddle.project-intelligence-snapshot.v1', snapshot_id: 'pis_1',
    snapshot_digest: 'digest', project_id: 'project/a', version: 2,
    revision: { oid: 'abc123', tree_oid: 'tree123', author_name: 'Ada', authored_at: '2026-08-25T00:00:00Z', subject: 'Ship it' },
    summary: { file_count: 12, total_bytes: 2048, languages: [{ language: 'TypeScript', file_count: 8 }], components: [{ name: 'src', file_count: 8, size_bytes: 1500 }] },
    evidence: [{ evidence_id: 'git-tree:tree123', kind: 'tree', locator: 'tree123' }],
    recent_changes: [{ oid: 'abc123', author_name: 'Ada', authored_at: '2026-08-25T00:00:00Z', subject: 'Ship it' }],
    uncertainties: [{ code: 'business_context_not_connected', severity: 'material', detail: 'No business sources.' }],
    created_at: '2026-08-25T00:01:00Z',
  },
  source_freshness: { observed_at: '2026-08-25T00:02:00Z', current_head_oid: 'abc123', snapshot_revision_oid: 'abc123', status: 'fresh', working_tree_dirty: true, working_tree_change_count: 2 },
} as const

test('maps immutable project intelligence separately from live freshness', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ path: string; method: string; body?: unknown; user: string | null }> = []
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    requests.push({ path: input.toString().replace('http://daemon.test', ''), method: init?.method ?? 'GET', user: headers.get('X-OpenSaddle-User'), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) })
    return json(wire)
  }
  try {
    const client = new RemoteProjectIntelligenceClient('http://daemon.test/', () => 'owner')
    const latest = await client.latest('project/a')
    const created = await client.create('project/a')
    assert.equal(latest?.snapshot.summary.pathGroups[0]?.name, 'src')
    assert.equal(latest?.sourceFreshness.workingTreeChangeCount, 2)
    assert.equal(created.snapshot.snapshotId, 'pis_1')
    assert.deepEqual(requests, [
      { path: '/api/projects/project%2Fa/intelligence-snapshots/latest', method: 'GET', user: 'owner' },
      { path: '/api/projects/project%2Fa/intelligence-snapshots', method: 'POST', user: 'owner', body: { revision: 'HEAD', sources: ['git'], recent_commit_limit: 25 } },
    ])
  } finally { globalThis.fetch = originalFetch }
})

test('treats a missing latest snapshot as empty and surfaces create errors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => init?.method === 'POST'
    ? json({ detail: 'project root is not a Git repository' }, 422)
    : json({ detail: 'not found' }, 404)
  try {
    const client = new RemoteProjectIntelligenceClient('http://daemon.test', () => 'owner')
    assert.equal(await client.latest('project'), null)
    await assert.rejects(client.create('project'), /not a Git repository/)
  } finally { globalThis.fetch = originalFetch }
})
