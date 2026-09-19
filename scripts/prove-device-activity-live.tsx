/** Live Core plus mounted inventory. Fixture reports readiness; no native execution. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {DeviceInventory} from '../src/features/devices/DeviceInventory'
import {PersonalDevicesClient} from '../src/services/personalDevices'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const [metadataPath,receiptPath]=process.argv.slice(2)
assert.ok(metadataPath&&receiptPath)
const meta=JSON.parse(readFileSync(metadataPath,'utf8'));assert.equal(new URL(meta.base_url).hostname,'127.0.0.1')
const owner=new PersonalDevicesClient(meta.base_url,()=> 'owner'),member=new PersonalDevicesClient(meta.base_url,()=> 'member')
let view:ReactTestRenderer|undefined,revoked=false,unpaired=false
const until=async(check:()=>boolean)=>{for(let i=0;i<400&&!check();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25))});assert.ok(check(),'live device activity did not reach expected state')}
try{
 await assert.rejects(member.activity(meta.device_id),/404/)
 await act(async()=>{view=create(<DeviceInventory authority={owner} identity="owner" projects={[{id:'activity',name:'Activity project'}]}/>)})
 const button=(name:string)=>view!.root.findAllByType('button').find(node=>node.children.includes(name))
 await until(()=>Boolean(button('Show activity')))
 await act(async()=>button('Show activity')!.props.onClick())
 await until(()=>view!.root.findAllByType('a').length===1)
 assert.match(JSON.stringify(view!.toJSON()),/Agent reports ready/)
 assert.equal(view!.root.findByType('a').props.href,`/project/activity/tasks/${meta.run_id}`)
 await act(async()=>{await owner.revokeAssignment(meta.device_id,'activity',2);revoked=true})
 await until(()=>view!.root.findAllByType('a').length===0&&JSON.stringify(view!.toJSON()).includes('No active tasks reported'))
 await act(async()=>{await owner.unpair(meta.device_id,1);unpaired=true})
 await until(()=>JSON.stringify(view!.toJSON()).includes('Report unavailable or expired'))
 const fresh=new PersonalDevicesClient(meta.base_url,()=> 'owner'),activity=await fresh.activity(meta.device_id)
 assert.deepEqual(activity.activeRuns,[]);assert.equal(activity.readiness[0].unavailable_reason,'device_not_bound')
 writeFileSync(receiptPath,JSON.stringify({checked_at:new Date().toISOString(),fixture:meta,checks:['non-owner denied','mounted inventory displays current report and exact Run link','automatic poll removes Run after owner consent withdrawal','unpair invalidates displayed readiness','fresh client confirms revoked binding and no active Runs'],native_execution:false,cleanup:{consent_revoked:revoked,device_unpaired:unpaired},scope:'Live HTTP/Core and production mounted UI. Signed fixture device/worker and fixture-reported readiness; no native provider or browser visual proof.'},null,2)+'\n')
 console.log('Live device activity and automatic revocation refresh passed.')
}finally{
 if(view)await act(async()=>view!.unmount())
 if(!revoked)await owner.revokeAssignment(meta.device_id,'activity',2)
 if(!unpaired)await owner.unpair(meta.device_id,1)
}
