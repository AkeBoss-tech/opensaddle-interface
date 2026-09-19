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
      authenticated_subject: 'owner',
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

test('PROJECT-RUN-AUDIT-PAGE-1: exact advertised finite capability enables active Run audit without SSE', async () => {
  const original = globalThis.fetch
  let pageReads = 0, streamReads = 0
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname
    if (path === '/api/health') return Response.json({ detail: 'v2 only' }, { status: 404 })
    if (path === '/api/v2/capabilities') return Response.json({ authenticated_subject: 'owner',
      command_center: { available: true, path: '/api/v2/command-center', schema_version: 'opensaddle.command-center.v1' },
      run_event_page_v1: { available: true, schema_version: 'opensaddle.run-event-page.v1',
        path_template: '/api/v2/runs/{run_id}/event-page', max_limit: 200 } })
    if (path.endsWith('/members')) return Response.json({ project_id: 'P', members: [] })
    if (path.endsWith('/event-page')) { pageReads++; return Response.json({ schema_version:'opensaddle.run-event-page.v1',
      run_id:'R',events:[],next_after_sequence:-1,truncated:false }) }
    if (path.endsWith('/events')) { streamReads++; throw Error('active SSE must not be opened') }
    if (path.endsWith('/runs/R')) return Response.json({ run_id:'R',project_id:'P',task:'Inspect',status:'running',
      cancellation_requested:false,requested_by:'owner',policy:{obligations:{}} })
    return Response.json({detail:'not found'},{status:404})
  }
  try {
    const services = await initServices({ currentUserId:'stale',getGrants:()=>[],setGrants:()=>{},
      connection:{id:'fixture',name:'Fixture',mode:'remote',baseUrl:'https://core.example',allowMockFallback:false} })
    const audit = await services.journey!.connectorAudit!('P','R')
    assert.equal(audit.mode,'page')
    assert.equal(audit.complete,false)
    assert.equal(pageReads,1)
    assert.equal(streamReads,0)
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

// AGENT-RESEARCH-UI-1: research availability extends the reviewed builder;
// the optional adapter must not hide the entire agent setup surface.
test('online research capability keeps the reviewed agent builder available', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/v2/capabilities') return Response.json({ capability_mode: 'local',
      authenticated_subject: 'owner',
      agent_builder_v1: { available: true, review_required: true, online_research_available: true,
        schema_version: 'opensaddle.agent-proposal.v1' } })
    return new Response(null, { status: 404 })
  }
  try {
    const services = await initServices({
      currentUserId: 'owner', getGrants: () => [], setGrants: () => {},
      connection: { id: 'research-fixture', name: 'Research fixture', mode: 'remote',
        baseUrl: 'http://localhost:1234', allowMockFallback: false },
    })
    assert.ok(services.agentProfiles, 'reviewed agent setup should remain available when an online adapter is configured')
  } finally { globalThis.fetch = original }
})
