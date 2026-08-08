import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenSaddleRuntimeClient } from '../src/services/opensaddleClient.ts'
import type { RuntimeClient } from '../src/services/contracts.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function event(sequence: number) {
  return {
    event_id: `event-${sequence}`,
    session_id: 'session-1',
    run_id: 'run-1',
    sequence,
    timestamp: `2026-07-28T00:00:0${sequence}Z`,
    type: 'agent.output.delta' as const,
    payload: { text: `chunk-${sequence}` },
  }
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

test('reconciles only missing durable events after the delivered cursor', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const snapshotPaths: string[] = []
  let snapshotCount = 0
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
    writable: true,
  })
  globalThis.fetch = async (input) => {
    const path = input.toString().replace('http://daemon.test', '')
    if (path === '/api/health') return json({ ok: true })
    if (path === '/api/runs/run-1/events') {
      return new Response(new ReadableStream())
    }
    if (path.startsWith('/api/runs/run-1?after_sequence=')) {
      snapshotPaths.push(path)
      snapshotCount += 1
      return snapshotCount === 1
        ? json({ status: 'running', events: [event(1), event(2)] })
        : json({ status: 'completed', events: [event(3)] })
    }
    return json({ detail: `unexpected path ${path}` }, 404)
  }

  try {
    const client = new OpenSaddleRuntimeClient('http://daemon.test', undefined, {
      allowFallback: false,
    })
    const received: number[] = []
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for reconciled events')), 2_000)
      const stop = client.subscribe('run-1', (item) => {
        received.push(item.sequence)
        if (item.sequence === 3) {
          clearTimeout(timeout)
          stop()
          resolve()
        }
      })
    })

    assert.deepEqual(received, [1, 2, 3])
    assert.deepEqual(snapshotPaths.slice(0, 2), [
      '/api/runs/run-1?after_sequence=0',
      '/api/runs/run-1?after_sequence=2',
    ])
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window
    } else {
      globalThis.window = originalWindow
    }
  }
})

test('connected mode never falls back to simulated success when unavailable', async () => {
  const originalFetch = globalThis.fetch
  let fallbackStarts = 0
  globalThis.fetch = async () => {
    throw new TypeError('connection refused')
  }
  const fallback = {
    startRun: async () => {
      fallbackStarts += 1
      return { runId: 'mock-run', sessionId: 'mock-session', mode: 'mock' }
    },
  } as unknown as RuntimeClient

  try {
    const client = new OpenSaddleRuntimeClient('http://daemon.test', fallback, { allowFallback: true })
    await assert.rejects(
      client.startRun({ projectId: 'project-1', task: 'must be real' }),
      /control plane unavailable/,
    )
    assert.equal(fallbackStarts, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
