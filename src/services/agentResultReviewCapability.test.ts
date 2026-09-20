import assert from 'node:assert/strict'
import test from 'node:test'
import {initServices} from './index'

test('agent result decisions require the exact historical Core capability and authenticated identity',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original})
  let scope='wrong_scope',subject:string|undefined='owner'
  globalThis.fetch=async input=>{
    const path=new URL(String(input)).pathname
    if(path==='/api/health')return Response.json({detail:'v2 only'},{status:503})
    if(path==='/api/v2/capabilities')return Response.json({authenticated_subject:subject,agent_result_review_v1:{available:true,schema_version:'opensaddle.agent-result-review.v1',review_path_template:'/api/v2/runs/{run_id}/agent-result/review',scope}})
    return Response.json({detail:'not found'},{status:404})
  }
  const create=()=>initServices({getGrants:()=>[],setGrants:()=>{},currentUserId:'cached-other',getCurrentUserId:()=> 'cached-other',connection:{id:'fixture',name:'Fixture',mode:'remote',baseUrl:'https://core.example',token:'session',allowMockFallback:false}})
  assert.equal((await create()).agentResultReview,undefined)
  scope='historical_run_result_only'
  assert.ok((await create()).agentResultReview)
  subject=undefined
  assert.equal((await create()).agentResultReview,undefined)
})
