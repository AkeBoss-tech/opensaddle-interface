import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteAgentProfileClient } from './remoteAgentProfiles'

// OS-AGENT-BUILDER-001: wire conversion preserves exact scopes, digest, and Run identity.

const digest = 'a'.repeat(64)
const definition = {
  title: 'Repository guide', objective: 'Review a source', instructions: 'Read only.', sourceId: 'src_1',
  harness: 'codex-app-server' as const,
  grants: [{ connector: 'github', action: 'get_repository', argumentEquals: { owner: 'company', repo: 'finance' }, rationale: 'Exact repository' }],
  memorySourceIds: [],
  assumptions: ['The source is current'], evidence: [],
}
const memoryRef = { authority: 'https://memory.example', contract: 'krail.provider.model.v1',
  resource_id: 'review-1', resource_type: 'note', version: 'v1', digest: `sha256:${'b'.repeat(64)}` }
const proposal = (status: 'proposed' | 'published' = 'proposed') => ({
  proposal_id: 'agp_1', project_id: 'P1', definition_digest: digest, status,
  definition: { title: definition.title, objective: definition.objective, instructions: definition.instructions, source_id: definition.sourceId, harness: definition.harness,
    grants: [{ connector: 'github', action: 'get_repository', argument_equals: { owner: 'company', repo: 'finance' }, rationale: 'Exact repository' }], memory_source_ids: [], assumptions: definition.assumptions, evidence: [] },
  memory_bindings: {},
  published_at: status === 'published' ? '2026-09-19T00:00:00Z' : null,
  reviewed_by: status === 'published' ? 'owner' : null,
  participant_id: status === 'published' ? 'ptc_1' : null,
})

test('managed credential identities stay in the exact draft and malformed bindings fail closed', async () => {
  const binding = { connector: 'github', secret_ref: 'token', connection_id: 'mcc_one', display_name: 'Work repository', revision: 2, credential_version: 1 }
  let bindings: unknown = { github: [binding] }
  const client = new RemoteAgentProfileClient('https://core.example', () => 'owner', undefined, async () => Response.json({ schema_version: 'opensaddle.agent-proposal-list.v1', items: [{ ...proposal(), managed_connection_bindings: bindings }] }))
  assert.deepEqual((await client.list('P1'))[0].managedConnectionBindings, { github: [{ connector: 'github', secretRef: 'token', connectionId: 'mcc_one', displayName: 'Work repository', revision: 2, credentialVersion: 1 }] })
  for (const invalid of [{ other: [binding] }, { github: [{ ...binding, revision: true }] }, { github: [binding, binding] }, { github: [{ ...binding, connection_id: '' }] }]) {
    bindings = invalid
    await assert.rejects(client.list('P1'), /credential bindings/)
  }
})

test('agent-profile client keeps definition, review digest, and task admission on canonical v2 routes', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const client = new RemoteAgentProfileClient('https://control.example/', () => 'owner', 'token', async (url, init) => {
    requests.push({ url: String(url), init })
    const path = new URL(String(url)).pathname
    if (path.endsWith('/agent-builder-options')) return Response.json({ schema_version: 'opensaddle.agent-builder-options.v1', project_id: 'P1', execution_available: true, can_review: true,
      research_available: true, research_provider: 'brave_web_search', research_scope: 'web',
      memory_available: true, memory_sources: [{ source_id: 'memory-1', classification: 'personal', source_version: 'v1',
        resource_ref: memoryRef, immutable: true, provider_freshness: 'rechecked_at_packet_create_and_read' }],
      sources: [{ source_id: 'src_1', source_kind: 'git', revision: 'rev-1', snapshot_digest: digest }], harnesses: ['codex-app-server'], connector_actions: [] })
    if (path.endsWith('/participants/ptc_1')) return Response.json({ project_id: 'P1', lifecycle: 'waiting', revision: 3 })
    if (path.endsWith('/agent-proposals') && init?.method !== 'POST') return Response.json({ schema_version: 'opensaddle.agent-proposal-list.v1', items: [proposal()] })
    if (path.endsWith('/agent-proposals')) return Response.json(proposal(), { status: 201 })
    if (path.endsWith('/publish')) return Response.json(proposal('published'))
    return Response.json({ schema_version: 'opensaddle.participant-message.v1', message_id: 'pmsg_1', participant_id: 'ptc_1', project_id: 'P1', run_id: 'run_1', status: 'queued', participant_revision: 0, replayed: false }, { status: 202 })
  })

  const choices = await client.options('P1')
  assert.equal(choices.sources[0].sourceId, 'src_1')
  assert.deepEqual([choices.researchAvailable, choices.researchProvider, choices.researchScope], [true, 'brave_web_search', 'web'])
  assert.deepEqual([choices.memoryAvailable, choices.memorySources[0].resourceRef.digest], [true, `sha256:${'b'.repeat(64)}`])
  assert.deepEqual(await client.participant('ptc_1'), { projectId: 'P1', lifecycle: 'waiting', revision: 3 })
  assert.equal((await client.list('P1'))[0].definition.sourceId, 'src_1')
  await client.propose('P1', definition)
  await client.publish('agp_1', digest)
  const admitted = await client.submitTask('ptc_1', 0, 'Inspect the source', 'same-key', [])
  assert.equal(admitted.runId, 'run_1')
  assert.equal(new Headers(requests[3].init?.headers).get('authorization'), 'Bearer token')
  assert.deepEqual(JSON.parse(String(requests[3].init?.body)), { title: 'Repository guide', objective: 'Review a source', instructions: 'Read only.', source_id: 'src_1', harness: 'codex-app-server', grants: [{ connector: 'github', action: 'get_repository', argument_equals: { owner: 'company', repo: 'finance' }, rationale: 'Exact repository' }], memory_source_ids: [], assumptions: ['The source is current'], evidence: [] })
  assert.deepEqual(JSON.parse(String(requests[4].init?.body)), { expected_digest: digest, acknowledge_assumptions: true })
  assert.equal(new Headers(requests[5].init?.headers).get('idempotency-key'), 'same-key')
  assert.deepEqual(JSON.parse(String(requests[5].init?.body)), { expected_participant_revision: 0, task: 'Inspect the source', authorized_context_source_ids: [] })
})

test('agent-profile client rejects task replies that are not participant-message admissions', async () => {
  const client = new RemoteAgentProfileClient('https://control.example', () => 'owner', undefined, async () => Response.json({ run_id: 'run_1' }))
  await assert.rejects(client.submitTask('ptc_1', 0, 'Inspect', 'key', []), /Agent task response is malformed/)
})

test('EXTERNAL-AGENT-BUILDER-1: client preserves one reviewed external worker across options, proposal and publish',async()=>{
 const sent:unknown[]=[]
 const external={...proposal(),definition:{...proposal().definition,harness:'external-agent-client',external_worker_id:'worker-external'}}
 const client=new RemoteAgentProfileClient('https://control.example',()=> 'owner',undefined,async(url,init)=>{
  const path=new URL(String(url)).pathname
  if(path.endsWith('/agent-builder-options'))return Response.json({schema_version:'opensaddle.agent-builder-options.v1',project_id:'P1',execution_available:true,can_review:true,sources:[{source_id:'src_1',source_kind:'git',revision:'rev-1',snapshot_digest:digest}],harnesses:['external-agent-client'],external_workers:[{worker_id:'worker-external',credential_state:'active'},{worker_id:'worker-revoked',credential_state:'revoked'}],connector_actions:[]})
  if(init?.method==='POST'&&path.endsWith('/agent-proposals')){sent.push(JSON.parse(String(init.body)));return Response.json(external)}
  if(path.endsWith('/publish'))return Response.json({...external,status:'published'})
  return Response.json({schema_version:'opensaddle.agent-proposal-list.v1',items:[external]})
 })
 const options=await client.options('P1')
 assert.deepEqual((options as unknown as {externalWorkers:unknown}).externalWorkers,[{workerId:'worker-external',credentialState:'active'},{workerId:'worker-revoked',credentialState:'revoked'}])
 const definition={...proposal().definition,title:'External reviewer',sourceId:'src_1',harness:'external-agent-client' as const,externalWorkerId:'worker-external',memorySourceIds:[],grants:[]}
 const value=await client.propose('P1',definition)
 assert.equal(value.definition.externalWorkerId,'worker-external')
 assert.equal((sent[0] as Record<string,unknown>).external_worker_id,'worker-external')
 const published=await client.publish(value.proposalId,value.definitionDigest)
 assert.equal(published.definition.externalWorkerId,'worker-external')
})

test('EXTERNAL-AGENT-BUILDER-1: missing worker binding or worker inventory cannot become an external draft',async()=>{
 const optionsClient=new RemoteAgentProfileClient('https://control.example',()=> 'owner',undefined,async()=>Response.json({schema_version:'opensaddle.agent-builder-options.v1',project_id:'P1',execution_available:true,can_review:true,sources:[],harnesses:['external-agent-client'],connector_actions:[]}))
 await assert.rejects(optionsClient.options('P1'),/options response is malformed/)
 const malformed={...proposal(),definition:{...proposal().definition,harness:'external-agent-client'}}
 const listClient=new RemoteAgentProfileClient('https://control.example',()=> 'owner',undefined,async()=>Response.json({schema_version:'opensaddle.agent-proposal-list.v1',items:[malformed]}))
 await assert.rejects(listClient.list('P1'),/external worker binding is malformed/)
 await assert.rejects(listClient.propose('P1',{...definition,harness:'external-agent-client'}),/external worker binding is invalid/)
})

test('externally created proposal retains exact reviewed memory pins and task sends an explicit subset', async () => {
  const requests: RequestInit[] = []
  const pinned = { ...proposal('published'), definition: { ...proposal('published').definition, memory_source_ids: ['memory-1'] },
    memory_bindings: { 'memory-1': { source_record_digest: 'd'.repeat(64), resource_record_digest: 'e'.repeat(64),
      resource_ref: memoryRef, classification: 'personal' } } }
  const client = new RemoteAgentProfileClient('https://control.example', () => 'owner', undefined, async (_url, init) => {
    requests.push(init ?? {})
    return init?.method === 'POST'
      ? Response.json({ schema_version: 'opensaddle.participant-message.v1', message_id: 'pmsg_1', participant_id: 'ptc_1',
        project_id: 'P1', run_id: 'run_1', status: 'queued', participant_revision: 0, replayed: false })
      : Response.json({ schema_version: 'opensaddle.agent-proposal-list.v1', items: [pinned] })
  })
  const returned = (await client.list('P1'))[0]
  assert.deepEqual(returned.definition.memorySourceIds, ['memory-1'])
  assert.equal(returned.memoryBindings['memory-1'].resourceRef.digest, `sha256:${'b'.repeat(64)}`)
  assert.equal(returned.memoryBindings['memory-1'].resourceRecordDigest, 'e'.repeat(64))
  await client.submitTask('ptc_1', 1, 'Review', 'memory-key', ['memory-1'])
  assert.deepEqual(JSON.parse(String(requests[1].body)).authorized_context_source_ids, ['memory-1'])
})

test('proposal client rejects memory IDs whose pinned bindings are absent', async () => {
  const malformed = { ...proposal(), definition: { ...proposal().definition, memory_source_ids: ['hidden-memory'] } }
  const client = new RemoteAgentProfileClient('https://control.example', () => 'owner', undefined,
    async () => Response.json({ schema_version: 'opensaddle.agent-proposal-list.v1', items: [malformed] }))
  await assert.rejects(client.list('P1'), /memory bindings are malformed/)
})

test('online research request uses bounded snake-case intake and treats returned grant-free evidence as a draft', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const client = new RemoteAgentProfileClient('https://control.example', () => 'owner', 'human-token', async (url, init) => {
    requests.push({ url: String(url), init })
    return Response.json({
      schema_version: 'opensaddle.agent-research.v1', status: 'draft_unpublished', adapter: 'brave_web_search',
      checked_at: '2026-09-19T05:00:00Z', review_required: true,
      observations: [{ url: 'https://docs.github.com/en/rest', title: 'GitHub REST', excerpt: 'Read repository metadata',
        query: 'github research', provider: 'brave_web_search', retrieved_from: 'https://api.search.brave.com/res/v1/web/search',
        checked_at: '2026-09-19T05:00:00Z', content_basis: 'search_index_excerpt_unverified_at_page', trust: 'untrusted_external_content' }],
      capability_ideas: [{ connector_id: 'github', name: 'GitHub', status: 'installed_read_action',
        installed_read_actions: [{ action: 'get_repository', title: 'Get repository' }],
        catalog_source_urls: ['https://docs.github.com/en/rest'], selection_basis: 'request_selection', grant_proposed: false }],
      draft_definition: { title: 'Research assistant', objective: 'Review repositories', instructions: 'Verify evidence.',
        source_id: 'src_1', harness: 'codex-app-server', grants: [], assumptions: ['Evidence is unverified'],
        evidence: [{ url: 'https://docs.github.com/en/rest', title: 'GitHub REST', finding: 'Unverified search excerpt' }] },
    })
  })
  const result = await client.research('P1', { objective: 'Review repositories', sourceId: 'src_1', harness: 'codex-app-server',
    queries: ['github research'], candidateConnectorIds: ['github'], resultsPerQuery: 3 })
  assert.equal(requests[0].url, 'https://control.example/api/v2/projects/P1/agent-research')
  assert.equal(new Headers(requests[0].init?.headers).get('authorization'), 'Bearer human-token')
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { objective: 'Review repositories', source_id: 'src_1',
    harness: 'codex-app-server', queries: ['github research'], candidate_connector_ids: ['github'], results_per_query: 3 })
  assert.equal(result.observations[0].contentBasis, 'search_index_excerpt_unverified_at_page')
  assert.equal(result.capabilityIdeas[0].status, 'installed_read_action')
  assert.deepEqual(result.draftDefinition.grants, [])
  assert.deepEqual(result.draftDefinition.memorySourceIds, [])
  assert.equal(result.draftDefinition.evidence.length, 1)
})

test('research client rejects a result that supplies permissions or a different source', async () => {
  const client = new RemoteAgentProfileClient('https://control.example', () => 'owner', undefined, async () => Response.json({
    schema_version: 'opensaddle.agent-research.v1', status: 'draft_unpublished', adapter: 'brave_web_search',
    checked_at: '2026-09-19T05:00:00Z', review_required: true, observations: [], capability_ideas: [],
    draft_definition: { title: 'Unexpected', objective: 'Unexpected', instructions: 'Unexpected', source_id: 'other-source',
      harness: 'codex-app-server', grants: [{ connector: 'github', action: 'write' }], assumptions: ['Unexpected'], evidence: [] },
  }))
  await assert.rejects(client.research('P1', { objective: 'Review repositories', sourceId: 'src_1', harness: 'codex-app-server',
    queries: ['github research'], candidateConnectorIds: [], resultsPerQuery: 3 }), /would widen authority/)
})

test('research client rejects a draft that attempts to add memory access', async () => {
  const client = new RemoteAgentProfileClient('https://control.example', () => 'owner', undefined, async () => Response.json({
    schema_version: 'opensaddle.agent-research.v1', status: 'draft_unpublished', adapter: 'brave_web_search',
    checked_at: '2026-09-19T05:00:00Z', review_required: true, observations: [], capability_ideas: [],
    draft_definition: { title: 'Unexpected', objective: 'Unexpected', instructions: 'Unexpected', source_id: 'src_1',
      harness: 'codex-app-server', grants: [], memory_source_ids: ['memory-1'], assumptions: ['Unverified'], evidence: [] },
  }))
  await assert.rejects(client.research('P1', { objective: 'Review', sourceId: 'src_1', harness: 'codex-app-server',
    queries: ['public'], candidateConnectorIds: [], resultsPerQuery: 3 }), /would widen authority/)
})
