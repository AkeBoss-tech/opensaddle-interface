/** OWNER-DEVICE-SDK-1: real signed package and owner-isolated Core inventory. */
import assert from 'node:assert/strict'
import React from 'react'
import {act,create} from 'react-test-renderer'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {ScopedViewCatalog} from '../src/features/settings/ScopedViewCatalog'
import {ScopedRendererClient} from '../src/services/scopedRenderers'
import {PersonalDevicesClient} from '../src/services/personalDevices'
const [state,receipt]=process.argv.slice(2),fixture=JSON.parse(readFileSync(join(state,'fixture.json'),'utf8'))
const token=(who:string)=>readFileSync(join(state,who+'.token'),'utf8')
const ownerDevices=new PersonalDevicesClient(fixture.base_url,()=> 'owner',token('owner'))
const own=await ownerDevices.register({registration_key:'owner-sdk-proof',display_name:'Owner laptop',platform:'macos'})
const outside=await new PersonalDevicesClient(fixture.base_url,()=> 'outsider',token('outsider')).register({registration_key:'outsider-sdk-proof',display_name:'Private outsider laptop',platform:'linux'})
const client=new ScopedRendererClient(fixture.base_url,()=> 'owner',token('owner'))
const previous=await client.environment({kind:'user',id:'owner'})
if(previous.definition.applications?.length)await client.select({kind:'user',id:'owner'},previous.revision,null,'Reset disposable SDK proof')
await assert.rejects(client.ownerDeviceActivity({kind:'user',id:'owner'},outside.deviceId))
await assert.rejects(client.ownerDevices({kind:'team',id:fixture.team_id}),/scope mismatch/)
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const listeners=new Set<(event:any)=>void>(),sent:any[]=[]
Object.assign(globalThis,{addEventListener:(name:string,listener:any)=>{if(name==='message')listeners.add(listener)},removeEventListener:(_name:string,listener:any)=>listeners.delete(listener)})
let init:any
const peer={postMessage:(message:any)=>{sent.push(message);if(message.kind==='init')init=message;if(message.kind==='ping')for(const listener of listeners)listener({source:peer,data:{...message,kind:'pong'}})}}
let view:any
await act(async()=>{view=create(<ScopedViewCatalog client={client}/>,{createNodeMock:element=>element.type==='iframe'?{contentWindow:peer}:null})})
const pause=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,100))})}
const until=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await pause();assert.ok(check(),'owner SDK expected result')}
const button=(name:string)=>view.root.findAllByType('button').find((node:any)=>node.children.includes(name))
await until(()=>Boolean(button('Use view')))
await act(async()=>button('Use view').props.onClick())
await until(()=>view.root.findAllByType('iframe').length===1)
await act(async()=>view.root.findByType('iframe').props.onLoad())
const send=async(fields:any)=>{await act(async()=>{for(const listener of listeners)listener({source:peer,data:{...init,...fields}})})}
await send({kind:'ready'})
await until(()=>JSON.stringify(view.toJSON()).includes('View ready.'))
await send({kind:'request',action:'read_devices',request_id:'inventory'})
await until(()=>sent.some(message=>message.request_id==='inventory'))
const inventory=sent.find(message=>message.request_id==='inventory')
assert.equal(inventory.kind,'resources')
assert.deepEqual(inventory.value.items,[{device_id:own.deviceId,display_name:'Owner laptop',platform:'macos',pairing_state:'unpaired',connection_state:'unknown'}])
assert.equal(inventory.value.task_authority,'not_evaluated')
assert.equal(JSON.stringify(sent).includes(token('owner')),false)
assert.equal(JSON.stringify(sent).includes(outside.deviceId),false)
await send({kind:'request',action:'read_device_activity',request_id:'hidden',device_id:outside.deviceId})
await pause()
assert.equal(sent.some(message=>message.request_id==='hidden'),false)
await send({kind:'request',action:'read_device_activity',request_id:'activity',device_id:own.deviceId})
await until(()=>sent.some(message=>message.request_id==='activity'))
const activity=sent.find(message=>message.request_id==='activity')
assert.equal(activity.value.device_id,own.deviceId)
assert.equal(activity.value.process_termination,'not_observed')
assert.deepEqual(activity.value.active_runs,[])
await act(async()=>view.unmount())
assert.equal(listeners.size,0)
writeFileSync(receipt,JSON.stringify({invariant:'OWNER-DEVICE-SDK-1',passed:true,checks:['signed user capability mounts','inventory excludes outsider device','no token in frame payload','activity requires delivered device','activity preserves uncertainty','Team scope rejected','cleanup'],boundary:'production host and clients with real Core and signed fixture; simulated iframe messaging'},null,2)+'\n')
console.log('Owner device SDK journey passed.')
