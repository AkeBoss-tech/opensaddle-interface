import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { ConnectorWriteReviewClient } from '../../services/connectorWriteReview'
import { AuthoritativeRunSurface, type AuthoritativeRunAuthority } from './AuthoritativeRunSurface'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const requestDigest = 'a'.repeat(64), proposalId = `awp_${'b'.repeat(32)}`
const run = { run_id: 'run_1', project_id: 'P', task: 'Publish approved update', status: 'running', cancellation_requested: false, requested_by: 'owner', policy: { obligations: {} } }
const proposal = { proposal_id: proposalId, project_id: 'P', run_id: 'run_1', request_digest: requestDigest,
  connector: 'trusted_publication', action: 'publish_notice', arguments: { title: 'Exact title', body: 'Exact body' },
  participant_id: 'agent_1', on_behalf_of: 'owner', state: 'proposed',
  expires_at: '2099-01-01T00:00:00Z', approved_by: null, receipt: null,
  review_scope: 'exact_connector_write', dispatch_reservation_started: false }
const list = (value = proposal) => ({ schema_version: 'opensaddle.connector-write-proposals.v1', run_id: 'run_1',
  proposals: value.state === 'completed' || value.state === 'revoked' ? [] : [value], truncated: false })
const flush = () => new Promise(resolve => setTimeout(resolve, 25))

// PROJECT-AGENT-WRITE-REVIEW-1: normal task detail requires a human click for one exact digest.
test('Run write review renders exact proposal and submits only the human-reviewed digest', async t => {
  const original = globalThis.fetch
  let posts = 0, state = 'proposed', view: ReactTestRenderer | undefined
  t.after(async () => { if (view) await act(async () => view!.unmount()); globalThis.fetch = original })
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)), path = url.pathname
    assert.equal(new Headers(init?.headers).get('X-OpenSaddle-User'), 'owner')
    if (path.endsWith('/runs/run_1/connector-write-proposals')) return Response.json(list({ ...proposal, state }))
    if (path.endsWith('/approve')) {
      posts++
      assert.equal(init?.method, 'POST')
      assert.deepEqual(JSON.parse(String(init?.body)), { expected_request_digest: requestDigest })
      state = 'approved'
      return Response.json({ ...proposal, state })
    }
    if (path.includes('/connector-write-proposals/')) return Response.json({ ...proposal, state })
    if (path.endsWith('/members')) return Response.json({ project_id: 'P', members: [] })
    if (path.endsWith('/runs/run_1')) return Response.json(run)
    return new Response('{}', { status: 404 })
  }
  const authority: AuthoritativeRunAuthority = { runDetail: async () => ({ runId: 'run_1', projectId: 'P', task: run.task,
    status: run.status, cancellationRequested: false, canCancel: false, codingTask: false }) }
  const client = new ConnectorWriteReviewClient('https://core.example', () => 'owner')
  await act(async () => { view = create(<MemoryRouter><AuthoritativeRunSurface authority={authority} connectorWriteReview={client} projectId="P" runId="run_1" /></MemoryRouter>); await flush() })
  const rendered = JSON.stringify(view!.toJSON())
  assert.match(rendered, /trusted_publication.*publish_notice/)
  assert.match(rendered, /Exact title/)
  assert.match(rendered, /agent_1/)
  assert.match(rendered, new RegExp(requestDigest))
  assert.equal(posts, 0)
  const approve = view!.root.findAllByType('button').find(node => node.children.join('') === 'Approve exact write')!
  await act(async () => { approve.props.onClick(); await flush() })
  assert.equal(posts, 1)
  assert.match(JSON.stringify(view!.toJSON()), /Approved for this exact request/)
  assert.doesNotMatch(JSON.stringify(view!.toJSON()), /Approve exact write/)
  const refresh = () => view!.root.findAllByType('button').find(node => node.children.join('') === 'Check write requests')!
  state = 'dispatching'
  await act(async () => { refresh().props.onClick(); await flush() })
  assert.match(JSON.stringify(view!.toJSON()), /external effect may already have occurred/)
  state = 'effect_unknown'
  await act(async () => { refresh().props.onClick(); await flush() })
  assert.match(JSON.stringify(view!.toJSON()), /Do not assume the effect failed or retry it/)
  state = 'completed'
  await act(async () => { refresh().props.onClick(); await flush() })
  assert.match(JSON.stringify(view!.toJSON()), /Core recorded a completed connector dispatch/)
  assert.equal(posts, 1)
})

// PROJECT-AGENT-WRITE-REVIEW-1: list rows cannot substitute another Run or caller.
test('cross-Run proposal response and caller replacement withhold write arguments and approval', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let subject = 'owner', wrong = true, posts = 0
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/runs/run_1/connector-write-proposals')) return Response.json(list({ ...proposal, run_id: wrong ? 'OTHER' : 'run_1' }))
    if (path.includes('/connector-write-proposals/')) { if (init?.method === 'POST') posts++; return Response.json({ ...proposal, run_id: wrong ? 'OTHER' : 'run_1' }) }
    if (path.endsWith('/runs/run_1')) return Response.json(run)
    return new Response('{}', { status: 404 })
  }
  const client = new ConnectorWriteReviewClient('https://core.example', () => subject)
  await assert.rejects(client.discover('P', 'run_1'), /binding is invalid/)
  await assert.rejects(client.proposal('P', 'run_1', proposalId, requestDigest), /binding is invalid/)
  wrong = false
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/runs/run_1/connector-write-proposals')) { subject = 'replacement'; return Response.json(list()) }
    return Response.json(run)
  }
  await assert.rejects(client.discover('P', 'run_1'), /authority changed/)
  assert.equal(posts, 0)
})

test('PROJECT-MEMBER-REMOVAL-1: a revoked approval is rechecked by exact ID and offers no approval or dispatch action', async t => {
  const original = globalThis.fetch
  let state: 'approved' | 'revoked' = 'approved', posts = 0, view: ReactTestRenderer | undefined
  t.after(async () => { if (view) await act(async () => view!.unmount()); globalThis.fetch = original })
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/runs/run_1/connector-write-proposals')) return Response.json(list({ ...proposal, state }))
    if (path.includes('/connector-write-proposals/')) { if (init?.method === 'POST') posts++; return Response.json({ ...proposal, state }) }
    if (path.endsWith('/runs/run_1')) return Response.json(run)
    return new Response('{}', { status: 404 })
  }
  const client = new ConnectorWriteReviewClient('https://core.example', () => 'owner')
  await act(async () => { view = create(<MemoryRouter><AuthoritativeRunSurface authority={{ runDetail: async () => ({ runId: 'run_1', projectId: 'P', task: run.task, status: 'running', cancellationRequested: false, canCancel: false, codingTask: false }) }} connectorWriteReview={client} projectId="P" runId="run_1" /></MemoryRouter>); await flush() })
  state = 'revoked'
  const refresh = view!.root.findAllByType('button').find(node => node.children.join('') === 'Check write requests')!
  await act(async () => { refresh.props.onClick(); await flush() })
  const rendered = JSON.stringify(view!.toJSON())
  assert.match(rendered, /State:.*revoked.*Approval revoked. A new request and review are required/s)
  assert.doesNotMatch(rendered, /Approve exact write/)
  assert.equal(posts, 0)
})

test('lost approval response never retries POST or claims approved', async t => {
  const original = globalThis.fetch
  let posts = 0, view: ReactTestRenderer | undefined
  t.after(async () => { if (view) await act(async () => view!.unmount()); globalThis.fetch = original })
  globalThis.fetch = async (input, _init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/runs/run_1/connector-write-proposals')) return Response.json(list())
    if (path.endsWith('/approve')) { posts++; throw Error('connection lost after send') }
    if (path.includes('/connector-write-proposals/')) return Response.json(proposal)
    if (path.endsWith('/runs/run_1')) return Response.json(run)
    return new Response('{}', { status: 404 })
  }
  const client = new ConnectorWriteReviewClient('https://core.example', () => 'owner')
  await act(async () => { view = create(<MemoryRouter><AuthoritativeRunSurface authority={{ runDetail: async () => ({ runId: 'run_1', projectId: 'P', task: run.task, status: 'running', cancellationRequested: false, canCancel: false, codingTask: false }) }} connectorWriteReview={client} projectId="P" runId="run_1" /></MemoryRouter>); await flush() })
  const approve = view!.root.findAllByType('button').find(node => node.children.join('') === 'Approve exact write')!
  await act(async () => { approve.props.onClick(); await flush() })
  assert.equal(posts, 1)
  const rendered = JSON.stringify(view!.toJSON())
  assert.match(rendered, /Approval outcome not confirmed/)
  assert.doesNotMatch(rendered, /Approved for this exact request/)
})

test('current Run list reports truncation and rejects malformed or denied review without stale proposals', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let mode: 'truncated' | 'wrong-project' | 'denied' = 'truncated'
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/runs/run_1')) return Response.json(run)
    if (path.endsWith('/runs/run_1/connector-write-proposals')) {
      if (mode === 'denied') return Response.json({ detail: 'not found' }, { status: 404 })
      return Response.json({ ...list({ ...proposal, project_id: mode === 'wrong-project' ? 'OTHER' : 'P' }), truncated: true })
    }
    return new Response('{}', { status: 404 })
  }
  const client = new ConnectorWriteReviewClient('https://core.example', () => 'owner')
  const value = await client.discover('P', 'run_1')
  assert.equal(value.complete, false)
  assert.equal(value.proposals.length, 1)
  mode = 'wrong-project'
  await assert.rejects(client.discover('P', 'run_1'), /binding is invalid/)
  mode = 'denied'
  await assert.rejects(client.discover('P', 'run_1'), /HTTP 404/)
})
