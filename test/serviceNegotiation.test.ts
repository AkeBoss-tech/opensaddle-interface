import assert from 'node:assert/strict'
import test from 'node:test'
import { initServices } from '../src/services/index'

// SERVICE-NEGOTIATION-1: v2 availability does not advertise legacy APIs.
test('v2-only local startup preserves v2 services without probing legacy permissions or runners', async () => {
  const original = globalThis.fetch
  const paths: string[] = []
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    paths.push(path)
    if (path === '/api/v2/capabilities') return Response.json({
      capability_mode: 'local',
      dashboard_layout_v1: { available: true, scope: 'user' },
      command_center: { available: true, path: '/api/v2/command-center', schema_version: 'opensaddle.command-center.v1' },
    })
    return new Response(null, { status: 404 })
  }
  try {
    const services = await initServices({
      currentUserId: 'owner', getGrants: () => [], setGrants: () => {},
      connection: { id: 'test', name: 'Test', mode: 'remote', baseUrl: 'http://localhost:1234', allowMockFallback: false },
    })
    assert.equal(services.controlPlane.connected, true)
    assert.ok(services.commandCenter)
    assert.equal(services.localProjects, undefined, 'v2-only connection must not expose legacy runner discovery')
    assert.deepEqual(paths, ['/api/health', '/api/v2/capabilities'])
  } finally { globalThis.fetch = original }
})

test('legacy health still enables its advertised local project and permission clients', async () => {
  const original = globalThis.fetch
  const paths: string[] = []
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    paths.push(path)
    if (path === '/api/health') return Response.json({ mode: 'local', capabilities: ['permissions', 'local-projects'] })
    if (path === '/api/permissions') return Response.json([])
    if (path === '/api/harness-capabilities') return Response.json({ generatedAt: 'now', harnesses: [] })
    return new Response(null, { status: 404 })
  }
  try {
    const services = await initServices({
      currentUserId: 'owner', getGrants: () => [], setGrants: () => {},
      connection: { id: 'test', name: 'Test', mode: 'remote', baseUrl: 'http://localhost:1234', allowMockFallback: false },
    })
    assert.ok(services.localProjects)
    await services.localProjects.harnessCapabilities()
    assert.ok(paths.includes('/api/permissions'))
    assert.ok(paths.includes('/api/harness-capabilities'))
  } finally { globalThis.fetch = original }
})
