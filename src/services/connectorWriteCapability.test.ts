import assert from 'node:assert/strict'
import test from 'node:test'
import { initServices } from './index'

// PROJECT-AGENT-WRITE-REVIEW-1: the trusted review surface is absent unless Core advertises broker-scoped writes.
test('write review requires exact Core capability and authenticated identity', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let available = false, subject: string | undefined = 'owner'
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname
    if (path === '/api/health') return Response.json({ detail: 'v2 only' }, { status: 503 })
    if (path === '/api/v2/capabilities') return Response.json({ authenticated_subject: subject,
      command_center: { available: true, path: '/api/v2/command-center', schema_version: 'opensaddle.command-center.v1' },
      agent_connector_sessions_v1: { available: true, authority_mode: 'broker_scoped', write_actions_available: available } })
    return Response.json({ detail: 'not found' }, { status: 404 })
  }
  const create = () => initServices({ getGrants: () => [], setGrants: () => {}, currentUserId: 'cached-other',
    getCurrentUserId: () => 'cached-other', connection: { id: 'fixture', name: 'Fixture', mode: 'remote',
      baseUrl: 'https://core.example', token: 'session', allowMockFallback: false } })
  assert.equal((await create()).connectorWriteReview, undefined)
  available = true
  assert.ok((await create()).connectorWriteReview)
  subject = undefined
  assert.equal((await create()).connectorWriteReview, undefined)
})
