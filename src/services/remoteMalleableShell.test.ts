import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteMalleableShellClient } from './remoteMalleableShell'

const reviewDescriptor = { command_id: 'dev.opensaddle.artifact.review', version: 2, descriptor_digest: 'd'.repeat(64), title: 'Review artifact', description: '', effect: 'read' as const, required_actions: ['artifacts:read'], available: { available: true }, input_schema: {}, output_schema: {} }

test('uses exact server artifact identities and the durable invocation endpoints', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; body?: unknown }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/artifacts')) return Response.json({ run_id: 'run-1', artifacts: [{ artifact_id: 'artifact-1', run_id: 'run-1', content_digest: 'sha256:exact' }] })
    if (url.includes('/invocations') && init?.method === 'POST') return Response.json({ invocation_id: 'invocation-1' })
    if (url.includes('/command-invocations/invocation-1')) return Response.json({ invocation_id: 'invocation-1' })
    return Response.json({ items: [{ invocation_id: 'invocation-1' }] })
  }
  try {
    const client = new RemoteMalleableShellClient('https://control.example/', () => 'user-1', 'token-1')
    const [resource] = await client.artifacts('run-1', 'project-1')
    assert.deepEqual(resource, { project_id: 'project-1', run_id: 'run-1', artifact_id: 'artifact-1', digest: 'sha256:exact' })
    await client.invoke(reviewDescriptor, resource!)
    await client.invocations('project-1')
    await client.invocation('invocation-1')
    assert.deepEqual(requests[1]?.body, { resource, input: {}, expected_version: 2, expected_descriptor_digest: 'd'.repeat(64) })
    assert.match(requests[2]!.url, /projects\/project-1\/command-invocations\?limit=50$/)
    assert.match(requests[3]!.url, /command-invocations\/invocation-1$/)
  } finally { globalThis.fetch = originalFetch }
})

test('discovers only the run-scoped connector capabilities returned by Core', async () => {
  const originalFetch = globalThis.fetch
  let requested = ''
  globalThis.fetch = async (input) => { requested = String(input); return Response.json({ run_id: 'run-1', capabilities: [{ connector: 'github', protocol_version: 'opensaddle.connector.v1', status: { state: 'offline', reason: 'executor_offline' }, actions: [] }] }) }
  try {
    const capabilities = await new RemoteMalleableShellClient('https://control.example', () => 'user-1').connectors('run-1')
    assert.match(requested, /\/api\/v2\/runs\/run-1\/connectors$/)
    assert.deepEqual(capabilities[0]?.status, { state: 'offline', reason: 'executor_offline' })
  } finally { globalThis.fetch = originalFetch }
})

test('dispatches a discovered connector action through the exact bounded Core route', async () => {
  const originalFetch = globalThis.fetch
  let request: { url: string; method?: string; body?: unknown } | undefined
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) }
    return Response.json({ result: { full_name: 'AkeBoss-tech/opensaddle' }, receipt: { connector: 'github', action: 'get_repository', request_digest: 'request', response_digest: 'response', credential_lease_id: 'lease' } })
  }
  try {
    const result = await new RemoteMalleableShellClient('https://control.example', () => 'user-1').invokeConnector('run-1', 'github', 'get_repository', { owner: 'AkeBoss-tech', repo: 'opensaddle' })
    assert.deepEqual(request, { url: 'https://control.example/api/v2/runs/run-1/connectors/github/get_repository', method: 'POST', body: { arguments: { owner: 'AkeBoss-tech', repo: 'opensaddle' } } })
    assert.equal(result.receipt.action, 'get_repository')
  } finally { globalThis.fetch = originalFetch }
})

test('binds environment preview and apply to both revision and definition digest', async () => {
  const originalFetch = globalThis.fetch
  const bodies: unknown[] = []
  globalThis.fetch = async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ activatable: true }) }
  const definition = { commands: [{ command_id: 'command-1', version: 1, descriptor_digest: 'sha256:descriptor' }], bindings: ['mod+shift+r'], services: [], packages: [] }
  try {
    const client = new RemoteMalleableShellClient('https://control.example', () => 'user-1')
    await client.preview('project-1', 3, definition, 'Preview', 'sha256:base')
    await client.apply('project-1', 3, definition, 'Apply', 'sha256:base')
    assert.deepEqual(bodies, [
      { expected_revision: 3, base_definition_digest: 'sha256:base', definition, reason: 'Preview' },
      { expected_revision: 3, base_definition_digest: 'sha256:base', definition, reason: 'Apply' },
    ])
  } finally { globalThis.fetch = originalFetch }
})

test('surfaces command API failures without local authority fallback', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ detail: 'descriptor digest replaced' }, { status: 409 })
  try {
    await assert.rejects(new RemoteMalleableShellClient('https://control.example', () => 'user-1').commands(), /descriptor digest replaced/)
  } finally { globalThis.fetch = originalFetch }
})

test('renders structured server validation details instead of object coercion', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ detail: [{ loc: ['body', 'target_revision'], msg: 'must name an existing revision' }] }, { status: 422 })
  try {
    await assert.rejects(new RemoteMalleableShellClient('https://control.example', () => 'user-1').revert('project-1', 1, 0, 'Restore'), /target_revision.*must name an existing revision/)
  } finally { globalThis.fetch = originalFetch }
})
