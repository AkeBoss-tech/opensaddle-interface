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

test('manager child result checks exact binding and downloaded text digest',async()=>{
 const original=globalThis.fetch,id='mgr_'+'d'.repeat(64),text='Native answer'
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(value=>value.toString(16).padStart(2,'0')).join('')
 let corrupt=false,fixed:string|undefined
 globalThis.fetch=async(input)=>{assert.equal(new URL(String(input)).pathname,fixed?`/api/v2/projects/P/conversations/${id}/messages/m/result`:`/api/v2/manager/conversations/${id}/messages/m/dispatches/P/result`);return Response.json({conversation_id:id,message_id:'m',project_id:'P',run_id:'R',artifact_id:'a',digest,text:corrupt?'altered':text,result_kind:'native_task_output',verification:'not_assessed'})}
 try{for(fixed of [undefined,'P']){corrupt=false
  const client=new ManagerConversationsClient('https://core.example',()=> 'owner',undefined,{snapshot:async()=>({projectId:'P',members:[],workers:[]})},true,fixed)
  assert.equal((await client.childResult(id,'m','P','R')).text,text)
  await assert.rejects(client.childResult(id,'m','P','other'),/mismatch/)
  corrupt=true;await assert.rejects(client.childResult(id,'m','P','R'),/integrity changed/)
 }}finally{globalThis.fetch=original}
})

test('Project conversation client keeps requests, histories and task results in its fixed Project',async t=>{
 const id='mgr_'+'d'.repeat(64),value={conversation_id:id,project_id:'P',title:'Discussion',version:0,scope:{revision:0,project_ids:['P']},created_at:'now',updated_at:'now',provider_execution:false}
 let wrong=false,requests=0;const calls:any[]=[]
 t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{requests++;const url=new URL(String(input));assert.ok(url.pathname.startsWith('/api/v2/projects/P/conversations'),'Project client must use Project routes');const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push(body);if(url.pathname.endsWith('/messages')){if(body)return Response.json({message:{thread_id:id,content:body.content,role:'user',client_message_id:body.request_id,message_id:'msg_'+body.request_id,payload:{provider_status:'not_started',manager_scope:value.scope}},conversation_version:1,provider_execution:false});return Response.json({items:[{thread_id:id,message_id:'m',sequence:1,role:'user',content:'Saved',payload:{provider_status:'not_started',manager_scope:{revision:0,project_ids:[wrong?'OTHER':'P']}}}],next_cursor:null,conversation_version:0,provider_execution:false})}if(url.pathname.endsWith('/'+id))return Response.json(value);if(body){assert.equal(body.project_ids,undefined);return Response.json(value)}return Response.json({items:[value],next_cursor:null})})
 const client=new ManagerConversationsClient('http://core',()=> 'owner',undefined,undefined,false,'P')
 assert.equal((await client.create('Discussion',['P'])).project_id,'P')
 assert.equal((await client.list())[0].conversation_id,id)
 assert.equal((await client.open(id)).messages[0].content,'Saved')
 await client.append(value as any,'Saved')
 const before=requests
 await assert.rejects(client.create('Wrong',['OTHER']),/scope mismatch/)
 await assert.rejects(client.scope(value as any,['P']),/fixed/)
 await assert.rejects(client.taskOptions('OTHER'),/outside/)
 assert.equal(requests,before)
 wrong=true;await assert.rejects(client.open(id),/message scope mismatch/)
})
