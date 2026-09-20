import assert from 'node:assert/strict'
import test from 'node:test'
import { FactoryExecutionClient } from './factoryExecution'
import { initServices } from './index'
import type { CodingResult } from './codingResultReview'

const h = (c:string) => c.repeat(64)
const a = `run_${'a'.repeat(32)}`, b = `run_${'b'.repeat(32)}`, executionId = `fexec_${'e'.repeat(32)}`
const cursor = {execution_id:executionId,project_id:'P',factory_id:'factory_example',factory_version:1,compile_digest:h('c'),requested_by:'owner',state:'awaiting_a',a_run_id:a,b_run_id:null,a_artifact_id:null,a_artifact_digest:null}
const result = {projectId:'P',runId:a,artifactId:'art_abc',artifactDigest:h('d'),review:{reviewId:`review_${'f'.repeat(32)}`,decision:'accepted'},executionStatus:'completed',checksStatus:'passed',limitations:[],patch:'diff'} as CodingResult
const storage = () => {const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}} as Storage}

test('FACTORY-UI-2: exact cursor and accepted A evidence submit one explicit, retryable B admission',async t=>{
  const bodies:Record<string,unknown>[]=[]
  t.mock.method(globalThis,'fetch',async(input:string,init?:RequestInit)=>{
    const path=new URL(input).pathname
    if(path.endsWith(executionId) && init?.method==='GET')return Response.json(cursor)
    if(path.endsWith('/advance')){bodies.push(JSON.parse(String(init?.body)));return Response.json({...cursor,state:'awaiting_b',b_run_id:b,a_artifact_id:'art_abc',a_artifact_digest:h('d')})}
    throw Error(`unexpected ${path}`)
  })
  const saved=storage(),client=new FactoryExecutionClient('https://core.example',()=> 'owner','fixture',saved)
  const current=await client.read('P',executionId)
  assert.equal(current.aRunId,a)
  assert.equal(current.bRunId,null)
  await assert.rejects(client.advance(current,{...result,review:null}),/Accept the exact/)
  assert.equal(bodies.length,0)
  const advanced=await client.advance(current,result)
  assert.equal(advanced.bRunId,b)
  await new FactoryExecutionClient('https://core.example',()=> 'owner','fixture',saved).advance(current,result)
  assert.deepEqual(bodies[0],bodies[1])
  assert.equal(bodies[0].expected_a_review_id,`review_${'f'.repeat(32)}`)
  await assert.rejects(client.read('other',executionId),/identity/)
})

test('FACTORY-UI-2: B acceptance uses exact Run binding and every fixed criterion',async t=>{
  const payloads:Record<string,unknown>[]=[]
  t.mock.method(globalThis,'fetch',async(input:string,init?:RequestInit)=>{
    const path=new URL(input).pathname
    if(path.endsWith(b))return Response.json({project_id:'P',run_id:b,policy:{obligations:{factory_binding:{execution_scope:'two_step_coding_prepared_goal',factory_id:'factory_example',factory_version:1,compile_digest:h('c'),goal_id:'goal_one',fixed_acceptance_proof_checks:[{criterion_id:'acceptance_1',criterion:'Tests pass',evidence_required:true,human_acceptance_required:true}]}}}})
    if(path.endsWith('/accept')){payloads.push(JSON.parse(String(init?.body)));return Response.json({schema_version:'opensaddle.factory-two-step-acceptance.v1',execution_id:executionId,project_id:'P',run_id:b,compile_digest:h('c'),artifact_id:'art_abc',artifact_digest:h('d'),state:'applied'})}
    throw Error(`unexpected ${path}`)
  })
  const client=new FactoryExecutionClient('https://core.example',()=> 'owner','fixture',storage())
  const current={executionId,projectId:'P',factoryId:'factory_example',factoryVersion:1,compileDigest:h('c'),requestedBy:'owner',state:'awaiting_b' as const,aRunId:a,bRunId:b,aArtifactId:'art_abc',aArtifactDigest:h('d')}
  const binding=await client.binding(current)
  assert.deepEqual(binding.criteria,[{criterionId:'acceptance_1',criterion:'Tests pass'}])
  await client.accept(current,{...result,runId:b},binding.criteria)
  assert.deepEqual(payloads[0].criteria,[{criterion_id:'acceptance_1',decision:'accepted',evidence_artifact_id:'art_abc'}])
})

test('FACTORY-UI-2: two-step execution capability is separate from single-Run launch',async t=>{
  let advertised:Record<string,unknown>|undefined
  t.mock.method(globalThis,'fetch',async(input:string)=>new URL(input).pathname==='/api/v2/capabilities'
    ? Response.json({authenticated_subject:'owner',coding_tasks:{available:true,selection_field:'coding_task',schema_version:'opensaddle.coding-task.v1',supported_adapter_ids:['codex-app-server'],result_schema_version:'opensaddle.coding-result.v1',review_path_template:'/api/v2/runs/{run_id}/coding-result/review'},factory_two_step_coding_execution_v1:advertised})
    : Response.json({}, {status:404}))
  const services=()=>initServices({getGrants:()=>[],setGrants:()=>{},currentUserId:'cached',connection:{id:'fixture',name:'Fixture',mode:'remote',baseUrl:'https://core.example',token:'fixture',allowMockFallback:false}})
  const exact={available:true,create_path:'/api/v2/factory-executions',read_path_template:'/api/v2/factory-executions/{execution_id}',advance_path_template:'/api/v2/factory-executions/{execution_id}/advance',accept_path_template:'/api/v2/factory-executions/{execution_id}/accept',scope:'personal_sqlite_two_codex_steps_one_configured_worker',advance_requires_accepted_a_review:true,automatic_advance:false}
  advertised={...exact,automatic_advance:true}
  assert.equal((await services()).factoryExecution,undefined)
  advertised=exact
  const connected=await services()
  assert.ok(connected.factoryExecution)
  assert.equal(connected.factoryCoding,undefined)
})
