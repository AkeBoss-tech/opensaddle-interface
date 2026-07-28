import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteWorkflowClient } from '../src/services/remoteWorkflows.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const workflow = {
  workflow_id: 'docs refresh',
  name: 'Refresh documentation',
  status: 'active',
  version: 3,
  concurrency_limit: 2,
  trigger: { type: 'interval', seconds: 3600 },
  task: { kind: 'wiki', project_id: 'project-1' },
  budget_policy: { max_usd: 1 },
  permission_policy: { preset: 'workspace-write' },
  approval_policy: {},
  created_at: '2026-07-28T12:00:00Z',
  updated_at: '2026-07-28T13:00:00Z',
} as const

const execution = {
  execution_id: 'execution/1',
  workflow_id: 'docs refresh',
  workflow_version: 3,
  status: 'queued',
  trigger_key: null,
  trigger_payload: {},
  retry_of_execution_id: null,
  attempt: 1,
  worker_id: null,
  cancellation_reason: null,
  result: null,
  queued_at: '2026-07-28T13:05:00Z',
  started_at: null,
  finished_at: null,
} as const

test('maps authoritative workflows, executions, and timelines', async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = async (input) => {
    const path = input.toString().replace('http://daemon.test', '')
    requests.push(path)
    if (path === '/api/workflows') return json({ workflows: [workflow] })
    if (path === '/api/workflow-executions?workflow_id=docs+refresh&status=queued&status=running&limit=25') {
      return json({ executions: [execution] })
    }
    if (path === '/api/workflow-executions/execution%2F1/timeline') {
      return json({ timeline: [{
        timeline_id: 4,
        event_type: 'execution_queued',
        data: { source: 'manual' },
        recorded_at: '2026-07-28T13:05:00Z',
      }] })
    }
    return json({ detail: `Unexpected request: ${path}` }, 404)
  }

  try {
    const client = new RemoteWorkflowClient('http://daemon.test/', () => 'local-admin', 'token')
    assert.deepEqual(await client.list(), [{
      workflowId: 'docs refresh',
      name: 'Refresh documentation',
      status: 'active',
      version: 3,
      concurrencyLimit: 2,
      trigger: { type: 'interval', seconds: 3600 },
      task: { kind: 'wiki', project_id: 'project-1' },
      budgetPolicy: { max_usd: 1 },
      permissionPolicy: { preset: 'workspace-write' },
      approvalPolicy: {},
      createdAt: Date.parse('2026-07-28T12:00:00Z'),
      updatedAt: Date.parse('2026-07-28T13:00:00Z'),
    }])
    assert.equal((await client.executions({
      workflowId: 'docs refresh',
      statuses: ['queued', 'running'],
      limit: 25,
    }))[0]?.executionId, 'execution/1')
    assert.deepEqual(await client.timeline('execution/1'), [{
      timelineId: 4,
      eventType: 'execution_queued',
      data: { source: 'manual' },
      recordedAt: Date.parse('2026-07-28T13:05:00Z'),
    }])
    assert.equal(requests.length, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sends every lifecycle action to the durable workflow API', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ path: string; method: string; body?: unknown; user?: string }> = []
  globalThis.fetch = async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    requests.push({
      path,
      method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      user: new Headers(init?.headers).get('X-OpenSaddle-User') ?? undefined,
    })
    if (path.endsWith('/pause')) return json({ ...workflow, status: 'paused' })
    if (path.endsWith('/resume')) return json(workflow)
    if (path.endsWith('/trigger') || path.endsWith('/retry')) return json(execution, 201)
    if (path.endsWith('/cancel')) return json({
      ...execution,
      status: 'cancelled',
      cancellation_reason: 'Stop this',
      finished_at: '2026-07-28T13:06:00Z',
    })
    return json({ detail: `Unexpected request: ${path}` }, 404)
  }

  try {
    const client = new RemoteWorkflowClient('http://daemon.test', () => 'local-admin')
    assert.equal((await client.pause('docs refresh')).status, 'paused')
    assert.equal((await client.resume('docs refresh')).status, 'active')
    assert.equal((await client.trigger('docs refresh')).status, 'queued')
    assert.equal((await client.cancel('execution/1', 'Stop this')).status, 'cancelled')
    assert.equal((await client.retry('execution/1')).retryOfExecutionId, undefined)
    assert.deepEqual(requests, [
      { path: '/api/workflows/docs%20refresh/pause', method: 'POST', user: 'local-admin' },
      { path: '/api/workflows/docs%20refresh/resume', method: 'POST', user: 'local-admin' },
      { path: '/api/workflows/docs%20refresh/trigger', method: 'POST', body: { payload: {} }, user: 'local-admin' },
      { path: '/api/workflow-executions/execution%2F1/cancel', method: 'POST', body: { reason: 'Stop this' }, user: 'local-admin' },
      { path: '/api/workflow-executions/execution%2F1/retry', method: 'POST', body: {}, user: 'local-admin' },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('surfaces authoritative workflow API errors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => json({ detail: 'paused workflows cannot queue retries' }, 409)
  try {
    const client = new RemoteWorkflowClient('http://daemon.test', () => 'local-admin')
    await assert.rejects(client.retry('execution-1'), /paused workflows cannot queue retries/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
