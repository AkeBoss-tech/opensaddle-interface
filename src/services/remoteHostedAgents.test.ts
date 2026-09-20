import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteHostedAgentClient } from './remoteHostedAgents'

// OS-HOSTED-AGENT-UI-001: public HTTP contract and durable exact task retry.

const d = 'a'.repeat(64)
const definition = { title: 'Source reviewer', objective: 'Review a registered source', instructions: 'Summarize only the assigned source.',
  sourceId: 'src_1', externalWorkerId: 'worker_1', assumptions: ['The registered claim is current.'], evidence: [] }
const wireProposal = (published = false) => ({
  schema_version: 'opensaddle.hosted-agent-proposal.v1', proposal_id: 'agp_1', project_id: 'P1',
  definition: { title: definition.title, objective: definition.objective, instructions: definition.instructions,
    source_id: 'src_1', harness: 'external-agent-client', external_worker_id: 'worker_1',
    grants: [], memory_source_ids: [], assumptions: definition.assumptions, evidence: [] },
  definition_digest: d, source_revision: 'rev-1', source_digest: d,
  external_worker_registered_at: '2026-09-19T00:00:00Z', external_worker_registered_by: 'owner',
  proposed_by: 'member', status: published ? 'published' : 'proposed',
  agent_id: published ? 'hag_1' : null, published_by: published ? 'owner' : null,
  revision: published ? 1 : 0, enabled: published,
})

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

class MemoryLocks {
  private readonly tails = new Map<string, Promise<void>>()
  async request<T>(name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(name) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>(resolve => { release = resolve })
    this.tails.set(name, prior.then(() => tail))
    await prior
    try { return await callback() } finally { release() }
  }
}

test('hosted external agent HTTP flow preserves exact source, worker, human publication, and lifecycle CAS', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = []
  const client = new RemoteHostedAgentClient('https://core.example/', () => 'owner', 'fixture', async (url, init) => {
    const path = new URL(String(url)).pathname
    calls.push({ path, init })
    if (path.endsWith('/sources')) return Response.json({ schema_version: 'opensaddle.source-list.v1', project_id: 'P1',
      items: [{ source_id: 'src_1', source_kind: 'uploaded_snapshot', revision: 'rev-1', snapshot_digest: d }] })
    if (path.endsWith('/workers')) return Response.json({ schema_version: 'project-workers.v1', project_id: 'P1',
      workers: [{ worker_id: 'worker_1', runtime_kind: 'remote_worker', project_ids: ['P1'],
        registered_at: '2026-09-19T00:00:00Z', registered_by: 'owner' }] })
    if (path.endsWith('/members')) return Response.json({ schema_version: 'project-members.v1', project_id: 'P1',
      viewer_subject: 'owner', viewer_can_manage: true })
    if (path.endsWith('/events')) return Response.json({ schema_version: 'opensaddle.hosted-agent-events.v1',
      proposal_id: 'agp_1', items: [{ event_id: 'hae_1', revision: 1, action: 'published', actor: 'owner', recorded_at: '2026-09-19T00:01:00Z' }] })
    if (path.endsWith('/lifecycle')) return Response.json({ ...wireProposal(true), revision: 2, enabled: false })
    if (path.endsWith('/publish')) return Response.json(wireProposal(true))
    if (init?.method === 'POST') return Response.json(wireProposal(), { status: 201 })
    return Response.json({ schema_version: 'opensaddle.hosted-agent-list.v1', project_id: 'P1', items: [wireProposal()] })
  }, new MemoryStorage())

  const options = await client.options('P1')
  assert.deepEqual(options.workers.map(item => item.workerId), ['worker_1'])
  assert.equal(options.sources[0].snapshotDigest, d)
  assert.equal(options.canReview, true)
  assert.equal((await client.list('P1'))[0].status, 'proposed')
  const proposed = await client.propose('P1', definition)
  assert.equal(proposed.sourceRevision, 'rev-1')
  assert.equal(proposed.workerRegisteredBy, 'owner')
  assert.equal((await client.publish('agp_1', d)).agentId, 'hag_1')
  assert.equal((await client.lifecycle('hag_1', 1, false)).revision, 2)
  assert.equal((await client.events('agp_1'))[0].actor, 'owner')
  const proposedBody = JSON.parse(String(calls.find(call => call.path.endsWith('/hosted-agent-proposals') && call.init?.method === 'POST')?.init?.body))
  assert.deepEqual(proposedBody.definition.grants, [])
  assert.deepEqual(proposedBody.definition.memory_source_ids, [])
  assert.equal(proposedBody.definition.external_worker_id, 'worker_1')
  assert.deepEqual(JSON.parse(String(calls.find(call => call.path.endsWith('/publish'))?.init?.body)), { expected_digest: d })
  assert.deepEqual(JSON.parse(String(calls.find(call => call.path.endsWith('/lifecycle'))?.init?.body)), { expected_revision: 1, enabled: false })
})

test('ambiguous task response retains one key across client reload; changed task and account cannot consume it', async () => {
  const storage = new MemoryStorage()
  const locks = new MemoryLocks()
  let subject = 'member'
  let calls = 0
  const keys: string[] = []
  const fetcher: typeof fetch = async (_url, init) => {
    calls++
    keys.push(new Headers(init?.headers).get('idempotency-key') ?? '')
    assert.deepEqual(JSON.parse(String(init?.body)), { expected_agent_revision: 1, task: 'Inspect the source' })
    if (calls === 1) throw Error('response lost after Core admission')
    return Response.json({ schema_version: 'opensaddle.hosted-agent-task.v1', agent_id: 'hag_1',
      task_id: 'hat_1', run_id: 'run_1', replayed: true })
  }
  const first = new RemoteHostedAgentClient('https://core.example', () => subject, undefined, fetcher, storage, locks)
  await assert.rejects(first.submitTask('P1', 'hag_1', 1, 'Inspect the source'), /response lost/)
  assert.equal(calls, 1)
  const retained = first.pendingTask('P1', 'hag_1')!
  assert.match(retained.taskDigest, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify([...storage.values.values()]).includes('Inspect the source'), false)
  await assert.rejects(first.submitTask('P1', 'hag_1', 1, 'Change the source'), /prior hosted task/)
  assert.equal(calls, 1)
  subject = 'other-member'
  await assert.rejects(first.submitTask('P1', 'hag_1', 1, 'Inspect the source'), /account changed/)
  assert.equal(first.pendingTask('P1', 'hag_1')?.key, retained.key)
  const other = new RemoteHostedAgentClient('https://core.example', () => subject, undefined, fetcher, storage, locks)
  assert.equal(other.pendingTask('P1', 'hag_1'), undefined)
  subject = 'member'
  const second = new RemoteHostedAgentClient('https://core.example', () => subject, undefined, fetcher, storage, locks)
  const admitted = await second.submitTask('P1', 'hag_1', 1, 'Inspect the source')
  assert.deepEqual(admitted, { agentId: 'hag_1', taskId: 'hat_1', runId: 'run_1', replayed: true })
  assert.equal(keys[0], keys[1])
  assert.equal(second.pendingTask('P1', 'hag_1')?.confirmed?.runId, 'run_1')
  await assert.rejects(second.submitTask('P1', 'hag_1', 1, 'Another task'), /prior hosted task/)
  await second.discardPendingTask('P1', 'hag_1', retained.key)
  assert.equal(second.pendingTask('P1', 'hag_1'), undefined)
})

test('two windows serialize submission and retain the confirmed key until explicitly set aside', async () => {
  const storage = new MemoryStorage(), locks = new MemoryLocks()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const keys: string[] = []
  const fetcher: typeof fetch = async (_url, init) => {
    keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '')
    if (keys.length === 1) await gate
    return Response.json({ schema_version: 'opensaddle.hosted-agent-task.v1', agent_id: 'hag_1',
      task_id: 'hat_1', run_id: 'run_1', replayed: keys.length > 1 })
  }
  const first = new RemoteHostedAgentClient('https://core.example', () => 'member', undefined, fetcher, storage, locks)
  const second = new RemoteHostedAgentClient('https://core.example', () => 'member', undefined, fetcher, storage, locks)
  const a = first.submitTask('P1', 'hag_1', 1, 'Inspect the source')
  const b = second.submitTask('P1', 'hag_1', 1, 'Inspect the source')
  await Promise.resolve(); await Promise.resolve()
  assert.ok(keys.length <= 1)
  release()
  const admissions = await Promise.all([a, b])
  assert.deepEqual(admissions.map(item => item.runId), ['run_1', 'run_1'])
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  assert.equal(first.pendingTask('P1', 'hag_1')?.confirmed?.runId, 'run_1')
})

test('a delayed admission never deletes or replaces a newer retained intent', async () => {
  const storage = new MemoryStorage(), locks = new MemoryLocks()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered!: () => void
  const sent = new Promise<void>(resolve => { entered = resolve })
  const client = new RemoteHostedAgentClient('https://core.example', () => 'member', undefined, async () => {
    entered()
    await gate
    return Response.json({ schema_version: 'opensaddle.hosted-agent-task.v1', agent_id: 'hag_1',
      task_id: 'hat_1', run_id: 'run_1', replayed: false })
  }, storage, locks)
  const admission = client.submitTask('P1', 'hag_1', 1, 'Inspect the source')
  await sent
  const [key, previous] = [...storage.values.entries()][0]
  const newer = { ...JSON.parse(previous), key: 'newer-key' }
  storage.setItem(key, JSON.stringify(newer))
  release()
  assert.equal((await admission).runId, 'run_1')
  assert.equal(client.pendingTask('P1', 'hag_1')?.key, 'newer-key')
  assert.equal(client.pendingTask('P1', 'hag_1')?.confirmed, undefined)
})

test('malformed hosted proposal or widened grants fail before display or publication', async () => {
  const storage = new MemoryStorage()
  let malformed: unknown = { ...wireProposal(), definition: { ...wireProposal().definition,
    grants: [{ connector: 'github', action: 'get_repository' }] } }
  const client = new RemoteHostedAgentClient('https://core.example', () => 'owner', undefined,
    async () => Response.json({ schema_version: 'opensaddle.hosted-agent-list.v1', project_id: 'P1', items: [malformed] }), storage)
  await assert.rejects(client.list('P1'), /widen authority/)
  malformed = { ...wireProposal(), project_id: 'P2' }
  await assert.rejects(client.list('P1'), /Project changed/)
})
