import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteIntegrationToolClient } from '../src/services/remoteIntegrations.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('maps configured server integrations and executes approved tools', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ path: string; method: string; body?: unknown }> = []
  globalThis.fetch = async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    const method = init?.method ?? 'GET'
    requests.push({
      path,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (path === '/api/integrations/connections') return json({ items: [{
      connection_id: 'github',
      provider: 'github',
      display_name: 'GitHub',
      status: 'connected',
    }] })
    if (path === '/api/integrations/tools') return json({ items: [{
      tool_name: 'github.repos.list',
      adapter_id: 'github',
      connection_id: 'github',
      description: 'List repositories',
      required_scopes: ['repo:read'],
      approval_required: false,
      enabled: true,
    }] })
    if (path === '/api/integrations/invocations') return json({
      invocation_id: 'invocation-1',
      status: 'approved',
    }, 201)
    if (path === '/api/integrations/invocations/invocation-1/execute') return json({
      invocation_id: 'invocation-1',
      status: 'completed',
      result: [{ full_name: 'AkeBoss-tech/opensaddle' }],
    })
    return json({ detail: `Unexpected request: ${method} ${path}` }, 404)
  }

  try {
    const client = new RemoteIntegrationToolClient(
      'http://daemon.test',
      () => 'local-admin',
    )
    assert.deepEqual(await client.list(), [{
      id: 'github',
      name: 'GitHub',
      provider: 'github',
      description: 'GitHub tools brokered by the local OpenSaddle server.',
      scopes: ['repo:read'],
      actions: [{
        id: 'github.repos.list',
        label: 'List repositories',
        write: false,
      }],
      connected: true,
      accountLabel: 'GitHub',
    }])
    assert.deepEqual(await client.connect('github'), { connected: true })
    const result = await client.call({
      toolId: 'github',
      action: 'github.repos.list',
      args: {},
      projectId: 'project',
      agentId: 'agent',
      userId: 'local-admin',
    })
    assert.deepEqual(result, {
      ok: true,
      data: [{ full_name: 'AkeBoss-tech/opensaddle' }],
    })
    assert.equal(requests.some((request) =>
      request.path === '/api/integrations/invocations'
      && request.method === 'POST'
      && (request.body as { tool_name?: string }).tool_name === 'github.repos.list'
    ), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('connected mode reports missing setup instead of simulating OAuth success', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const path = input.toString().replace('http://daemon.test', '')
    if (path === '/api/integrations/connections' || path === '/api/integrations/tools') {
      return json({ items: [] })
    }
    return json({ detail: 'unexpected' }, 404)
  }
  try {
    const client = new RemoteIntegrationToolClient(
      'http://daemon.test',
      () => 'local-admin',
    )
    assert.deepEqual(await client.list(), [])
    await assert.rejects(client.connect('github'), /github is not configured/)
    assert.deepEqual(await client.call({
      toolId: 'github',
      action: 'github.repos.list',
      args: {},
      projectId: 'project',
      userId: 'local-admin',
    }), {
      ok: false,
      error: 'Tool action is not registered: github/github.repos.list',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
