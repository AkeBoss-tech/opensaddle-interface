import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { RegisteredProjectKnowledgeClient } from './registeredProjectKnowledge'
const content = 'Real retained project document\n<script>inert()</script>'
const revision = 'a'.repeat(40), contentDigest = 'sha256:' + createHash('sha256').update(content).digest('hex')
const row = { capture_id:'capture-one',source_id:'source-one',path:'README.md',commit:revision,content_digest:contentDigest,review_id:null,state:'captured' }
const catalog = { schema_version:'opensaddle.registered-git-evidence-list.v1',project_id:'P',initialized:true,repository:{commit:revision},files:[{path:'README.md',commit:revision}],captures:[row],truncated:false }
const inspection = { ...row,schema_version:'opensaddle.registered-git-evidence-inspection.v1',project_id:'P',content_base64:Buffer.from(content).toString('base64'),media_type:'text/plain',semantic_authority:'unreviewed_source_document' }

test('registered project source catalog inspect and review preserve authenticated exact versions', async () => {
  const original = globalThis.fetch, requests: Request[] = []
  globalThis.fetch = async (input, init) => { const request = new Request(input,init); requests.push(request); return Response.json(request.url.endsWith('/inspection') ? inspection : request.method === 'GET' ? catalog : {...row,project_id:'P'}) }
  try {
    const client = new RegisteredProjectKnowledgeClient('https://core.example',()=> 'owner','private')
    const list = await client.list('P'), selected = await client.inspect('P',list.captures[0])
    assert.equal(selected.text,content); assert.equal(selected.state,'captured')
    await client.setup('P','setup-intent'); await client.capture('P',list.documents[0],'capture-intent'); await client.review('P',selected,'review-intent')
    assert.deepEqual(await requests[3].json(),{commit:revision,path:'README.md',capture_id:'capture-intent'})
    assert.deepEqual(await requests[4].json(),{review_id:'review-intent',expected_content_digest:contentDigest})
    assert.ok(requests.every(request=>request.headers.get('Authorization')==='Bearer private'&&request.headers.get('X-OpenSaddle-User')==='owner'))
  } finally { globalThis.fetch = original }
})

test('inspection denies substituted identities tampered bytes and revoked sources', async () => {
  const original = globalThis.fetch, client = new RegisteredProjectKnowledgeClient('https://core.example',()=> 'owner')
  const selected = { captureId:row.capture_id,path:row.path,commit:revision,digest:contentDigest,state:'captured' as const }
  try {
    for (const changed of [{project_id:'Q'},{commit:'b'.repeat(40)},{path:'other.md'},{content_base64:Buffer.from('tampered').toString('base64')},{semantic_authority:'source_document_review'}]) {
      globalThis.fetch = async()=>Response.json({...inspection,...changed})
      await assert.rejects(client.inspect('P',selected), /identity changed|do not match/)
    }
    globalThis.fetch = async()=>Response.json({detail:'revoked'},{status:403})
    await assert.rejects(client.inspect('P',selected), /unavailable \(403\)/)
    globalThis.fetch = async()=>Response.json({...catalog,project_id:'other'})
    await assert.rejects(client.list('P'), /catalog identity/)
  } finally { globalThis.fetch = original }
})

test('availability uses exact source digest and revision, validates response identity and denies stale updates', async () => {
  const original = globalThis.fetch, requests: Request[] = []
  const response = {schema_version:'opensaddle.registered-git-evidence-availability.v1',project_id:'P',capture_id:row.capture_id,source_id:row.source_id,content_digest:contentDigest,state:'withdrawn',revision:4}
  let reply: unknown = response, status = 200
  globalThis.fetch = async(input,init)=>{const request=new Request(input,init);requests.push(request);return Response.json(request.method==='GET'?{...catalog,captures:[{...row,state:'reviewed',availability:{state:'available',revision:3}}]}:reply,{status})}
  try {
    const client = new RegisteredProjectKnowledgeClient('https://core.example',()=> 'owner','private')
    const selected=(await client.list('P')).captures[0]
    assert.equal(selected.state,'reviewed')
    assert.deepEqual(await client.setAvailability('P',selected,'withdrawn'),{state:'withdrawn',revision:4})
    assert.deepEqual(await requests[1].json(),{state:'withdrawn',expected_content_digest:contentDigest,expected_revision:3})
    assert.ok(requests[1].url.endsWith('/captures/capture-one/availability'))
    for(const changed of [{project_id:'other'},{source_id:'other'},{capture_id:'other'},{content_digest:'sha256:'+'0'.repeat(64)},{revision:5},{state:'available'}]) {
      reply={...response,...changed};await assert.rejects(client.setAvailability('P',selected,'withdrawn'),/identity or version/)
    }
    status=409;await assert.rejects(client.setAvailability('P',selected,'withdrawn'),/unavailable \(409\)/)
    status=200;reply=response
    assert.deepEqual(await client.setAvailability('P',selected,'withdrawn'),{state:'withdrawn',revision:4})
  } finally {globalThis.fetch=original}
})

test('withdrawn metadata retains historical review but cannot expose inspected content', async()=>{
  const original=globalThis.fetch, client=new RegisteredProjectKnowledgeClient('https://core.example',()=> 'owner')
  try {
    globalThis.fetch=async()=>Response.json({...catalog,captures:[{...row,state:'reviewed',availability:{state:'withdrawn',revision:1}}]})
    const selected=(await client.list('P')).captures[0]
    assert.equal(selected.state,'reviewed');assert.deepEqual(selected.availability,{state:'withdrawn',revision:1})
    await assert.rejects(client.inspect('P',selected),/withdrawn/)
    globalThis.fetch=async()=>Response.json({...inspection,availability:{state:'withdrawn',revision:1}})
    await assert.rejects(client.inspect('P',{...selected,availability:{state:'available',revision:0}}),/withdrawn/)
    for(const invalid of [{state:'available',revision:-1},{state:'available',revision:1.5},{state:'unknown',revision:1}]) {
      globalThis.fetch=async()=>Response.json({...catalog,captures:[{...row,availability:invalid}]})
      await assert.rejects(client.list('P'),/availability is invalid/)
    }
  } finally {globalThis.fetch=original}
})
