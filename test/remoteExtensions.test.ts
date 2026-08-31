import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteExtensionCatalogClient } from '../src/services/remoteExtensions.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('maps project extension enablement and declarative contributions', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ path: string; user: string | null; authorization: string | null }> = []
  globalThis.fetch = async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    const headers = new Headers(init?.headers)
    requests.push({
      path,
      user: headers.get('X-OpenSaddle-User'),
      authorization: headers.get('Authorization'),
    })
    if (path === '/api/projects/project%2Fa/extensions') {
      return json({ extensions: [{
        project_id: 'project/a', package_id: 'com.example.catalog', version: '1.2.3',
        status: 'enabled', revision: 4, policy_receipt: { authority_granted: false },
      }] })
    }
    if (path === '/api/projects/project%2Fa/extension-contributions?kind=action') {
      return json({ contributions: [{
        kind: 'action', contribution_id: 'com.example.catalog/publish', title: 'Publish report',
        package_id: 'com.example.catalog', package_version: '1.2.3', manifest_digest: 'digest',
        effect: 'write', approval_required: true, required_capabilities: ['sites'],
        descriptor: { input_schema: { type: 'object' } },
      }] })
    }
    return json({ detail: `Unexpected request: ${path}` }, 404)
  }

  try {
    const client = new RemoteExtensionCatalogClient('http://daemon.test/', () => 'owner', 'token')
    assert.deepEqual(await client.projectExtensions('project/a'), [{
      projectId: 'project/a', packageId: 'com.example.catalog', version: '1.2.3',
      status: 'enabled', revision: 4, policyReceipt: { authority_granted: false },
    }])
    assert.deepEqual(await client.contributions('project/a', 'action'), [{
      kind: 'action', contributionId: 'com.example.catalog/publish', title: 'Publish report',
      description: '', packageId: 'com.example.catalog', packageVersion: '1.2.3',
      manifestDigest: 'digest', effect: 'write', approvalRequired: true,
      surfaceKind: undefined,
      requiredCapabilities: ['sites'], descriptor: { input_schema: { type: 'object' } },
    }])
    assert.deepEqual(requests, [
      { path: '/api/projects/project%2Fa/extensions', user: 'owner', authorization: 'Bearer token' },
      { path: '/api/projects/project%2Fa/extension-contributions?kind=action', user: 'owner', authorization: 'Bearer token' },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('surfaces authoritative extension catalog errors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => json({ detail: 'project extension access denied' }, 403)
  try {
    const client = new RemoteExtensionCatalogClient('http://daemon.test', () => 'owner')
    await assert.rejects(client.contributions('project'), /project extension access denied/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
