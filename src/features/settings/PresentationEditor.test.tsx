import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {PresentationEditor} from './PresentationEditor'
import {PresentationSettingsClient} from '../../services/presentationSettings'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
// PRESENTATION-EDITOR-1: exact scope/revision and preserved unedited preferences.
test('editor preserves Perspective preference, saves explicit layer, resets inheritance and shows conflicts',async t=>{
 let state={scope:'user_project',project_id:'P',owner_subject:'owner',revision:2,can_write:true,values:{perspective:'custom.view'} as Record<string,string>};const bodies:any[]=[]
 t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{assert.match(url,/projects\/P\/settings\/presentation\/user_project$/);if(init?.method==='PUT'){const body=JSON.parse(String(init.body));bodies.push(body);if(bodies.length===3)return Response.json({}, {status:409});state={...state,revision:state.revision+1,values:body.values}}return Response.json(state)})
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<PresentationEditor client={new PresentationSettingsClient('http://localhost',()=> 'owner')} scope="user_project" projectId="P"/>);await flush()})
 const button=(name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))!
 await act(async()=>view.root.findAllByType('select')[0].props.onChange({target:{value:'light'}}))
 await act(async()=>{button('Save preferences').props.onClick();await flush()})
 assert.deepEqual(bodies[0],{expected_revision:2,values:{perspective:'custom.view',theme:'light'}})
 await act(async()=>{button('Reset to inherited defaults').props.onClick();await flush()})
 assert.deepEqual(bodies[1],{expected_revision:3,values:{}})
 await act(async()=>{button('Save preferences').props.onClick();await flush()})
 assert.match(JSON.stringify(view.toJSON()),/changed elsewhere/)
 assert.equal(button('Save preferences'),undefined)
 await act(async()=>view.unmount())
})

test('shared default view is editable without discarding appearance and can return to inheritance',async t=>{
 let state={scope:'project',project_id:'P',owner_subject:null,revision:0,can_write:true,values:{theme:'dark',density:'compact'} as Record<string,string>}
 const {reportAnnotatorV1}=await import('../../applications/fixturePackages')
 const renderer={...reportAnnotatorV1,application_id:'custom-view',authority:'core',execution_trust:'trusted_signed_publisher',input_schema:{$id:'opensaddle.project-tasks.v1'},descriptor:{ui_contract:{schema_version:'opensaddle.ui-contract.v1',mount_kind:'perspective',scope:'project',host_api_min:1,host_api_max:1,required_capabilities:[]}}} as unknown as import('../../services/contracts').ApplicationRendererDescriptor
 const catalog={applicationRenderers:async(project:string)=>{assert.equal(project,'P');return [renderer,{...renderer,application_id:'widget',descriptor:{ui_contract:{...(renderer.descriptor!.ui_contract as object),mount_kind:'widget'}}}]}}

 t.mock.method(globalThis,'fetch',async(_url:string,init?:RequestInit)=>{if(init?.method==='PUT'){const body=JSON.parse(String(init.body));assert.equal(body.expected_revision,state.revision);state={...state,revision:state.revision+1,values:body.values}}return Response.json(state)})
 let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<PresentationEditor catalog={catalog} client={new PresentationSettingsClient('http://core',()=> 'owner')} scope="project" projectId="P"/>);await flush()})
 const selector=()=>view.root.findAllByType('select').find(node=>node.props['aria-label']==='Default view')
 assert.ok(selector(),'shared settings must expose a default Perspective selector')
 assert.deepEqual(selector()!.findAllByType('option').map(option=>option.props.value),['','dialogue','dispatch','plugin.custom-view'])
 await act(async()=>selector()!.props.onChange({target:{value:'dispatch'}}))
 const save=()=>view.root.findAllByType('button').find(node=>node.children.includes('Save preferences'))!
 await act(async()=>save().props.onClick())
 assert.deepEqual(state.values,{theme:'dark',density:'compact',perspective:'dispatch'})
 await act(async()=>selector()!.props.onChange({target:{value:''}}))
 await act(async()=>save().props.onClick())
 assert.deepEqual(state.values,{theme:'dark',density:'compact'})
})
