/** DEVICE-OWNER-RESOURCE-UI: production controls against disposable loopback Core. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {DeviceAssignments} from '../src/features/devices/DeviceAssignments'
import {ProjectDeviceAccess} from '../src/features/devices/ProjectDeviceAccess'
import {PersonalDevicesClient} from '../src/services/personalDevices'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const [metadataPath,receiptPath]=process.argv.slice(2)
assert.ok(metadataPath&&receiptPath)
const meta=JSON.parse(readFileSync(metadataPath,'utf8'))
assert.equal(new URL(meta.base_url).hostname,'127.0.0.1')
const client=()=>new PersonalDevicesClient(meta.base_url,()=> 'owner',undefined,true,true)
const authority=client(),limits={cpu_millicores:1500,memory_mib:2048,max_concurrency:2}
let owner:ReactTestRenderer|undefined,project:ReactTestRenderer|undefined
const button=(view:ReactTestRenderer,name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))
const until=async(check:()=>boolean)=>{for(let i=0;i<400&&!check();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25))});assert.ok(check(),'live resource controls did not reach expected state')}
const saved=async()=>(await client().assignments(meta.device_id))[0]
try{
 await act(async()=>{owner=create(<DeviceAssignments authority={authority} deviceId={meta.device_id} paired projects={[{id:'activity',name:'Activity project'}]}/>)})
 await act(async()=>button(owner!,'Project access')!.props.onClick())
 await until(()=>owner!.root.findAllByType('select').length===1)
 await act(async()=>owner!.root.findByType('select').props.onChange({target:{value:'activity'}}))
 await until(()=>owner!.root.findAllByProps({'aria-label':'Resource limits'}).length===1)
 await act(async()=>owner!.root.findByProps({'aria-label':'Resource limits'}).props.onChange({target:{value:'set'}}))
 for(const [label,value] of [['CPU (millicores)','1500'],['Memory (MiB)','2048'],['Concurrent demand','2']])await act(async()=>owner!.root.findByProps({'aria-label':label}).props.onChange({target:{value}}))
 await act(async()=>button(owner!,'Propose access')!.props.onClick())
 await until(()=>JSON.stringify(owner!.toJSON()).includes('Access policy: proposed')&&!owner!.root.findAllByType('fieldset')[0].props.disabled)
 let state=await saved();assert.equal(state.revision,3);assert.deepEqual(state.resource_limits,limits);assert.equal(state.state,'proposed')
 await act(async()=>{project=create(<ProjectDeviceAccess authority={authority} projectId="activity"/>)})
 await until(()=>Boolean(button(project!,'Review acceptance')))
 await act(async()=>button(project!,'Review acceptance')!.props.onClick())
 assert.deepEqual(project!.root.findByProps({'aria-label':'Review device policy'}).findAllByType('dd').slice(0,3).map(node=>node.children.join('')),['1500','2048','2'])
 await act(async()=>button(project!,'Accept policy')!.props.onClick())
 await until(()=>project!.root.findAllByType('p').some(node=>node.children.join('')==='Access policy: accepted'))
 state=await saved();assert.equal(state.revision,4);assert.deepEqual(state.resource_limits,limits)
 // Refresh owner snapshot before its next revision-bound edit.
 await act(async()=>button(owner!,'Refresh access')!.props.onClick())
 await until(()=>owner!.root.findAllByType('select').length===1)
 await act(async()=>owner!.root.findByType('select').props.onChange({target:{value:'activity'}}))
 await until(()=>Boolean(button(owner!,'Propose access')))
 await act(async()=>button(owner!,'Propose access')!.props.onClick())
 await until(()=>JSON.stringify(owner!.toJSON()).includes('Access policy: proposed')&&!owner!.root.findAllByType('fieldset')[0].props.disabled)
 state=await saved();assert.equal(state.revision,5);assert.deepEqual(state.resource_limits,limits)
 await act(async()=>owner!.root.findByProps({'aria-label':'Resource limits'}).props.onChange({target:{value:'none'}}))
 await act(async()=>button(owner!,'Propose access')!.props.onClick())
 await until(()=>JSON.stringify(owner!.toJSON()).includes('No owner resource limits set.')&&!owner!.root.findAllByType('fieldset')[0].props.disabled)
 state=await saved();assert.equal(state.revision,6);assert.equal(state.resource_limits,null);assert.equal(state.state,'proposed')
 writeFileSync(receiptPath,JSON.stringify({checked_at:new Date().toISOString(),fixture:meta,checks:['owner mounted controls persist exact resource limits','Project mounted review shows exact values','Project acceptance preserves values at next revision','Keep preserves limits after refresh','Remove persists null and requires fresh acceptance','fresh client confirms each durable state'],scope:'Real loopback HTTP Core and mounted production UI; fixture worker, no native provider dispatch or browser visual proof.'},null,2)+'\n')
 console.log('Live owner limits and Project acceptance passed.')
}finally{
 await act(async()=>{owner?.unmount();project?.unmount()})
 const state=await saved()
 if(!['revoked','removed'].includes(state.state))await authority.revokeAssignment(meta.device_id,'activity',state.revision)
 await authority.unpair(meta.device_id,meta.enrollment_revision)
 console.log('Fixture consent revoked and device unpaired.')
}
