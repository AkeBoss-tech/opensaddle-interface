import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {ProjectDeviceAccess} from './ProjectDeviceAccess'
import {PersonalDevicesClient} from '../../services/personalDevices'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
const item={device_id:'D',project_id:'P',display_name:'Owner laptop',owner_subject:'device-owner',revision:3,state:'proposed',audience:'selected_members',subjects:['teammate'],source_ids:['S'],adapter_ids:['codex-app-server'],consent_allows_requester:false}
// PROJECT-DEVICE-REVIEW-UI-1: a manager accepts the displayed owner's policy and exact revision.
test('manager reviews another owner policy, accepts exact revision, then removes only project access',async t=>{
 let state={...item};const mutations:any[]=[]
 t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/decision')){const body=JSON.parse(String(init?.body));mutations.push(body);state={...state,revision:state.revision+1,state:body.accept?'accepted':'removed'};return Response.json(state)}
  if(url.endsWith('/devices'))return Response.json({items:[state]})
  if(url.endsWith('/members'))return Response.json({project_id:'P',viewer_subject:'manager',viewer_can_manage:true,members:[{subject:'manager',role:'admin',status:'active'}]})
  return Response.json({project_id:'P',items:[{source_id:'S',display_label:'Repository'}]})
 })
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<ProjectDeviceAccess authority={new PersonalDevicesClient('http://localhost',()=> 'local-id')} projectId="P"/>);await flush()})
 const button=(name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))!
 await act(async()=>button('Review acceptance').props.onClick())
 assert.equal(mutations.length,0)
 assert.match(JSON.stringify(view.toJSON()),/device-owner/)
 assert.match(JSON.stringify(view.toJSON()),/teammate/)
 await act(async()=>{button('Accept policy').props.onClick();await flush();await flush()})
 assert.deepEqual(mutations,[{expected_revision:3,accept:true}])
 await act(async()=>button('Remove project access').props.onClick())
 await act(async()=>{button('Confirm removal').props.onClick();await flush();await flush()})
 assert.deepEqual(mutations.at(-1),{expected_revision:4,accept:false})
 assert.match(JSON.stringify(view.toJSON()),/removed/)
 await act(async()=>view.unmount())
})
test('project replacement discards old review and late response, and member has no decision controls',async t=>{
 let release!:(value:Response)=>void
 t.mock.method(globalThis,'fetch',async(url:string)=>{
  if(url.includes('/P/devices'))return new Promise<Response>(resolve=>{release=resolve})
  const project=url.includes('/P/')?'P':'Q'
  if(url.endsWith('/devices'))return Response.json({items:[{...item,project_id:'Q',display_name:'Q laptop'}]})
  if(url.endsWith('/members'))return Response.json({project_id:project,viewer_subject:'member',viewer_can_manage:false,members:[{subject:'member',role:'member',status:'active'}]})
  return Response.json({project_id:project,items:[]})
 })
 const authority=new PersonalDevicesClient('http://localhost',()=> 'member')
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<ProjectDeviceAccess authority={authority} projectId="P"/>);await flush()})
 await act(async()=>{view.update(<ProjectDeviceAccess authority={authority} projectId="Q"/>);await flush();release(Response.json({items:[item]}));await flush()})
 assert.match(JSON.stringify(view.toJSON()),/Q laptop/)
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Owner laptop/)
 assert.deepEqual(view.root.findAllByType('button').map(node=>node.children.join('')),['Refresh project devices'])
 await act(async()=>view.unmount())
})
