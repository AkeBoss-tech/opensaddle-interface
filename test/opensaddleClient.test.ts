import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenSaddleRuntimeClient } from '../src/services/opensaddleClient.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('sends native reasoning effort and accepts the authoritative estimate route alias', async () => {
  const originalFetch = globalThis.fetch
  let startBody: Record<string, unknown> | undefined
  globalThis.fetch = async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    if (path === '/api/health') {
      assert.equal(new Headers(init?.headers).has('X-OpenSaddle-User'), false)
      return json({ ok: true })
    }
    if (path === '/api/runs' && init?.method === 'POST') {
      startBody = JSON.parse(String(init.body)) as Record<string, unknown>
      return json({
        run_id: 'run-1',
        session_id: 'session-1',
        estimate: {
          model_key: 'gpt',
          model_id: 'gpt-5.6-terra',
          reasoning_effort: 'high',
          harness_key: 'coding',
          provider_key: 'codex',
          runtime_key: 'local',
          reasons: ['Native Codex selection'],
          cost: '$0.18 – $0.42',
        },
      })
    }
    return json({ detail: `unexpected path ${path}` }, 404)
  }

  try {
    const client = new OpenSaddleRuntimeClient('http://daemon.test', undefined, {
      allowFallback: false,
    })
    const started = await client.startRun({
      projectId: 'project-1',
      task: 'Verify native effort',
      providerKey: 'codex',
      modelKey: 'auto',
      modelId: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      harnessKey: 'coding',
      runtimeKey: 'local',
    })

    assert.equal(startBody?.reasoning_effort, 'high')
    assert.equal(started.route?.providerKey, 'codex')
    assert.equal(started.route?.modelId, 'gpt-5.6-terra')
    assert.equal(started.route?.reasoningEffort, 'high')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('adapts the authoritative repository API for the desktop Git panel', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ path: string; method: string; body?: unknown }> = []
  globalThis.fetch = async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    requests.push({
      path,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (path === '/api/repositories' && init?.method === 'POST') {
      return json({ repository_id: 'local-project', root: '/repo' }, 201)
    }
    if (path === '/api/repositories/local-project/status') {
      return json({
        repository: '/repo',
        branch: 'main',
        detached: false,
        head: 'abc123',
        upstream: 'origin/main',
        ahead: 1,
        behind: 0,
        clean: false,
        additions: 4,
        deletions: 2,
        files: [{
          path: 'src/app.ts',
          original_path: 'src/old.ts',
          index: 'M',
          worktree: '.',
          staged: true,
          modified: false,
          untracked: false,
        }],
        diff_files: [{
          path: 'src/app.ts',
          additions: 4,
          deletions: 2,
          binary: false,
        }],
      })
    }
    return json({ detail: `unexpected path ${path}` }, 404)
  }

  try {
    const client = new OpenSaddleRuntimeClient('http://daemon.test', undefined, {
      allowFallback: false,
    })
    const status = await client.gitStatus('local-project', '/repo')

    assert.deepEqual(requests[0], {
      path: '/api/repositories',
      method: 'POST',
      body: { repository_id: 'local-project', root: '/repo' },
    })
    assert.equal(status.branch, 'main')
    assert.equal(status.files[0]?.originalPath, 'src/old.ts')
    assert.equal(status.diffFiles[0]?.additions, 4)
  } finally {
    globalThis.fetch = originalFetch
  }
})
