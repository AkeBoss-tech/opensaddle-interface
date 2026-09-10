import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act,create,type ReactTestRenderer } from 'react-test-renderer'
import { DeviceAssignments } from './DeviceAssignments'
import { PersonalDevicesClient } from '../../services/personalDevices'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
// PERSONAL-DEVICE-ACCESS-UI-1: proposing owner consent is distinct from project acceptance.
test('owner proposes explicit scope, separately accepts as manager, and revokes the displayed revision',async t=>{
 const calls:Array<{url:string;method:string;body:any}>=[]
 const policy={device_id:'D',project_id:'P',owner_subject:'owner',revision:1,state:'proposed',audience:'owner_only',subjects:[],source_ids:['S'],adapter_ids:['codex-app-server'],consent_allows_requester:false}
 t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{
  const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({url,method:init?.method??'GET',body})
  if(url.endsWith('/members'))return Response.json({project_id:'P',viewer_subject:'owner',viewer_can_manage:true,members:[{subject:'owner',role:'owner',status:'active'},{subject:'teammate',role:'member',status:'active'}]})
  if(url.endsWith('/sources'))return Response.json({project_id:'P',items:[{source_id:'S',display_label:'Main repository'}]})
  if(url.endsWith('/assignments'))return Response.json({items:[]})
  if(url.endsWith('/decision'))return Response.json({...policy,revision:2,state:'accepted',consent_allows_requester:true})
  if(url.endsWith('/revoke'))return Response.json({...policy,revision:3,state:'revoked'})
  return Response.json(policy)
 })
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<DeviceAssignments authority={new PersonalDevicesClient('http://localhost',()=> 'owner',undefined,true,true)} deviceId="D" paired projects={[{id:'P',name:'Astra'}]}/>);await flush()})
 const button=(name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))!
 await act(async()=>{button('Project access').props.onClick();await flush()})
 await act(async()=>{view.root.findByType('select').props.onChange({target:{value:'P'}});await flush()})
 assert.equal(button('Propose access').props.disabled,true)
 await act(async()=>{view.root.findAllByType('input')[0].props.onChange();view.root.findAllByType('input')[1].props.onChange()})
 await act(async()=>{button('Propose access').props.onClick();await flush()})
 assert.deepEqual(calls.at(-1),{url:'http://localhost/api/v2/devices/D/assignments/P',method:'PUT',body:{expected_revision:0,audience:'owner_only',subjects:[],source_ids:['S'],adapter_ids:['codex-app-server']}})
 assert.equal(calls.filter(call=>call.url.endsWith('/decision')).length,0)
 await act(async()=>button('Review project acceptance').props.onClick())
 assert.equal(calls.filter(call=>call.url.endsWith('/decision')).length,0)
 await act(async()=>{button('Accept policy').props.onClick();await flush()})
 assert.deepEqual(calls.at(-1)?.body,{expected_revision:1,accept:true})
 await act(async()=>button('Revoke project access').props.onClick())
 await act(async()=>{button('Confirm revocation').props.onClick();await flush()})
 assert.deepEqual(calls.at(-1)?.body,{expected_revision:2})
 assert.match(JSON.stringify(view.toJSON()),/revoked/)
 await act(async()=>view.unmount())
})
test('owner can revoke an existing assignment after losing project roster access',async t=>{
 const policy={device_id:'D',project_id:'former-project',owner_subject:'owner',revision:9,state:'accepted',audience:'owner_only',subjects:[],source_ids:['S'],adapter_ids:['codex-app-server'],consent_allows_requester:false}
 let revoked=false
 t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/assignments'))return Response.json({items:[policy]})
  if(url.endsWith('/revoke')){assert.deepEqual(JSON.parse(String(init?.body)),{expected_revision:9});revoked=true;return Response.json({...policy,state:'revoked',revision:10})}
  return Response.json({detail:'membership required'},{status:403})
 })
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<DeviceAssignments authority={new PersonalDevicesClient('http://localhost',()=> 'owner',undefined,true,true)} deviceId="D" paired={false} projects={[]}/>);await flush()})
 const button=(name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))!
 await act(async()=>{button('Project access').props.onClick();await flush()})
 await act(async()=>{view.root.findByType('select').props.onChange({target:{value:'former-project'}});await flush()})
 assert.equal(button('Propose access'),undefined)
 await act(async()=>button('Revoke project access').props.onClick())
 await act(async()=>{button('Confirm revocation').props.onClick();await flush()})
 assert.equal(revoked,true)
 await act(async()=>view.unmount())
})
