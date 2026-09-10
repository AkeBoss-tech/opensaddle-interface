import assert from 'node:assert/strict'
import test from 'node:test'
import {ManagerConversationsClient} from './managerConversations'
test('manager intent creation cannot submit after account changes',async t=>{
 let user='one',requests=0
 t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('must not submit')})
 const client=new ManagerConversationsClient('http://fixture',()=>user)
 const pending=client.create('Private title',['A']);user='two'
 await assert.rejects(pending,/account changed/)
 assert.equal(requests,0)
})
test('empty conversation pages cannot loop forever on repeated cursors',async t=>{
 let requests=0
 t.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json({items:[],next_cursor:'again'})})
 await assert.rejects(new ManagerConversationsClient('http://fixture',()=> 'one').list(),/page limits/)
 assert.equal(requests,2)
})

test('manager task dispatch sends only saved identity and explicit target selections',async()=>{
 const original=globalThis.fetch;let seen:any
 const id='mgr_'+'c'.repeat(64)
 globalThis.fetch=async(input,init)=>{seen=JSON.parse(String(init?.body));assert.match(String(input),/messages\/msg-one\/dispatch$/);return Response.json({conversation_id:id,message_id:'msg-one',project_id:'P',run_id:'run-one',status:'queued',manager_reply_available:false})}
 try{
  const client=new ManagerConversationsClient('https://core.example',()=> 'owner',undefined,{snapshot:async()=>({projectId:'P',members:[],workers:[]})})
  const value={conversation_id:id,title:'Manager',version:3,scope:{revision:2,project_ids:['P']},created_at:'now',updated_at:'now',provider_execution:false as const}
  const result=await client.dispatch(value,'msg-one','P','src_12345678','codex-app-server')
  assert.deepEqual(seen,{expected_version:3,expected_scope_revision:2,project_id:'P',source_id:'src_12345678',native_adapter_id:'codex-app-server'})
  assert.equal(result.run_id,'run-one')
  await assert.rejects(client.dispatch(value,'msg-one','OTHER','src_12345678','codex-app-server'),/outside/)
 }finally{globalThis.fetch=original}
})
