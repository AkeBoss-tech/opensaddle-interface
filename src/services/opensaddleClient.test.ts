// @ts-expect-error Node test types are intentionally not part of the browser app type surface.
import assert from 'node:assert/strict'
// @ts-expect-error Node test types are intentionally not part of the browser app type surface.
import test from 'node:test'
import { DaemonUnavailableError, OpenSaddleRuntimeClient, createHttpDaemonTransport, validateDaemonEndpoint } from './opensaddleClient.ts'

test('daemon endpoint is versioned and rejects unsafe endpoints', () => {
  assert.equal(validateDaemonEndpoint('http://127.0.0.1:8765/'), 'http://127.0.0.1:8765')
  assert.throws(() => validateDaemonEndpoint('http://example.com:8765'))
  assert.throws(() => validateDaemonEndpoint('http://127.0.0.1:8765/?token=secret'))
  assert.throws(() => validateDaemonEndpoint('http://user:pass@127.0.0.1:8765'))
})

test('HTTP transport maps v1 responses and keeps token out of request payload', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const transport = createHttpDaemonTransport('http://127.0.0.1:8765', 'install-secret', async (input, init = {}) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify({ run_id: 'run-1', status: 'accepted' }), { status: 201 })
  })
  const run = await transport.createRun({ agent: { id: 'a' }, project: { id: 'p' }, runner: { id: 'r' }, action: { task: 'x' }, permission: { action: 'execute' } })
  assert.deepEqual(run, { run_id: 'run-1', status: 'accepted' })
  assert.match(String(calls[0].init.headers && (calls[0].init.headers as Record<string, string>).Authorization), /Bearer install-secret/)
  assert.equal(String(calls[0].init.body).includes('install-secret'), false)
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/api/v1/runs')
})

test('daemon unavailable is explicit and never silently becomes local authority', async () => {
  const client = new OpenSaddleRuntimeClient('http://127.0.0.1:8765', undefined, { transport: {
    capabilities: async () => { throw new DaemonUnavailableError() },
    createRun: async () => { throw new DaemonUnavailableError() },
    getRun: async () => { throw new DaemonUnavailableError() },
    cancelRun: async () => { throw new DaemonUnavailableError() },
    listEvents: async () => { throw new DaemonUnavailableError() },
  } })
  await assert.rejects(() => client.startRun({ projectId: 'p', task: 'x' }), DaemonUnavailableError)
})

test('cursor replay maps durable daemon events in order and suppresses duplicates', async () => {
  let calls = 0
  const events = [{ event_id: 'e1', sequence: 1, kind: 'agent.started', payload: {}, created_at: '2026-01-01T00:00:00Z' }, { event_id: 'e2', sequence: 2, kind: 'agent.completed', payload: { ok: true }, created_at: '2026-01-01T00:00:01Z' }]
  const client = new OpenSaddleRuntimeClient('http://127.0.0.1:8765', undefined, { transport: {
    capabilities: async () => ({ service: 'opensaddle-daemon', capabilities: [] }),
    createRun: async () => ({ run_id: 'r', status: 'accepted' }),
    getRun: async () => ({ run_id: 'r', status: calls++ ? 'completed' : 'running' }),
    cancelRun: async () => ({ run_id: 'r', status: 'cancelled' }),
    listEvents: async (_id, after) => after === 0 ? [...events, events[0]] : [],
  } })
  const received: number[] = []
  const stop = client.subscribe('r', (event) => received.push(event.sequence))
  await new Promise((resolve) => setTimeout(resolve, 20))
  stop()
  assert.deepEqual(received, [1, 2])
})
