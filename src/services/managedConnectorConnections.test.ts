import assert from 'node:assert/strict'
import test from 'node:test'
import { initServices } from './index'
import { ManagedConnectorConnectionsClient } from './managedConnectorConnections'

test('MANAGED-CONNECTIONS-UI-1: managed connections require the exact capability and authenticated identity', async t => {
  let capability: unknown, subject: string | undefined = 'owner'
  t.mock.method(globalThis, 'fetch', async (input: string) => new URL(input).pathname === '/api/v2/capabilities'
    ? Response.json({ authenticated_subject: subject, managed_connector_connections_v1: capability })
    : Response.json({}, { status: 404 }))
  const create = () => initServices({ getGrants: () => [], setGrants: () => {}, currentUserId: 'cached-other', getCurrentUserId: () => 'cached-other', connection: { id: 'fixture', name: 'Fixture', mode: 'remote', baseUrl: 'https://core.example', token: 'session', allowMockFallback: false } })
  const good = { available: true, scope: 'personal_local_project', path_template: '/api/v2/projects/{project_id}/connector-connections', credential_types: ['api_key'] }
  for (const invalid of [undefined, { ...good, available: false }, { ...good, scope: 'unrestricted' }, { ...good, path_template: '/secrets' }, { ...good, credential_types: ['oauth'] }]) {
    capability = invalid; assert.equal((await create()).managedConnections, undefined)
  }
  capability = good
  assert.equal((await create()).managedConnections?.identity(), 'owner')
  subject = undefined
  assert.equal((await create()).managedConnections, undefined)
})

test('connection response rejects wrong project, stale identity and invalid lists without retaining extra fields', async t => {
  let identity = 'owner', value: unknown = {}
  const client = new ManagedConnectorConnectionsClient('https://core.example', () => identity)
  t.mock.method(globalThis, 'fetch', async () => Response.json(value))
  const row = { connection_id: 'conn_one', project_id: 'p', connector: 'repo', secret_ref: 'key', display_name: 'Repository', status: 'active', revision: 1, credential_version: 1, created_at: 'now', updated_at: 'now', api_key: 'must-not-retain' }
  const list = { schema_version: 'opensaddle.connector-connections.v1', project_id: 'p', viewer_role: 'owner', targets: [], connections: [row] }
  for (const invalid of [{ ...list, project_id: 'other' }, { ...list, viewer_role: 'member' }, { ...list, connections: [{ ...row, project_id: 'other' }] }, { ...list, connections: [row, row] }, { ...list, connections: [{ ...row, revision: true }] }]) {
    value = invalid; await assert.rejects(client.list('p'))
  }
  value = list
  assert.equal(JSON.stringify(await client.list('p')).includes('must-not-retain'), false)
  t.mock.method(globalThis, 'fetch', async () => { identity = 'another'; return Response.json(list) })
  await assert.rejects(client.list('p'), /account changed/)
})
