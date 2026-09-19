import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ManagedConnectionsPanel } from './ManagedConnectionsPanel'
import { ManagedConnectorConnectionsClient } from '../../services/managedConnectorConnections'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const target = { connector: 'repository', secret_ref: 'repository-token', display_name: 'Repository' }
const entry = { ...target, connection_id: 'conn_one', project_id: 'project', status: 'active', revision: 3, credential_version: 1, created_at: '2026-09-19T00:00:00Z', updated_at: '2026-09-19T00:00:00Z' }
const listing = (connections: unknown[] = []) => ({ schema_version: 'opensaddle.connector-connections.v1', project_id: 'project', viewer_role: 'owner', targets: [target], connections })
const flush = () => new Promise(resolve => setImmediate(resolve))
const button = (view: ReactTestRenderer, name: string) => view.root.findAllByType('button').find(node => node.findAllByType('span').some(span => span.children.join('') === name))
const input = (view: ReactTestRenderer, name: string) => view.root.findByProps({ 'aria-label': name })

// MANAGED-CONNECTIONS-UI-1: actual client + mounted form; only the HTTP authority is a fixture.
test('owner stores once, clears secret, and reviews the exact revision before revocation', async t => {
  const writes: { path: string; body: any }[] = []
  let connected = false, revoked = false
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer operator')
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push({ path: url, body })
      if (url.endsWith('/revoke')) { revoked = true; return Response.json({ ...entry, revision: 4, status: 'revoked' }) }
      connected = true; return Response.json(entry)
    }
    return Response.json(listing(connected ? [{ ...entry, status: revoked ? 'revoked' : 'active', revision: revoked ? 4 : 3 }] : []))
  })
  let view!: ReactTestRenderer
  await act(async () => { view = create(<ManagedConnectionsPanel projectId="project" client={new ManagedConnectorConnectionsClient('http://core', () => 'owner', 'operator')} />); await flush() })
  await act(async () => {
    input(view, 'Installed connector').props.onChange({ target: { value: JSON.stringify([target.connector, target.secret_ref]) } })
    input(view, 'Connection name').props.onChange({ target: { value: 'Personal repository' } })
    input(view, 'API key').props.onChange({ target: { value: 'synthetic-secret' } })
  })
  await act(async () => { button(view, 'Store credential')!.props.onClick(); await flush() })
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].body, { ...target, display_name: 'Personal repository', api_key: 'synthetic-secret' })
  assert.equal(JSON.stringify(view.toJSON()).includes('synthetic-secret'), false)
  assert.match(JSON.stringify(view.toJSON()), /Provider account access has not been verified/)
  assert.equal(button(view, 'Revoke connection'), undefined)
  await act(async () => { button(view, 'Review revocation of Repository (repository-token)')!.props.onClick() })
  assert.equal(writes.length, 1)
  await act(async () => { button(view, 'Revoke connection')!.props.onClick(); await flush() })
  assert.deepEqual(writes[1], { path: 'http://core/api/v2/projects/project/connector-connections/conn_one/revoke', body: { expected_revision: 3 } })
  assert.match(JSON.stringify(view.toJSON()), /Revoked/)
  assert.equal(button(view, 'Revoke connection'), undefined)
  await act(async () => view.unmount())
})

test('two credential slots under one connector remain distinguishable during selection and revocation review', async t => {
  const alternate = { ...target, secret_ref: 'billing-token' }
  const second = { ...entry, ...alternate, connection_id: 'conn_two' }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...listing([entry, second]), targets: [target, alternate] }))
  let view!: ReactTestRenderer
  await act(async () => { view = create(<ManagedConnectionsPanel projectId="project" client={new ManagedConnectorConnectionsClient('http://core', () => 'owner')} />); await flush() })
  const choices = input(view, 'Installed connector').findAllByType('option').map(node => node.children.join(' '))
  assert.equal(choices.filter(label => label.includes('repository-token')).length, 1)
  assert.equal(choices.filter(label => label.includes('billing-token')).length, 1)
  assert.match(JSON.stringify(view.toJSON()), /repository-token/)
  assert.match(JSON.stringify(view.toJSON()), /billing-token/)
  await act(async () => { button(view, 'Review revocation of Repository (repository-token)')!.props.onClick() })
  const reviewText = view.root.findByProps({ 'aria-label': 'Review connection revocation' }).findAllByType('code').map(node => node.children.join('')).join(' ')
  assert.match(reviewText, /repository\/repository-token/)
  await act(async () => { button(view, 'Review revocation of Repository (billing-token)')!.props.onClick() })
  const alternateReview = view.root.findByProps({ 'aria-label': 'Review connection revocation' }).findAllByType('code').map(node => node.children.join('')).join(' ')
  assert.match(alternateReview, /repository\/billing-token/)
  await act(async () => view.unmount())
})

test('uncertain creation never echoes provider errors, clears the key and requires a state reload', async t => {
  let writes = 0
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') { writes++; return Response.json({ detail: 'synthetic-secret' }, { status: 500 }) }
    return Response.json(listing())
  })
  let view!: ReactTestRenderer
  await act(async () => { view = create(<ManagedConnectionsPanel projectId="project" client={new ManagedConnectorConnectionsClient('http://core', () => 'owner')} />); await flush() })
  await act(async () => {
    input(view, 'Installed connector').props.onChange({ target: { value: JSON.stringify([target.connector, target.secret_ref]) } })
    input(view, 'Connection name').props.onChange({ target: { value: 'Repository' } })
    input(view, 'API key').props.onChange({ target: { value: 'synthetic-secret' } })
  })
  await act(async () => { button(view, 'Store credential')!.props.onClick(); await flush() })
  assert.equal(writes, 1)
  assert.equal(JSON.stringify(view.toJSON()).includes('synthetic-secret'), false)
  assert.match(JSON.stringify(view.toJSON()), /Reload to check its state/)
  assert.equal(button(view, 'Store credential'), undefined)
  await act(async () => { button(view, 'Reload connections')!.props.onClick(); await flush() })
  assert.equal(input(view, 'API key').props.value, '')
  assert.equal(writes, 1)
  await act(async () => view.unmount())
})

test('offboarding clears metadata and an old Project response cannot populate another Project', async t => {
  let deny = false
  let release!: (value: Response) => void
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (deny) return new Promise<Response>(resolve => { release = resolve })
    return Response.json(listing([entry]))
  })
  const client = new ManagedConnectorConnectionsClient('http://core', () => 'owner')
  let view!: ReactTestRenderer
  await act(async () => { view = create(<ManagedConnectionsPanel projectId="project" client={client} />); await flush() })
  deny = true
  await act(async () => { button(view, 'Reload connections')!.props.onClick(); await flush() })
  assert.equal(button(view, 'Review revocation of Repository (repository-token)'), undefined)
  await act(async () => { release(Response.json({ detail: 'private' }, { status: 403 })); await flush() })
  assert.match(JSON.stringify(view.toJSON()), /Only a current project owner/)
  await act(async () => { button(view, 'Reload connections')!.props.onClick(); await flush() })
  const old = release
  await act(async () => { view.update(<ManagedConnectionsPanel projectId="other" client={client} />); await flush() })
  await act(async () => { old(Response.json(listing([entry]))); await flush() })
  assert.equal(button(view, 'Review revocation of Repository (repository-token)'), undefined)
  await act(async () => { release(Response.json({ ...listing(), project_id: 'other', targets: [] })); await flush() })
  assert.match(JSON.stringify(view.toJSON()), /No installed connectors/)
  await act(async () => view.unmount())
})
