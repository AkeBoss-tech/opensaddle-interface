import assert from 'node:assert/strict'
import test from 'node:test'
import{createHash}from'node:crypto'
import { RemoteMalleableShellClient } from './remoteMalleableShell'

const reviewDescriptor = { command_id: 'dev.opensaddle.artifact.review', version: 2, descriptor_digest: 'd'.repeat(64), title: 'Review artifact', description: '', effect: 'read' as const, required_actions: ['artifacts:read'], available: { available: true }, input_schema: {}, output_schema: {} }

test('uses exact server artifact identities and the durable invocation endpoints', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; body?: unknown }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/artifacts')) return Response.json({ run_id: 'run-1', artifacts: [{ artifact_id: 'artifact-1', run_id: 'run-1', content_digest: 'sha256:exact' }] })
    if (url.includes('/invocations') && init?.method === 'POST') return Response.json({ invocation_id: 'invocation-1' })
    if (url.includes('/command-invocations/invocation-1')) return Response.json({ invocation_id: 'invocation-1' })
    return Response.json({ items: [{ invocation_id: 'invocation-1' }] })
  }
  try {
    const client = new RemoteMalleableShellClient('https://control.example/', () => 'user-1', 'token-1')
    const [resource] = await client.artifacts('run-1', 'project-1')
    assert.deepEqual(resource, { project_id: 'project-1', run_id: 'run-1', artifact_id: 'artifact-1', digest: 'sha256:exact' })
    await client.invoke(reviewDescriptor, resource!)
    await client.invocations('project-1')
    await client.invocation('invocation-1')
    assert.deepEqual(requests[1]?.body, { resource, input: {}, expected_version: 2, expected_descriptor_digest: 'd'.repeat(64) })
    assert.match(requests[2]!.url, /projects\/project-1\/command-invocations\?limit=50$/)
    assert.match(requests[3]!.url, /command-invocations\/invocation-1$/)
  } finally { globalThis.fetch = originalFetch }
})

test('reads bounded exact artifact bytes and verifies their SHA-256 digest',async()=>{const original=globalThis.fetch;const bytes=new TextEncoder().encode('# Report\nCited source.');const digest=createHash('sha256').update(bytes).digest('hex');let request!:Request;globalThis.fetch=async(input,init)=>{request=new Request(input,init);return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length)}})};try{const resource={project_id:'P1',run_id:'R1',artifact_id:'A1',digest};const content=await new RemoteMalleableShellClient('https://core.example',()=> 'member','token').content(resource);assert.equal(request.url,'https://core.example/api/v2/runs/R1/artifacts/A1/content');assert.equal(request.headers.get('Authorization'),'Bearer token');assert.deepEqual(content,{text:'# Report\nCited source.',mediaType:'application/octet-stream',sizeBytes:bytes.length,digest})}finally{globalThis.fetch=original}})

test('artifact content rejects corruption, unavailable bytes, and oversized bodies',async()=>{const original=globalThis.fetch;const client=new RemoteMalleableShellClient('https://core.example',()=> 'member');const resource={project_id:'P1',run_id:'R1',artifact_id:'A1',digest:'0'.repeat(64)};try{globalThis.fetch=async()=>new Response('changed');await assert.rejects(client.content(resource),/artifact_content_integrity_denied/);globalThis.fetch=async()=>Response.json({detail:{code:'artifact_bytes_unavailable'}},{status:409});await assert.rejects(client.content(resource),/artifact_bytes_unavailable/);globalThis.fetch=async()=>new Response('small',{headers:{'Content-Length':'262145'}});await assert.rejects(client.content(resource),/artifact_content_too_large/)}finally{globalThis.fetch=original}})

test('chunked artifact content cancels before buffering beyond the bound',async()=>{const original=globalThis.fetch;let cancelled=false,pulls=0;const stream=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array(140000));if(pulls===3)controller.close()},cancel(){cancelled=true}},{highWaterMark:0});globalThis.fetch=async()=>new Response(stream);try{await assert.rejects(new RemoteMalleableShellClient('https://core.example',()=> 'member').content({project_id:'P1',run_id:'R1',artifact_id:'A1',digest:'0'.repeat(64)}),/artifact_content_too_large/);assert.equal(cancelled,true);assert.equal(pulls,2)}finally{globalThis.fetch=original}})

test('queued missing-length content is cancelled at the first over-limit read',async()=>{const original=globalThis.fetch;let cancelled=false;const stream=new ReadableStream<Uint8Array>({start(controller){for(let index=0;index<10;index++)controller.enqueue(new Uint8Array(100000));controller.close()},cancel(){cancelled=true}});globalThis.fetch=async()=>new Response(stream);try{await assert.rejects(new RemoteMalleableShellClient('https://core.example',()=> 'member').content({project_id:'P1',run_id:'R1',artifact_id:'A1',digest:'0'.repeat(64)}),/artifact_content_too_large/);assert.equal(cancelled,true)}finally{globalThis.fetch=original}})

test('discovers only the run-scoped connector capabilities returned by Core', async () => {
  const originalFetch = globalThis.fetch
  let requested = ''
  globalThis.fetch = async (input) => { requested = String(input); return Response.json({ run_id: 'run-1', capabilities: [{ connector: 'github', protocol_version: 'opensaddle.connector.v1', status: { state: 'offline', reason: 'executor_offline' }, actions: [] }] }) }
  try {
    const capabilities = await new RemoteMalleableShellClient('https://control.example', () => 'user-1').connectors('run-1')
    assert.match(requested, /\/api\/v2\/runs\/run-1\/connectors$/)
    assert.deepEqual(capabilities[0]?.status, { state: 'offline', reason: 'executor_offline' })
  } finally { globalThis.fetch = originalFetch }
})

test('dispatches a discovered connector action through the exact bounded Core route', async () => {
  const originalFetch = globalThis.fetch
  let request: { url: string; method?: string; body?: unknown } | undefined
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) }
    return Response.json({ result: { full_name: 'AkeBoss-tech/opensaddle' }, receipt: { connector: 'github', action: 'get_repository', request_digest: 'request', response_digest: 'response', credential_lease_id: 'lease' } })
  }
  try {
    const result = await new RemoteMalleableShellClient('https://control.example', () => 'user-1').invokeConnector('run-1', 'github', 'get_repository', { owner: 'AkeBoss-tech', repo: 'opensaddle' })
    assert.deepEqual(request, { url: 'https://control.example/api/v2/runs/run-1/connectors/github/get_repository', method: 'POST', body: { arguments: { owner: 'AkeBoss-tech', repo: 'opensaddle' } } })
    assert.equal(result.receipt.action, 'get_repository')
  } finally { globalThis.fetch = originalFetch }
})

test('binds environment preview and apply to both revision and definition digest', async () => {
  const originalFetch = globalThis.fetch
  const bodies: unknown[] = []
  globalThis.fetch = async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ activatable: true }) }
  const definition = { commands: [{ command_id: 'command-1', version: 1, descriptor_digest: 'sha256:descriptor' }], bindings: ['mod+shift+r'], services: [], packages: [] }
  try {
    const client = new RemoteMalleableShellClient('https://control.example', () => 'user-1')
    await client.preview('project-1', 3, definition, 'Preview', 'sha256:base')
    await client.apply('project-1', 3, definition, 'Apply', 'sha256:base')
    assert.deepEqual(bodies, [
      { expected_revision: 3, base_definition_digest: 'sha256:base', definition, reason: 'Preview' },
      { expected_revision: 3, base_definition_digest: 'sha256:base', definition, reason: 'Apply' },
    ])
  } finally { globalThis.fetch = originalFetch }
})

test('personal application presentation uses authenticated project-scoped CAS routes',async()=>{const original=globalThis.fetch;const requests:Array<{url:string;method?:string;body?:unknown}>=[];globalThis.fetch=async(input,init)=>{requests.push({url:String(input),method:init?.method,body:init?.body?JSON.parse(String(init.body)):undefined});return Response.json({revision:1,project_id:'P/1'})};const client=new RemoteMalleableShellClient('https://core.example',()=> 'member','token');const overrides={instances:{'evidence-main':{density:'compact' as const,presentation:'split' as const}}};try{await client.personalEnvironment('P/1');await client.previewPersonalEnvironment('P/1',0,overrides,'Preview mine');await client.applyPersonalEnvironment('P/1',0,overrides,'Save mine',4,'b'.repeat(64));await client.revertPersonalEnvironment('P/1',1,0,'Restore mine');assert.deepEqual(requests.map(({url,method,body})=>({path:new URL(url).pathname,method:method??'GET',body})),[{path:'/api/v2/projects/P%2F1/environment/personal',method:'GET',body:undefined},{path:'/api/v2/projects/P%2F1/environment/personal/changes/preview',method:'POST',body:{expected_revision:0,overrides,reason:'Preview mine'}},{path:'/api/v2/projects/P%2F1/environment/personal/changes',method:'POST',body:{expected_revision:0,overrides,reason:'Save mine',expected_base_environment_revision:4,base_definition_digest:'b'.repeat(64)}},{path:'/api/v2/projects/P%2F1/environment/personal/reverts',method:'POST',body:{expected_revision:1,target_revision:0,reason:'Restore mine'}}])}finally{globalThis.fetch=original}})

test('personal presentation rejects a cross-project response',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({project_id:'another-project'});try{await assert.rejects(new RemoteMalleableShellClient('https://core.example',()=> 'member').personalEnvironment('P1'),/project mismatch/)}finally{globalThis.fetch=original}})

test('surfaces command API failures without local authority fallback', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ detail: 'descriptor digest replaced' }, { status: 409 })
  try {
    await assert.rejects(new RemoteMalleableShellClient('https://control.example', () => 'user-1').commands(), /descriptor digest replaced/)
  } finally { globalThis.fetch = originalFetch }
})

test('renders structured server validation details instead of object coercion', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ detail: [{ loc: ['body', 'target_revision'], msg: 'must name an existing revision' }] }, { status: 422 })
  try {
    await assert.rejects(new RemoteMalleableShellClient('https://control.example', () => 'user-1').revert('project-1', 1, 0, 'Restore'), /target_revision.*must name an existing revision/)
  } finally { globalThis.fetch = originalFetch }
})
test('application renderer transport preserves exact authenticated package authority',async()=>{
  const original=globalThis.fetch
  const requests:string[]=[]
  globalThis.fetch=async(input)=>{requests.push(String(input));if(String(input).includes('/content?'))return new Response('<p>renderer</p>',{headers:{'Content-Type':'text/html; profile=opensaddle-renderer-fragment.v1; charset=utf-8'}});return Response.json({project_id:'P/1',renderers:[{application_id:'review-evidence',instance_id:'review-main',entry_file:'renderer.html',content_digest:'b'.repeat(64),size:15,media_type:'text/html; profile=opensaddle-renderer-fragment.v1; charset=utf-8',package_ref:{package_id:'package/id',version:'1.0.0',manifest_digest:'a'.repeat(64)},input_schema:{},output_schema:{},state_schema_version:1,sandbox_policy:{scripts:true,network:false,same_origin:false,navigation:false},authority:'core'}]})}
  try{const client=new RemoteMalleableShellClient('https://core.example',()=> 'member','token');const[renderer]=await client.applicationRenderers('P/1');const response=await client.applicationRendererContent('P/1',renderer!);assert.equal(await response.text(),'<p>renderer</p>');const url=new URL(requests[1]!);assert.equal(url.pathname,'/api/v2/projects/P%2F1/application-renderers/review-evidence/content');assert.equal(url.searchParams.get('package_id'),'package/id');assert.equal(url.searchParams.get('manifest_digest'),'a'.repeat(64));assert.equal(url.searchParams.get('content_digest'),'b'.repeat(64))}finally{globalThis.fetch=original}
})
