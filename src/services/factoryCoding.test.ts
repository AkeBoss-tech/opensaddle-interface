import assert from 'node:assert/strict'
import test from 'node:test'
import { FactoryCodingClient } from './factoryCoding'
import { initServices } from './index'

const hex = (digit:string) => digit.repeat(64)
const spec = { schema_version:'opensaddle.coding-task.v1' as const, allowed_paths:['src/widget.ts'], verification_commands:[['npm','test']] }
const blueprint = { contribution_id:'sample/feature',package_id:'sample',package_version:'1.0',manifest_digest:hex('a'),descriptor:{goal_template:'Build {feature}',acceptance_template:['{feature} tests pass']} }
const repoTask = {adapter_id:'codex-app-server',adapter_version:'app-server-v1',adapter_config_digest:hex('b'),allowed_scopes:['repository:read','repository:write'],steps:[{id:'implementation',depends_on:[],required_capabilities:['code.edit','tests.run'],requested_scopes:['repository:read','repository:write']}],execution_profile:{kind:'single_coding_run',coding_task:spec}}
const definition = {factory_id:'factory_one',project_id:'P',version:1,name:'Build widget',blueprint_id:'sample/feature',package_id:'sample',package_version:'1.0',manifest_digest:hex('a'),parameter_defaults:{feature:'widget'},policy:{repo_task:repoTask},blueprint_currently_enabled:true}
const plan = {schema_version:'opensaddle.factory-repo-task-compile.v1',factory_id:'factory_one',factory_version:1,project_id:'P',manifest_digest:hex('a'),resolved_parameters:{feature:'widget'},source_pin:{source_id:'src_123456',revision:'main@abc',snapshot_digest:hex('c')},proposed_goal:{project_id:'P',objective:'Build widget',acceptance_criteria:['widget tests pass']},proposed_run_intent:{project_id:'P',source_id:'src_123456',task:'Build widget',native_adapter_id:'codex-app-server'},launch_profile:{state:'profile_complete_pending_live_admission',adapter_id:'codex-app-server',adapter_version:'app-server-v1',adapter_config_digest:hex('b'),coding_task:spec,requested_scopes_for_policy_review:['repository:read','repository:write']},acceptance_proof_checks:[{criterion_id:'acceptance_1',criterion:'widget tests pass',evidence_required:true,human_acceptance_required:true}],compile_digest:hex('d'),dry_run:true,dispatch_authorized:false}

test('FACTORY-UI-1: paged signed catalog, exact reviewed preview, Goal and one Run intent cross the public client boundary',async t=>{
  const calls:Array<{path:string;body:Record<string,unknown>|undefined}>=[]
  let responseLost=true
  t.mock.method(globalThis,'fetch',async(input:string,init?:RequestInit)=>{
    const url=new URL(input),body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:undefined
    calls.push({path:url.pathname,body})
    if(url.pathname.endsWith('/factory-blueprints'))return Response.json({schema_version:'opensaddle.factory-blueprints.v1',project_id:'P',items:[blueprint],next_offset:null})
    if(url.pathname.endsWith('/factories')&&init?.method==='GET')return Response.json({schema_version:'opensaddle.factory-definitions.v1',project_id:'P',items:[definition],next_offset:null})
    if(url.pathname.endsWith('/compile'))return Response.json(plan)
    if(url.pathname.endsWith('/prepare-goal'))return Response.json({schema_version:'opensaddle.factory-coding-goal-preparation.v1',project_id:'P',factory_id:'factory_one',factory_version:1,compile_digest:hex('d'),preparation_id:'fgprep_abc',goal_id:'goal_abc',goal_version:1,goal_revision:0,goal_status:'ready'})
    if(url.pathname==='/api/v2/runs') { if(responseLost){responseLost=false;throw Error('response lost')}return Response.json({project_id:'P',run_id:'run_one',status:'queued'}) }
    throw Error(`unexpected ${url.pathname}`)
  })
  const stored=new Map<string,string>(),storage={getItem:(key:string)=>stored.get(key)??null,setItem:(key:string,value:string)=>{stored.set(key,value)},removeItem:(key:string)=>{stored.delete(key)}} as Storage
  const client=new FactoryCodingClient('https://core.example',()=> 'owner','fixture','worker_one',{adapter_id:'codex-app-server',adapter_version:'app-server-v1',adapter_config_digest:hex('b')},storage)
  assert.equal((await client.blueprints('P'))[0].goalTemplate,'Build {feature}')
  assert.equal((await client.definitions('P'))[0].blueprintCurrentlyEnabled,true)
  const reviewed=await client.preview('P','factory_one',1,'src_123456',{feature:'widget'})
  assert.equal(reviewed.source.digest,hex('c'))
  assert.deepEqual(reviewed.criteria,[{criterionId:'acceptance_1',criterion:'widget tests pass'}])
  const prepared=await client.prepare(reviewed)
  await assert.rejects(client.launch(reviewed,prepared),/response lost/)
  assert.equal(stored.size,1)
  assert.equal(await client.launch(reviewed,prepared),'run_one')
  const launches=calls.filter(item=>item.path==='/api/v2/runs')
  assert.equal(launches.length,2)
  assert.deepEqual(launches[0].body,launches[1].body)
  assert.equal((launches[0].body?.factory_binding as Record<string,unknown>).compile_digest,hex('d'))
  assert.equal(stored.size,1)
  const reopened=new FactoryCodingClient('https://core.example',()=> 'owner','fixture','worker_one',{adapter_id:'codex-app-server',adapter_version:'app-server-v1',adapter_config_digest:hex('b')},storage)
  assert.equal(await reopened.launch(reviewed,prepared),'run_one')
  assert.deepEqual(calls.filter(item=>item.path==='/api/v2/runs').map(item=>item.body),[launches[0].body,launches[0].body,launches[0].body])
})

test('FACTORY-UI-1: account change while parsing a successful response withholds Factory data',async t=>{
  let actor='owner', release!:()=>void
  t.mock.method(globalThis,'fetch',async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{release=()=>resolve({schema_version:'opensaddle.factory-blueprints.v1',project_id:'P',items:[],next_offset:null})})} as Response))
  const client=new FactoryCodingClient('https://core.example',()=>actor)
  const reading=client.blueprints('P')
  await new Promise(resolve=>setImmediate(resolve))
  actor='another';release()
  await assert.rejects(reading,/account changed/)
})

test('FACTORY-UI-1: wrong-project preview and missing review never dispatch a Run or accept criteria',async t=>{
  let launches=0,accepts=0
  t.mock.method(globalThis,'fetch',async(input:string,init?:RequestInit)=>{
    const path=new URL(input).pathname
    if(path.endsWith('/compile'))return Response.json({...plan,project_id:'another'})
    if(path.endsWith('/factory-acceptance')&&init?.method==='POST'){accepts++;return Response.json({})}
    if(path==='/api/v2/runs'){launches++;return Response.json({})}
    throw Error('unexpected request')
  })
  const client=new FactoryCodingClient('https://core.example',()=> 'owner')
  await assert.rejects(client.preview('P','factory_one',1,'src_123456',{}),/identity/)
  await assert.rejects(client.accept('P','run_one',hex('d'),{projectId:'P',runId:'run_one',artifactId:'art_one',artifactDigest:hex('e'),review:null,checksStatus:'passed',executionStatus:'completed',limitations:[]} as never,[{criterionId:'acceptance_1',criterion:'tests pass'}]),/Accept the exact/)
  assert.equal(launches,0);assert.equal(accepts,0)
})

test('FACTORY-UI-1: Factory appears only for the exact personal coding capability',async t=>{
  let factory:Record<string,unknown>|undefined
  t.mock.method(globalThis,'fetch',async(input:string)=>new URL(input).pathname==='/api/v2/capabilities'
    ? Response.json({authenticated_subject:'owner',coding_tasks:{available:true,selection_field:'coding_task',schema_version:'opensaddle.coding-task.v1',supported_adapter_ids:['codex-app-server'],result_schema_version:'opensaddle.coding-result.v1',review_path_template:'/api/v2/runs/{run_id}/coding-result/review'},factory_single_coding_run_v1:factory})
    : Response.json({}, {status:404}))
  const create=()=>initServices({getGrants:()=>[],setGrants:()=>{},currentUserId:'cached',connection:{id:'fixture',name:'Fixture',mode:'remote',baseUrl:'https://core.example',token:'fixture',allowMockFallback:false}})
  const good={available:true,schema_version:'opensaddle.factory-repo-task-compile.v1',definition_path_template:'/api/v2/projects/{project_id}/factories',blueprint_path_template:'/api/v2/projects/{project_id}/factory-blueprints',exact_definition_path_template:'/api/v2/factories/{factory_id}?version={version}',preview_path_template:'/api/v2/factories/{factory_id}/compile',prepare_goal_path_template:'/api/v2/factories/{factory_id}/prepare-goal',acceptance_path_template:'/api/v2/runs/{run_id}/factory-acceptance',run_selection_field:'factory_binding',goal_preparation_required:true,multi_step_execution:false,configured_worker_id:'worker_one',adapter_binding:{adapter_id:'codex-app-server',adapter_version:'app-server-v1',adapter_config_digest:hex('b')}}
  for(const invalid of [undefined,{...good,available:false},{...good,multi_step_execution:true},{...good,acceptance_path_template:'/unsafe'}, {...good,adapter_binding:{...good.adapter_binding,adapter_id:'claude-code-stream-json'}}]){
    factory=invalid;assert.equal((await create()).factoryCoding,undefined)
  }
  factory=good
  assert.equal((await create()).factoryCoding?.configuredWorkerId,'worker_one')
})
