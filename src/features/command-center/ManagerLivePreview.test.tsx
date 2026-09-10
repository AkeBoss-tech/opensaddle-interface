import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {ManagerMessageDispatch} from './ManagerMessageDispatch'
import {ManagerConversationsClient,type ManagerConversation,type ManagerMessage} from '../../services/managerConversations'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const conversation={project_id:'P',conversation_id:'mgr_'+'a'.repeat(64),title:'Chat',version:1,scope:{revision:0,project_ids:['P']},created_at:'now',updated_at:'now',provider_execution:false} as ManagerConversation
const message={thread_id:conversation.conversation_id,message_id:'msg_1',sequence:1,role:'user',content:'Task',payload:{manager_scope:conversation.scope,provider_status:'not_started'}} as ManagerMessage
const flush=()=>new Promise(resolve=>setImmediate(resolve))
const wire=(sequence:number,text:string,extra:object={})=>'data: '+JSON.stringify({run_id:'run-live',sequence,type:'worker.output.delta',payload:{worker_id:'worker',lease_epoch:1,output_sequence:sequence,text,verification:'not_assessed',...extra}})+'\n\n'
function fixture(){
 let user='owner'
 let stream!:ReadableStreamDefaultController<Uint8Array>,cancelled=0,requests=0
 const original=globalThis.fetch
 globalThis.fetch=async(input,init)=>{
  const path=String(input)
  if(path.endsWith('/events')){requests++;assert.equal(init?.cache,'no-store');return new Response(new ReadableStream({start(c){stream=c},cancel(){cancelled++}}))}
  if(path.endsWith('/dispatches'))return Response.json({conversation_id:conversation.conversation_id,message_id:message.message_id,items:[{project_id:'P',run_id:'run-live',status:'running'}]})
  throw Error('Unexpected request '+path)
 }
 const client=new ManagerConversationsClient('http://core',()=>user,undefined,{snapshot:async()=>({projectId:'P',members:[],workers:[],sources:[]})},false,'P')
 return {client,changeUser:()=>{user='other'},send:(value:string)=>stream.enqueue(new TextEncoder().encode(value)),close:()=>stream.close(),requests:()=>requests,cancelled:()=>cancelled,restore:()=>{globalThis.fetch=original}}
}
test('mounted conversation renders fenced live text and clears it after stream failure',async()=>{
 const f=fixture();let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><ManagerMessageDispatch client={f.client} identity="owner" conversation={conversation} message={message} name={id=>id} disabled={false} onBusy={()=>{}}/></MemoryRouter>)})
 try{
  await act(async()=>{view.root.findByType('details').props.onToggle({currentTarget:{open:true}});await flush();await flush()})
  assert.equal(f.requests(),1,'active conversation task must subscribe to Core output')
  await act(async()=>{const part=wire(1,'Hello <img src=x>');f.send(part.slice(0,17));f.send(part.slice(17));await flush()})
  assert.equal(view.root.findByType('pre').children.join(''),'Hello <img src=x>')
  assert.equal(view.root.findAllByType('img').length,0)
  await act(async()=>{f.send(wire(2,' world'));await flush()})
  assert.equal(view.root.findByType('pre').children.join(''),'Hello <img src=x> world')
  await act(async()=>{f.send(wire(3,'must not appear',{output_sequence:9}));await flush()})
  assert.equal(view.root.findAllByType('pre').length,0)
  assert.match(JSON.stringify(view.toJSON()),/Live preview unavailable/)
  assert.equal(f.cancelled(),1)
 }finally{await act(async()=>view.unmount());f.restore()}
})
test('closing conversation cancels the real preview reader and drops late chunks',async()=>{
 const f=fixture();let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><ManagerMessageDispatch client={f.client} identity="owner" conversation={conversation} message={message} name={id=>id} disabled={false} onBusy={()=>{}}/></MemoryRouter>)})
 try{
  await act(async()=>{view.root.findByType('details').props.onToggle({currentTarget:{open:true}});await flush();await flush()})
  assert.equal(f.requests(),1)
  await act(async()=>{f.send(wire(1,'Preview'));await flush()})
  await act(async()=>{view.root.findByType('details').props.onToggle({currentTarget:{open:false}});await flush()})
  assert.equal(f.cancelled(),1,'closing the saved message must cancel its live reader')
  assert.equal(view.root.findAllByType('pre').length,0)
 }finally{await act(async()=>view.unmount());f.restore()}
})

test('preview verifies message binding before subscribing and rejects an account change',async()=>{
 const f=fixture();const text:string[]=[];let unavailable=0
 try{
  const wrong=f.client.watchChildOutput(conversation.conversation_id,message.message_id,'P','unbound-run',value=>text.push(value),()=>{unavailable++})
  await flush();assert.equal(f.requests(),0);assert.equal(unavailable,1);wrong()
  const cancel=f.client.watchChildOutput(conversation.conversation_id,message.message_id,'P','run-live',value=>text.push(value),()=>{unavailable++})
  await flush();assert.equal(f.requests(),1)
  f.send(wire(1,'authorized'));await flush();assert.deepEqual(text,['authorized'])
  f.changeUser();f.send(wire(2,'stale account'));await flush()
  assert.deepEqual(text,['authorized']);assert.equal(unavailable,2);assert.equal(f.cancelled(),1);cancel()
 }finally{f.restore()}
})
