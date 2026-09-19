import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { RemoteJourneyClient } from '../../services/remoteJourney'
import { AuthoritativeRunSurface } from './AuthoritativeRunSurface'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const runId = 'run_exact'
const requestDigest = 'a'.repeat(64)
const responseDigest = 'b'.repeat(64)
const run = { run_id: runId, project_id: 'P', task: 'Inspect public repository', status: 'completed',
  cancellation_requested: false, requested_by: 'owner', policy: { obligations: {} } }
const event = (sequence: number, type: string, payload: Record<string, unknown>) =>
  ({ event_id: `evt_${sequence}`, run_id: runId, sequence, type, payload, timestamp: '2026-09-19T06:00:00Z' })
const auditEvents = [
  event(0, 'agent_connector.requested', { project_id: 'P', connector: 'public_github', action: 'get_repository',
    request_digest: requestDigest, private_arguments: 'DO-NOT-RENDER-ARGS' }),
  event(1, 'agent_connector.completed', { project_id: 'P', receipt: { connector: 'public_github',
    action: 'get_repository', request_digest: requestDigest, response_digest: responseDigest,
    outcome: 'allow', credential_lease_id: 'DO-NOT-RENDER-LEASE', response_body: 'DO-NOT-RENDER-BODY' } }),
]
const stream = (events: unknown[]) => new Response(events.map((value, index) =>
  `id: ${index}\nevent: event\ndata: ${JSON.stringify(value)}\n\n`).join(''),
{ headers: { 'Content-Type': 'text/event-stream' } })
const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

// PROJECT-RUN-AUDIT-UI-1: one exact authorized Run shows only digest-bearing connector events.
test('mounted task shows a bounded digest-only connector audit and clears it on authority loss', async (t) => {
  const original = globalThis.fetch
  let subject = 'owner', eventReads = 0, view: ReactTestRenderer | undefined
  t.after(async () => { if (view) await act(async () => view!.unmount()); globalThis.fetch = original })
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    const reader = new Headers(init?.headers).get('X-OpenSaddle-User')
    if (reader !== 'owner') return new Response('{}', { status: 403 })
    if (path.endsWith('/members')) return Response.json({ project_id: 'P', members: [] })
    if (path.endsWith('/events')) { eventReads++; return stream(auditEvents) }
    if (path.endsWith('/artifacts')) return Response.json({ run_id: runId, artifacts: [] })
    if (path.endsWith(`/${runId}`)) return Response.json(run)
    return new Response('{}', { status: 404 })
  }
  const authority = new RemoteJourneyClient('https://core.example', () => subject)
  await act(async () => { view = create(<MemoryRouter><AuthoritativeRunSurface authority={authority} runId={runId} projectId="P" /></MemoryRouter>); await flush() })
  const inspect = () => view!.root.findAllByType('button').find((node) => node.children.join('') === 'Inspect connector activity')!
  await act(async () => { inspect().props.onClick(); await flush() })
  const rendered = JSON.stringify(view!.toJSON())
  assert.equal(eventReads, 1)
  assert.match(rendered, /public_github.*get_repository/)
  assert.match(rendered, new RegExp(requestDigest))
  assert.match(rendered, new RegExp(responseDigest))
  assert.doesNotMatch(rendered, /DO-NOT-RENDER-ARGS|DO-NOT-RENDER-BODY|DO-NOT-RENDER-LEASE/)
  subject = 'other'
  await act(async () => { inspect().props.onClick(); await flush() })
  assert.doesNotMatch(JSON.stringify(view!.toJSON()), new RegExp(requestDigest))
  assert.match(JSON.stringify(view!.toJSON()), /Connector activity unavailable/)
})

test('event Project substitution and caller replacement reject the audit without returning rows', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let subject = 'owner', substitute = true
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/members')) return Response.json({ project_id: 'P', members: [] })
    if (path.endsWith('/events')) {
      const values = substitute ? [{ ...auditEvents[0], payload: { ...auditEvents[0]!.payload, project_id: 'Q' } }] : auditEvents
      if (!substitute) subject = 'replacement'
      return stream(values)
    }
    assert.equal(new Headers(init?.headers).get('X-OpenSaddle-User'), 'owner')
    return Response.json(run)
  }
  const authority = new RemoteJourneyClient('https://core.example', () => subject)
  await assert.rejects(authority.connectorAudit('P', runId), /Project is invalid/)
  substitute = false
  await assert.rejects(authority.connectorAudit('P', runId), /authority changed/)
})

// PROJECT-RUN-AUDIT-UI-1: revocation/unmount cannot turn an aborted roster read
// into a successful managerless status read or an audit lacking final review.
test('aborted roster checks reject before and after the event stream', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const abortAtRoster of [1, 2]) {
    const controller = new AbortController()
    let rosterReads = 0, eventReads = 0
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/members')) {
        assert.ok(init?.signal instanceof AbortSignal)
        rosterReads++
        if (rosterReads === abortAtRoster) {
          controller.abort()
          throw new DOMException('Aborted', 'AbortError')
        }
        return Response.json({ project_id: 'P', members: [] })
      }
      if (path.endsWith('/events')) { eventReads++; return stream(auditEvents) }
      return Response.json(run)
    }
    const authority = new RemoteJourneyClient('https://core.example', () => 'owner')
    await assert.rejects(authority.connectorAudit('P', runId, controller.signal), { name: 'AbortError' })
    assert.equal(rosterReads, abortAtRoster)
    assert.equal(eventReads, abortAtRoster === 1 ? 0 : 1)
  }
})
