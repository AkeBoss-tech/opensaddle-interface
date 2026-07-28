import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuthoritativeLocalProjectClient,
  UnsupportedAuthoritativeProjectOperationError,
} from '../src/services/authoritativeLocalProjects.ts'
import { AuthoritativeThreadClient } from '../src/services/authoritativeThreads.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

test('adapts Python project-domain files, harnesses, and rescans without using legacy endpoints', async () => {
  const paths: string[] = []
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async (input, init) => {
    const path = typeof input === 'string' ? input.replace('http://daemon.test', '') : input.toString().replace('http://daemon.test', '')
    paths.push(`${init?.method ?? 'GET'} ${path}`)
    if (path === '/api/projects' && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { project_id: 'demo', root: '/work/demo' })
      return json({ project_id: 'demo', root: '/work/demo', created_at: '2026-01-01T00:00:00Z' }, 201)
    }
    if (path === '/api/harnesses' || path === '/api/harnesses?refresh=true') return json({ harnesses: [{
      id: 'claude-code', display_name: 'Claude Code', installed: true, executable_path: '/bin/claude', version: '1.2.3', auth_state: 'authenticated', readiness: 'ready',
      models: [{ id: 'opus', display_name: 'Opus', configured: false, source: 'cli_alias', reasoning_efforts: ['high'] }], capabilities: { streaming: true, tool_support: true, mcp: true, skills: true, reasoning_efforts: ['high'], context_limit: 200_000 },
    }, {
      id: 'cursor', display_name: 'Cursor', installed: true, executable_path: '/bin/cursor', version: '2.0.0', auth_state: 'authenticated', readiness: 'unavailable',
      readiness_reason: 'Cursor is signed in, but this account exposes no CLI models.', models: [],
    }] })
    if (path === '/api/projects/demo') return json({ project_id: 'demo', root: '/work/demo', created_at: '2026-01-01T00:00:00Z' })
    if (path === '/api/projects/demo/files?path=docs') return json({ project_id: 'demo', path: 'docs', items: [{ path: 'docs/guide.md', kind: 'file', size: 4, modified_ns: 1_700_000_000_000_000_000 }] })
    if (path === '/api/projects/demo/file?path=docs%2Fguide.md') return new Response('docs', { headers: { 'X-OpenSaddle-File-Path': 'docs/guide.md' } })
    if (path === '/api/projects/demo/rescan') return json({ project_id: 'demo', discoveries: { instructions: ['AGENTS.md'], skills: ['.codex/skills/review/SKILL.md'], documentation: ['docs/guide.md'], sites: ['sites/docs/config.yml'] } })
    return json({ detail: `unexpected path ${path}` }, 404)
  })

  const harnesses = await client.harnessCapabilities()
  assert.equal(harnesses.harnesses[0]?.id, 'claude')
  assert.equal(harnesses.harnesses[0]?.readiness, 'ready')
  assert.deepEqual(harnesses.harnesses[0]?.models[0], {
    id: 'opus',
    configured: false,
    displayName: 'Opus',
    description: undefined,
    isDefault: undefined,
    source: 'cli_alias',
    reasoningEfforts: ['high'],
    defaultReasoningEffort: undefined,
    inputModalities: undefined,
  })
  assert.equal(harnesses.harnesses[1]?.readiness, 'unavailable')
  assert.equal(
    harnesses.harnesses[1]?.unavailableReason,
    'Cursor is signed in, but this account exposes no CLI models.',
  )
  await client.refreshHarnessCapabilities()
  assert.equal(paths.includes('GET /api/harnesses?refresh=true'), true)

  assert.deepEqual(await client.registerProject('demo', '/work/demo'), { projectId: 'demo', root: '/work/demo' })
  const files = await client.listFiles('demo', { path: 'docs', limit: 1 })
  assert.equal(files.root, '/work/demo')
  assert.deepEqual(files.entries[0], { path: 'docs/guide.md', name: 'guide.md', kind: 'file', size: 4, modifiedAt: 1_700_000_000_000 })

  const read = await client.readFile('demo', 'docs/guide.md')
  assert.equal(read.content, 'docs')
  assert.equal(read.bytes, 4)

  const manifest = await client.rescan('demo')
  assert.deepEqual(manifest.counts, { instruction: 1, skill: 1, agent: 0, documentation: 1, site: 1 })
  assert.equal(paths.some((path) => path.includes('managed-artifact') || path.includes('/search')), false)
})

test('does not simulate unsupported legacy local-project features', async () => {
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async () => json({}))
  await assert.rejects(client.localSessions('codex'), UnsupportedAuthoritativeProjectOperationError)
  await assert.rejects(client.archiveManagedArtifact('demo', '.codex/skills/review/SKILL.md'), UnsupportedAuthoritativeProjectOperationError)
  await assert.rejects(client.searchFiles('demo', 'review'), UnsupportedAuthoritativeProjectOperationError)
})

test('refreshes the authoritative thread version before metadata updates', async () => {
  const originalFetch = globalThis.fetch
  let reads = 0
  const patches: Array<Record<string, unknown>> = []
  globalThis.fetch = async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    if (path === '/api/threads/thread-1' && (!init?.method || init.method === 'GET')) {
      reads += 1
      return json({
        thread_id: 'thread-1',
        title: 'Durable task',
        version: reads === 1 ? 2 : 7,
        archived: false,
        pinned: false,
        metadata: { project_id: 'project-1', owner_id: 'local-admin' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      })
    }
    if (path === '/api/threads/thread-1' && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      patches.push(body)
      return json({
        thread_id: 'thread-1',
        title: 'Durable task',
        version: 8,
        archived: false,
        pinned: false,
        metadata: body.metadata,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:01Z',
      })
    }
    return json({ detail: `unexpected path ${path}` }, 404)
  }
  try {
    const client = new AuthoritativeThreadClient('http://daemon.test', () => 'local-admin')
    await client.get('thread-1')
    await client.update('thread-1', { runConfig: { executionMode: 'project' } })
    assert.equal(reads, 2)
    assert.equal(patches.length, 1)
    assert.equal(patches[0]?.expected_version, 7)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rebases a thread update once when a run appends concurrently', async () => {
  const originalFetch = globalThis.fetch
  let reads = 0
  let patches = 0
  globalThis.fetch = async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    if (path === '/api/threads/thread-2' && (!init?.method || init.method === 'GET')) {
      reads += 1
      return json({
        thread_id: 'thread-2',
        title: 'Concurrent task',
        version: reads === 1 ? 4 : 5,
        archived: false,
        pinned: false,
        metadata: { project_id: 'project-1' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      })
    }
    if (path === '/api/threads/thread-2' && init?.method === 'PATCH') {
      patches += 1
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      if (patches === 1) {
        assert.equal(body.expected_version, 4)
        return json({ detail: 'invalid thread version: expected 4, found 5' }, 409)
      }
      assert.equal(body.expected_version, 5)
      return json({
        thread_id: 'thread-2',
        title: 'Concurrent task',
        version: 6,
        archived: false,
        pinned: false,
        metadata: body.metadata,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:01Z',
      })
    }
    return json({ detail: `unexpected path ${path}` }, 404)
  }
  try {
    const client = new AuthoritativeThreadClient('http://daemon.test', () => 'local-admin')
    const updated = await client.update('thread-2', { pinned: true })
    assert.equal(updated.pinned, false)
    assert.equal(reads, 2)
    assert.equal(patches, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('serializes concurrent metadata updates for one thread', async () => {
  const originalFetch = globalThis.fetch
  let version = 1
  const calls: string[] = []
  globalThis.fetch = async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    if (path !== '/api/threads/thread-3') return json({ detail: 'unexpected path' }, 404)
    if (!init?.method || init.method === 'GET') {
      calls.push(`GET:${version}`)
      return json({
        thread_id: 'thread-3',
        title: 'Queued updates',
        version,
        archived: false,
        pinned: false,
        metadata: { project_id: 'project-1' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      })
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push(`PATCH:${String(body.expected_version)}`)
    assert.equal(body.expected_version, version)
    version += 1
    return json({
      thread_id: 'thread-3',
      title: 'Queued updates',
      version,
      archived: false,
      pinned: Boolean(body.pinned),
      metadata: body.metadata,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:01Z',
    })
  }
  try {
    const client = new AuthoritativeThreadClient('http://daemon.test', () => 'local-admin')
    await Promise.all([
      client.update('thread-3', { pinned: true }),
      client.update('thread-3', { runConfig: { executionMode: 'plan' } }),
    ])
    assert.deepEqual(calls, ['GET:1', 'PATCH:1', 'GET:2', 'PATCH:2'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
