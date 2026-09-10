import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {ManagerMessageDispatch} from './ManagerMessageDispatch'
import type {ManagerConversationsAuthority,ManagerConversation,ManagerMessage,ManagerChildTask} from '../../services/managerConversations'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const conversation={conversation_id:'mgr_'+'a'.repeat(64),title:'Manager',version:1,scope:{revision:0,project_ids:['P']},created_at:'now',updated_at:'now',provider_execution:false} as ManagerConversation
const message={thread_id:conversation.conversation_id,message_id:'msg_1',sequence:1,role:'user',content:'Inspect source',payload:{manager_scope:conversation.scope,provider_status:'not_started'}} as ManagerMessage
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('manager message dispatch requires explicit source and agent and shows the canonical child task',async()=>{
 let calls=0,finish!:(task:ManagerChildTask)=>void,busy=false
 const client={childTasks:true,dispatches:async()=>[],taskOptions:async()=>({projectId:'P',members:[],workers:[],sources:[{sourceId:'src_12345678',label:'Repository'}],nativeAdapters:[{sourceId:'src_12345678',adapterId:'codex-app-server',ready:true}]}),dispatch:async(c:any,m:string,p:string,s:string,a:string)=>{assert.equal(c,conversation);assert.deepEqual([m,p,s,a],['msg_1','P','src_12345678','codex-app-server']);calls++;return new Promise<ManagerChildTask>(resolve=>{finish=resolve})}} as unknown as ManagerConversationsAuthority
 let view!:ReactTestRenderer
 const onBusy=(value:boolean)=>{busy=value}
 await act(async()=>{view=create(<MemoryRouter><ManagerMessageDispatch client={client} identity="owner" conversation={conversation} message={message} name={id=>id} disabled={false} onBusy={onBusy}/></MemoryRouter>)})
 try{
  await act(async()=>{view.root.findByType('details').props.onToggle({currentTarget:{open:true}});await flush()})
  assert.equal(calls,0)
  const button=()=>view.root.findAllByType('button').find(node=>node.children.join('')==='Dispatch saved message')!
  assert.equal(button().props.disabled,true)
  await act(async()=>{view.root.findByType('select').props.onChange({target:{value:'P'}});await flush()})
  await act(async()=>{await flush()})
  await act(async()=>view.root.findAllByType('select')[1].props.onChange({target:{value:'src_12345678'}}))
  assert.equal(button().props.disabled,true)
  await act(async()=>view.root.findAllByType('select')[2].props.onChange({target:{value:'codex-app-server'}}))
  assert.equal(button().props.disabled,false)
  await act(async()=>{button().props.onClick();button().props.onClick();await flush()})
  assert.equal(calls,1);assert.equal(busy,true)
  const closing={open:false};await act(async()=>view.root.findByType('details').props.onToggle({currentTarget:closing}));assert.equal(closing.open,true)
  await act(async()=>{finish({project_id:'P',run_id:'run-one',status:'queued'});await flush()})
  assert.equal(busy,false)
  assert.equal(view.root.findByType('a').props.href,'/project/P/tasks/run-one')
  assert.equal(button().props.disabled,true)
 }finally{await act(async()=>view.unmount())}
})

test('completed manager child output appears under its saved message with exact identity',async()=>{
 const client={childTasks:true,childResults:true,dispatches:async()=>[{project_id:'P',run_id:'run-complete',status:'completed'}],childResult:async(c:string,m:string,p:string,r:string)=>{assert.deepEqual([c,m,p,r],[conversation.conversation_id,message.message_id,'P','run-complete']);return{runId:r,resource:{artifact_id:'artifact',digest:'a'.repeat(64)},text:'Native reply <img src=x>'}}} as unknown as ManagerConversationsAuthority
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><ManagerMessageDispatch client={client} identity="owner" conversation={conversation} message={message} name={id=>id} disabled={false} onBusy={()=>{}}/></MemoryRouter>)})
 try{
  await act(async()=>{view.root.findByType('details').props.onToggle({currentTarget:{open:true}});await flush()})
  await act(async()=>{await flush()})
  assert.equal(view.root.findAllByType('pre')[0]?.children.join(''),'Native reply <img src=x>','completed manager task output must appear in the conversation')
  assert.equal(view.root.findAllByType('img').length,0)
 }finally{await act(async()=>view.unmount())}
})

test('Project context is explicitly opted into and sent only through its advertised client',async t=>{
 const {ManagerConversationsClient}=await import('../../services/managerConversations')
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original})
 const requests:any[]=[];let pendingContext=false
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input));assert.ok(url.pathname.startsWith('/api/v2/projects/P/conversations/'))
  if(url.pathname.endsWith('/dispatches'))return Response.json({conversation_id:conversation.conversation_id,message_id:message.message_id,items:pendingContext?[{project_id:'P',run_id:null,status:'admission_unconfirmed',include_conversation_context:true}]:[]})
  assert.ok(url.pathname.endsWith('/dispatch'));requests.push(JSON.parse(options?.body as string))
  return Response.json({conversation_id:conversation.conversation_id,message_id:message.message_id,project_id:'P',run_id:'run-context',status:'queued',manager_reply_available:false})
 }
 const options={snapshot:async()=>({projectId:'P',members:[],workers:[],sources:[{sourceId:'src_12345678',label:'Repository'}],nativeAdapters:[{sourceId:'src_12345678',adapterId:'codex-app-server' as const,ready:true}]})}
 const client=new ManagerConversationsClient('http://core',()=> 'owner',undefined,options,false,'P',true)
 const fixed={...conversation,project_id:'P'}
 let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 async function mount(){if(view)await act(async()=>view.unmount());await act(async()=>{view=create(<MemoryRouter><ManagerMessageDispatch client={client} identity="owner" conversation={fixed} message={message} name={id=>id} disabled={false} onBusy={()=>{}}/></MemoryRouter>)});await act(async()=>{view.root.findByType('details').props.onToggle({currentTarget:{open:true}});await flush()});await act(async()=>view.root.findAllByType('select')[0].props.onChange({target:{value:'src_12345678'}}));await act(async()=>view.root.findAllByType('select')[1].props.onChange({target:{value:'codex-app-server'}}))}
 const dispatch=()=>view.root.findAllByType('button').find(node=>node.children.includes('Dispatch saved message'))!
 await mount()
 assert.equal(view.root.findAllByType('input').length,1,'Project dispatch must expose the explicit context choice')
 assert.equal(view.root.findByType('input').props.checked,false)
 await act(async()=>{dispatch().props.onClick();await flush()})
 assert.equal(Object.hasOwn(requests[0],'include_conversation_context'),false,'default dispatch must preserve message-only wire format')
 await mount()
 await act(async()=>view.root.findByType('input').props.onChange({target:{checked:true}}))
 assert.match(JSON.stringify(view.toJSON()),/project-visible task/)
 await act(async()=>{dispatch().props.onClick();dispatch().props.onClick();await flush()})
 assert.equal(requests.length,2);assert.equal(requests[1].include_conversation_context,true)
 assert.equal(requests[1].project_id,'P');assert.equal(Object.hasOwn(requests[1],'history'),false,'Core assembles authorized history')
 assert.equal(view.root.findByType('input').props.disabled,true)
 pendingContext=true;await mount()
 assert.equal(view.root.findByType('input').props.checked,true,'reload must restore the reserved context choice')
 assert.equal(view.root.findByType('input').props.disabled,true)
 const unsupported=new ManagerConversationsClient('http://core',()=> 'owner',undefined,options,false,'P')
 await assert.rejects(unsupported.dispatch(fixed,message.message_id,'P','src_12345678','codex-app-server',true),/unavailable/)
 const global=new ManagerConversationsClient('http://core',()=> 'owner',undefined,options,false,undefined,true)
 await assert.rejects(global.dispatch(conversation,message.message_id,'P','src_12345678','codex-app-server',true),/unavailable/)
 assert.equal(requests.length,2)
})
