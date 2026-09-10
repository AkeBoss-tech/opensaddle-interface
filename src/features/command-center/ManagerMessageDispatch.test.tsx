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
