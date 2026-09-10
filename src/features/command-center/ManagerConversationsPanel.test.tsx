import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {ManagerConversationsPanel} from './ManagerConversationsPanel'
import type {ManagerConversation,ManagerConversationsAuthority,ManagerMessage} from '../../services/managerConversations'
;(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
// MANAGER-CONVERSATION-UI-1: durable messages are distinct from provider execution.
test('manager conversation UI retains a failed draft and applies scope only explicitly',async t=>{
 const id='mgr_'+'a'.repeat(64)
 let conversation:ManagerConversation={conversation_id:id,title:'Manager conversation',version:0,scope:{project_ids:['A'],revision:0},created_at:'2026-09-10',updated_at:'2026-09-10',provider_execution:false},messages:ManagerMessage[]=[],fail=true
 const client:ManagerConversationsAuthority={list:async()=>[],create:async(_title,ids)=>{assert.deepEqual(ids,['A']);return conversation},open:async()=>({conversation,messages}),append:async(value,content)=>{assert.equal(value.version,conversation.version);if(fail)throw Error('Uncertain response. Your draft is preserved.');messages=[{message_id:'m',thread_id:id,sequence:1,role:'user',content,payload:{manager_scope:value.scope,provider_status:'not_started'}}];conversation={...conversation,version:1}},scope:async(value,ids)=>{assert.equal(value.version,1);conversation={...conversation,version:2,scope:{revision:1,project_ids:ids}}}}
 let view!:ReactTestRenderer
 t.after(async()=>{if(view)await act(async()=>view.unmount())})
 const render=(projects:string[],identity='one')=><ManagerConversationsPanel client={client} identity={identity} projectIds={projects} name={id=>id}/>
 const button=(label:string)=>view.root.findAllByType('button').find(node=>node.children.join('')===label)!
 await act(async()=>{view=create(render(['A']))})
 await act(async()=>button('New conversation with selected Projects').props.onClick())
 assert.match(JSON.stringify(view.toJSON()),/No agent is connected/)
 await act(async()=>view.root.findByType('textarea').props.onChange({target:{value:'Keep this draft'}}))
 await act(async()=>button('Save message').props.onClick())
 assert.equal(view.root.findByType('textarea').props.value,'Keep this draft')
 assert.match(JSON.stringify(view.toJSON()),/draft is preserved/)
 await act(async()=>button('Reload conversation').props.onClick())
 fail=false
 await act(async()=>button('Save message').props.onClick())
 assert.equal(view.root.findByType('textarea').props.value,'')
 assert.match(JSON.stringify(view.toJSON()),/Message saved. No provider execution/)
 await act(async()=>view.update(render(['B'])))
 assert.deepEqual(conversation.scope.project_ids,['A'])
 await act(async()=>button('Apply selected Projects to future messages').props.onClick())
 assert.deepEqual(conversation.scope.project_ids,['B'])
 assert.deepEqual(messages[0].payload.manager_scope.project_ids,['A'])
 await act(async()=>view.update(render(['B'],'two')))
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Keep this draft/)
})

test('saved manager messages expose explicit child-task controls only when supported',async t=>{
 const id='mgr_'+'b'.repeat(64),scope={project_ids:['P'],revision:0}
 const conversation:ManagerConversation={conversation_id:id,title:'Dispatch manager',version:1,scope,created_at:'now',updated_at:'now',provider_execution:false}
 const message:ManagerMessage={message_id:'msg-one',thread_id:id,sequence:1,role:'user',content:'Inspect source',payload:{manager_scope:scope,provider_status:'not_started'}}
 const client={childTasks:true,list:async()=>[conversation],open:async()=>({conversation,messages:[message]}),dispatches:async()=>[],taskOptions:async()=>({projectId:'P',members:[],workers:[]}),dispatch:async()=>{throw Error('must not dispatch merely by opening')}} as unknown as ManagerConversationsAuthority
 let view!:ReactTestRenderer
 t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<ManagerConversationsPanel client={client} identity="owner" projectIds={['P']} name={id=>id}/>);await new Promise(resolve=>setImmediate(resolve))})
 await act(async()=>{view.root.findAllByType('button').find(node=>node.children.join('')==='Dispatch manager')!.props.onClick();await new Promise(resolve=>setImmediate(resolve))})
 assert.equal(view.root.findAllByType('summary').some(node=>node.children.join('')==='Run as a project task'),true,'supported manager messages must expose task dispatch')
})
