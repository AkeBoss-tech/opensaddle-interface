import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {DeviceAssignments} from './DeviceAssignments'
import {ProjectDeviceAccess} from './ProjectDeviceAccess'
import {PersonalDevicesClient} from '../../services/personalDevices'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
// DEVICE-CONSENT-IDLE-EXPIRY: elapsed consent updates idle owner and manager controls.
test('idle consent expiry removes active wording and disables an already open acceptance',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:10000})
 const policy={device_id:'D',project_id:'P',owner_subject:'owner',revision:2,state:'accepted',audience:'owner_only',subjects:[],source_ids:['S'],adapter_ids:['codex-app-server'],consent_allows_requester:true,expires_at:new Date(11000).toISOString(),expired:false}
 let writes=0
 t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{
  if(init?.method&&init.method!=='GET'){writes++;return Response.json(policy)}
  if(url.endsWith('/assignments'))return Response.json({items:[policy]})
  if(url.endsWith('/devices'))return Response.json({items:[{...policy,state:'proposed',consent_allows_requester:false}]})
  if(url.endsWith('/members'))return Response.json({project_id:'P',viewer_subject:'owner',viewer_can_manage:true,members:[{subject:'owner',role:'owner',status:'active'}]})
  return Response.json({project_id:'P',items:[{source_id:'S',display_label:'Repository'}]})
 })
 const authority=new PersonalDevicesClient('http://localhost',()=> 'owner',undefined,true,true)
 let owner!:ReactTestRenderer,project!:ReactTestRenderer
 t.after(async()=>{await act(async()=>{owner?.unmount();project?.unmount()})})
 const button=(view:ReactTestRenderer,name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))!
 await act(async()=>{owner=create(<DeviceAssignments authority={authority} deviceId="D" paired projects={[{id:'P',name:'Project'}]}/>);project=create(<ProjectDeviceAccess authority={authority} projectId="P"/>);await flush()})
 await act(async()=>{button(owner,'Project access').props.onClick();await flush()})
 await act(async()=>{owner.root.findByType('select').props.onChange({target:{value:'P'}});await flush()})
 await act(async()=>button(project,'Review acceptance').props.onClick())
 assert.match(JSON.stringify(owner.toJSON()),/Your task-use consent is active/)
 assert.equal(button(project,'Accept policy').props.disabled,false)
 const staleAccept=button(project,'Accept policy').props.onClick
 await act(async()=>t.mock.timers.tick(1000))
 assert.doesNotMatch(JSON.stringify(owner.toJSON()),/Your task-use consent is active/,'idle owner must stop displaying expired consent as active')
 assert.match(JSON.stringify(owner.toJSON()),/Consent expired/)
 assert.match(JSON.stringify(project.toJSON()),/Consent expired/)
 assert.equal(button(project,'Accept policy').props.disabled,true)
 assert.equal(button(project,'Review acceptance').props.disabled,true)
 await act(async()=>{staleAccept();await flush()})
 assert.equal(writes,0,'stale acceptance handler must not submit expired consent')
 assert.equal(button(owner,'Revoke project access').props.disabled,false)
 assert.equal(button(project,'Decline proposal').props.disabled,false)
})
