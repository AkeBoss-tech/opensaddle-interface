import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {DeviceAssignments} from './DeviceAssignments'
import {ProjectDeviceAccess} from './ProjectDeviceAccess'
import {PersonalDevicesClient} from '../../services/personalDevices'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
// DEVICE-OWNER-RESOURCE-UI: explicit owner edits, saved exact Project review.
test('owner keeps sets and removes limits with exact Project review',async t=>{
 let state:any={device_id:'D',project_id:'P',owner_subject:'owner',revision:2,state:'accepted',audience:'owner_only',subjects:[],source_ids:['S'],adapter_ids:['codex-app-server'],consent_allows_requester:true,resource_limits:null}
 const writes:any[]=[]
 t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/assignments')||url.endsWith('/devices'))return Response.json({items:[state]})
  if(url.endsWith('/members'))return Response.json({project_id:'P',viewer_subject:'owner',viewer_can_manage:true,members:[{subject:'owner',role:'owner',status:'active'}]})
  if(url.endsWith('/sources'))return Response.json({project_id:'P',items:[{source_id:'S',display_label:'Repository'}]})
  const body=JSON.parse(String(init?.body));writes.push(body);state={...state,revision:state.revision+1,state:'proposed',...(Object.hasOwn(body,'resource_limits')?{resource_limits:body.resource_limits}:{})};return Response.json(state)
 })
 const authority=new PersonalDevicesClient('http://localhost',()=> 'owner',undefined,true,true)
 let owner!:ReactTestRenderer,project:ReactTestRenderer|undefined
 t.after(async()=>act(async()=>{owner?.unmount();project?.unmount()}))
 const button=(view:ReactTestRenderer,name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))!
 await act(async()=>{owner=create(<DeviceAssignments authority={authority} deviceId="D" paired projects={[{id:'P',name:'Project'}]}/>);await flush()})
 await act(async()=>{button(owner,'Project access').props.onClick();await flush()})
 await act(async()=>{owner.root.findByType('select').props.onChange({target:{value:'P'}});await flush()})
 assert.ok(owner.root.findAllByProps({'aria-label':'Resource limits'}).length,'owner must have resource limit controls')
 await act(async()=>{button(owner,'Propose access').props.onClick();await flush()})
 assert.equal(Object.hasOwn(writes[0],'resource_limits'),false)
 const choose=async(value:string)=>act(async()=>owner.root.findByProps({'aria-label':'Resource limits'}).props.onChange({target:{value}}))
 await choose('set')
 await act(async()=>owner.root.findByProps({'aria-label':'CPU (millicores)'}).props.onChange({target:{value:''}}))
 assert.equal(button(owner,'Propose access').props.disabled,true)
 await act(async()=>{owner.root.findByProps({'aria-label':'CPU (millicores)'}).props.onChange({target:{value:'1500'}});owner.root.findByProps({'aria-label':'Memory (MiB)'}).props.onChange({target:{value:'2048'}})})
 await act(async()=>{button(owner,'Propose access').props.onClick();await flush()})
 assert.deepEqual(writes[1].resource_limits,{cpu_millicores:1500,memory_mib:2048,max_concurrency:1})
 await act(async()=>{project=create(<ProjectDeviceAccess authority={authority} projectId="P"/>);await flush()})
 await act(async()=>button(project!,'Review acceptance').props.onClick())
 const review=project!.root.findByProps({'aria-label':'Review device policy'})
 assert.deepEqual(review.findAllByType('dd').slice(0,3).map(node=>node.children.join('')),['1500','2048','1'])
 assert.match(JSON.stringify(project!.toJSON()),/declared task demand/)
 await choose('none')
 await act(async()=>{button(owner,'Propose access').props.onClick();await flush()})
 assert.equal(writes[2].resource_limits,null)
 assert.match(JSON.stringify(owner.toJSON()),/No owner resource limits set/)
})

test('client rejects unconfirmed limits from older servers',async t=>{
 const policy={expected_revision:0,audience:'owner_only' as const,subjects:[],source_ids:['S'],adapter_ids:['codex-app-server'],resource_limits:{cpu_millicores:1000,memory_mib:1024,max_concurrency:1}}
 t.mock.method(globalThis,'fetch',async()=>Response.json({device_id:'D',project_id:'P',owner_subject:'owner',revision:1,state:'proposed',audience:'owner_only',subjects:[],source_ids:['S'],adapter_ids:['codex-app-server'],consent_allows_requester:false}))
 const authority=new PersonalDevicesClient('http://localhost',()=> 'owner')
 await assert.rejects(authority.proposeAssignment('D','P',policy),/Resource limits could not be confirmed/)
})
