import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {ManagerScopePanel} from './ManagerScopePanel'
import type {ManagerContext} from '../../services/managerContext'
;(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const context=(ids:string[]):ManagerContext=>({schema_version:'opensaddle.manager-context.v1',generated_at:'2026-09-10T10:00:00Z',project_ids:ids,projects:ids.map(project_id=>({project_id,status:'active',objective:`${project_id} private objective`,next_action:null})),active_runs:[],outcomes:[],attention_items:[],truncated:{active_runs:true,outcomes:false,attention_items:false},execution_authority:false})
// MANAGER-SCOPE-UI-1: explicit selection, clearing and late-response fences.
test('manager scope previews exact selection and fences changed scope and account',async t=>{
 const directory={list:async()=>[{id:'A',name:'Alpha',role:'owner'},{id:'B',name:'Beta',role:'member'}]}
 const calls:Array<{ids:string[];resolve:(value:ManagerContext)=>void}>=[]
 const client={preview:(ids:string[])=>new Promise<ManagerContext>(resolve=>calls.push({ids:[...ids],resolve}))}
 let view!:ReactTestRenderer
 t.after(async()=>{if(view)await act(async()=>view.unmount())})
 const render=(identity:string)=><ManagerScopePanel client={client} directory={directory} identity={identity}/>
 await act(async()=>{view=create(render('one'))})
 const button=()=>view.root.findAllByType('button').find(node=>node.children.join('')==='Preview context')!
 assert.equal(button().props.disabled,true)
 await act(async()=>view.root.findAllByType('input')[0].props.onChange({target:{checked:true}}))
 await act(async()=>{void button().props.onClick()})
 assert.deepEqual(calls[0].ids,['A'])
 await act(async()=>view.root.findAllByType('input')[0].props.onChange({target:{checked:false}}))
 await act(async()=>calls[0].resolve(context(['A'])))
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/A private objective/)
 await act(async()=>view.root.findAllByType('input')[1].props.onChange({target:{checked:true}}))
 await act(async()=>{void button().props.onClick()})
 await act(async()=>calls[1].resolve(context(['B'])))
 assert.match(JSON.stringify(view.toJSON()),/B private objective/)
 assert.match(JSON.stringify(view.toJSON()),/preview is partial/)
 assert.match(JSON.stringify(view.toJSON()),/No tasks have been started/)
 await act(async()=>{void button().props.onClick()})
 await act(async()=>view.update(render('two')))
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/B private objective/)
 await act(async()=>calls[2].resolve(context(['B'])))
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/B private objective/)
 assert.equal(button().props.disabled,true)
})
