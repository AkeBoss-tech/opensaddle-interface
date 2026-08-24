import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ControlPlaneV2Client, ControlPlaneV2Error } from './controlPlaneV2Client'

const digest = 'a'.repeat(64)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('ControlPlaneV2Client', () => {
  it('uses authenticated v2 capabilities and project/source/run contracts', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new ControlPlaneV2Client('https://control.example/', {
      getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), init })
        const pathname = new URL(String(url)).pathname
        if (pathname.endsWith('/capabilities')) return json({ api_version: 'v2', durable_runs: true, event_replay: true, authenticated_subject: 'alice', connectors: [] })
        if (pathname.endsWith('/projects')) return json({ project_id: 'project-1', created_by: 'alice', created_at: 'now' }, 201)
        if (pathname.endsWith('/sources')) return json({ source_id: 'src_12345678', project_id: 'project-1', source_kind: 'uploaded_snapshot', revision: 'main', snapshot_digest: digest, created_by: 'alice', created_at: 'now' }, 201)
        return json({ run_id: 'run_1', project_id: 'project-1', source_ref: 'src_12345678', task: 'inspect', requested_by: 'alice', status: 'queued', policy: { policy_id: 'default', policy_version: '1', policy_hash: 'policy', obligations: {} }, cancellation_requested: false, created_at: 'now', updated_at: 'now' }, 201)
      },
    })

    assert.equal((await client.capabilities()).authenticated_subject, 'alice')
    await client.createProject('project-1')
    await client.createSource({ projectId: 'project-1', sourceKind: 'uploaded_snapshot', revision: 'main', snapshotDigest: digest })
    const run = await client.createRun({ projectId: 'project-1', sourceId: 'src_12345678', task: 'inspect' })
    assert.equal(run.source_ref, 'src_12345678')
    assert.equal(new Headers(requests[0].init?.headers).get('authorization'), 'Bearer test-token')
    assert.deepEqual(JSON.parse(String(requests[2].init?.body)), { project_id: 'project-1', source_kind: 'uploaded_snapshot', revision: 'main', snapshot_digest: digest })
    assert.deepEqual(JSON.parse(String(requests[3].init?.body)), { project_id: 'project-1', source_id: 'src_12345678', task: 'inspect' })
  })

  it('replays authenticated run events from the v2 SSE endpoint', async () => {
    let requestUrl = ''
    const client = new ControlPlaneV2Client('https://control.example', {
      fetchImplementation: async (url) => {
        requestUrl = String(url)
        return new Response('id: 4\nevent: run.admitted\ndata: {"event_id":"evt_1","run_id":"run_1","sequence":4,"type":"run.admitted","payload":{},"timestamp":"now"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      },
    })
    const events = []
    for await (const event of client.events('run_1', { afterSequence: 3 })) events.push(event)
    assert.equal(requestUrl, 'https://control.example/api/v2/runs/run_1/events?after_sequence=3')
    assert.deepEqual(events.map((event) => event.sequence), [4])
  })

  it('uses the external-session create, list, and checkpoint endpoints without changing authority', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const session = { session_id: 'ses_1', project_id: 'project-1', harness: 'codex', external_session_id: 'thread-1', transcript_locator: 'file:///transcript', workspace_locator: null, authority_mode: 'hybrid', source_capabilities: { read: true }, checkpoint_digest: null, authority_snapshot: {}, authority_hash: 'hash', created_by: 'alice', created_at: 'now', updated_at: 'now' }
    const client = new ControlPlaneV2Client('https://control.example', {
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), init })
        if (String(url).includes('/projects/')) return json({ project_id: 'project-1', external_sessions: [session] })
        return json(session, 201)
      },
    })
    await client.createExternalSession({ projectId: 'project-1', harness: 'codex', externalSessionId: 'thread-1', transcriptLocator: 'file:///transcript', authorityMode: 'hybrid', sourceCapabilities: { read: true } })
    assert.equal((await client.listExternalSessions('project-1')).length, 1)
    await client.checkpointExternalSession({ sessionId: 'ses_1', checkpointDigest: digest, authorityMode: 'opensaddle_managed' })
    assert.deepEqual(JSON.parse(String(requests[2].init?.body)), { checkpoint_digest: digest, authority_mode: 'opensaddle_managed' })
  })

  it('surfaces an API error without treating the legacy endpoint as a fallback', async () => {
    const client = new ControlPlaneV2Client('https://control.example', {
      fetchImplementation: async () => json({ detail: 'project membership required' }, 403),
    })
    await assert.rejects(client.getRun('run_1'), (error: unknown) => error instanceof ControlPlaneV2Error && error.status === 403 && error.message === 'project membership required')
  })
})
