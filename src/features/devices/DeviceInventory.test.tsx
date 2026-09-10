import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { DeviceInventory } from './DeviceInventory'
import { PersonalDevicesClient } from '../../services/personalDevices'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT = true
const row = (name: string, owner = 'owner') => ({device_id:'device_'+name, owner_subject:owner, display_name:name, platform:'macos', pairing_state:'unpaired', connection_state:'unknown', task_execution_available:false})
const reply = (items: unknown[]) => Response.json({items,next_cursor:null})
const flush = () => new Promise(resolve => setImmediate(resolve))

// PERSONAL-DEVICE-INVENTORY-UI-1: real client, controlled HTTP transport; no Core policy mocked.
test('registration retries retain one intent and inventory never claims pairing or task access', async t => {
  let saves = 0
  const bodies: unknown[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      bodies.push(JSON.parse(String(init.body))); saves++
      if (saves === 1) throw Error('Response lost')
      return Response.json(row('Laptop'))
    }
    return reply(saves ? [row('Laptop')] : [])
  })
  const authority = new PersonalDevicesClient('http://localhost', () => 'owner')
  let view!: ReactTestRenderer
  await act(async () => { view = create(<DeviceInventory authority={authority} identity="owner"/>); await flush() })
  assert.match(JSON.stringify(view.toJSON()), /No devices yet/)
  await act(async () => { view.root.findByType('input').props.onChange({target:{value:'Laptop'}}) })
  const submit = async () => act(async () => { view.root.findByType('form').props.onSubmit({preventDefault(){}}); await flush() })
  await submit()
  assert.match(JSON.stringify(view.toJSON()), /Response lost/)
  assert.equal(view.root.findByType('input').props.disabled, true)
  await submit()
  assert.deepEqual(bodies[0], bodies[1])
  assert.deepEqual(Object.keys(bodies[0] as object).sort(), ['display_name','platform','registration_key'])
  const content = JSON.stringify(view.toJSON())
  assert.match(content, /Not paired/)
  assert.match(content, /Connection not verified/)
  assert.doesNotMatch(content, /Ready to run/)
  await act(async () => view.unmount())
})

test('replaced connection clears inventory and ignores a late response', async t => {
  let resolve!: (response: Response) => void
  t.mock.method(globalThis, 'fetch', async (url: string) => url.startsWith('http://old') ? new Promise<Response>(done => {resolve = done}) : reply([row('Current')]))
  const old = new PersonalDevicesClient('http://old', () => 'owner')
  const current = new PersonalDevicesClient('http://new', () => 'owner')
  let view!: ReactTestRenderer
  await act(async () => { view = create(<DeviceInventory authority={old} identity="owner"/>); await flush() })
  await act(async () => { view.update(<DeviceInventory authority={current} identity="owner"/>); await flush() })
  await act(async () => { resolve(reply([row('Private-old')])); await flush() })
  assert.match(JSON.stringify(view.toJSON()), /Current/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /Private-old/)
  await act(async () => view.unmount())
})

test('client rejects account changes during response parsing and mixed-owner pages', async t => {
  let user = 'owner'
  let resolve!: (response: Response) => void
  t.mock.method(globalThis, 'fetch', async () => new Promise<Response>(done => {resolve = done}))
  const authority = new PersonalDevicesClient('http://localhost', () => user)
  const pending = authority.list()
  user = 'different'
  resolve(reply([row('Old')]))
  await assert.rejects(pending, /account changed/)
  t.mock.method(globalThis, 'fetch', async () => reply([row('A','one'), row('B','two')]))
  await assert.rejects(authority.list(), /Invalid device inventory/)
})

for(const action of ['list','register'])
test(`personal device ${action} withholds a different owner's response`,async t=>{
 t.mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>init?.method==='POST'?Response.json(row('Foreign device','other')):reply(action==='list'?[row('Foreign device','other')]:[]))
 const authority=new PersonalDevicesClient('http://localhost',()=> 'owner')
 let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<DeviceInventory authority={authority} identity="owner"/>);await flush()})
 if(action==='register'){
  await act(async()=>view.root.findByType('input').props.onChange({target:{value:'My laptop'}}))
  await act(async()=>{view.root.findByType('form').props.onSubmit({preventDefault(){}});await flush()})
 }
 assert.match(JSON.stringify(view.toJSON()),/Device owner identity changed/,'device responses must match the current owner before display or confirmation')
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Foreign device|Device saved/)
})

test('owner opens bounded device activity, distinguishes stale reports and clears failed refreshes',async t=>{
 let denied=false
 const payload={schema_version:'opensaddle.device-activity.v1',device_id:'device_Laptop',owner_subject:'owner',generated_at:new Date().toISOString(),task_authority:'not_evaluated',visibility:'current_project_memberships',process_termination:'not_observed',readiness:[{worker_id:'worker',project_id:'P',adapter_id:'codex-app-server',reported_ready:true,current:false,unavailable_reason:'report_expired',observed_at:'2020-01-01T00:00:00Z',expires_at:'2020-01-01T00:01:00Z'}],active_runs:[{run_id:'R',worker_id:'worker',project_id:'P',status:'running'}]}
 t.mock.method(globalThis,'fetch',async(url:unknown)=>String(url).endsWith('/activity')?(denied?Response.json({}, {status:403}):Response.json({...payload,private_path:'/must-not-render'})):reply([row('Laptop')]))
 const authority=new PersonalDevicesClient('http://localhost',()=> 'owner');let view!:ReactTestRenderer
 t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<DeviceInventory authority={authority} identity="owner" projects={[{id:'P',name:'Astra'}]}/>);await flush()})
 const button=(label:string)=>view.root.findAllByType('button').find(node=>node.children.includes(label))
 assert.ok(button('Show activity'),'personal inventory must expose owner activity')
 await act(async()=>{button('Show activity')!.props.onClick();await flush()})
 assert.match(JSON.stringify(view.toJSON()),/Report unavailable or expired/)
 assert.match(JSON.stringify(view.toJSON()),/does not grant permission/)
 assert.equal(view.root.findByType('a').props.href,'/project/P/tasks/R')
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/must-not-render/)
 denied=true
 await act(async()=>{button('Refresh activity')!.props.onClick();await flush()})
 assert.equal(view.root.findAllByType('a').length,0)
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/codex-app-server/)
 assert.match(JSON.stringify(view.toJSON()),/Device activity is unavailable/)
})

test('activity client rejects substituted device and owner identities',async t=>{
 const authority=new PersonalDevicesClient('http://localhost',()=> 'owner')
 for(const wrong of [{device_id:'other',owner_subject:'owner'},{device_id:'device',owner_subject:'other'}]){
  t.mock.method(globalThis,'fetch',async()=>Response.json({...wrong,schema_version:'opensaddle.device-activity.v1',task_authority:'not_evaluated',visibility:'current_project_memberships',process_termination:'not_observed'}))
  await assert.rejects(authority.activity('device'),/identity changed/)
 }
})

test('device activity expires without a render from a stalled refresh and stops when closed',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:10000})
 let calls=0,release!:()=>void
 const held=new Promise<void>(resolve=>{release=resolve})
 const payload=()=>({schema_version:'opensaddle.device-activity.v1',device_id:'device_Laptop',owner_subject:'owner',generated_at:new Date().toISOString(),task_authority:'not_evaluated',visibility:'current_project_memberships',process_termination:'not_observed',readiness:[{worker_id:'worker',project_id:'P',adapter_id:'codex-app-server',reported_ready:true,current:true,unavailable_reason:null,observed_at:new Date(10000).toISOString(),expires_at:new Date(11000).toISOString()}],active_runs:[{run_id:'R',worker_id:'worker',project_id:'P',status:'running'}]})
 t.mock.method(globalThis,'fetch',async(url:unknown)=>{if(!String(url).endsWith('/activity'))return reply([row('Laptop')]);calls++;if(calls>1)await held;return Response.json(payload())})
 const authority=new PersonalDevicesClient('http://localhost',()=> 'owner');let view!:ReactTestRenderer
 t.after(async()=>{release();if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<DeviceInventory authority={authority} identity="owner"/>);await flush()})
 const button=(label:string)=>view.root.findAllByType('button').find(node=>node.children.includes(label))!
 await act(async()=>{button('Show activity').props.onClick();await flush()})
 assert.match(JSON.stringify(view.toJSON()),/Agent reports ready/)
 await act(async()=>{t.mock.timers.tick(1001);await flush()})
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Agent reports ready/,'expired readiness must disappear without a new HTTP response')
 assert.match(JSON.stringify(view.toJSON()),/Report unavailable or expired/)
 await act(async()=>{t.mock.timers.tick(14000);await flush()})
 assert.equal(view.root.findAllByType('a').length,0,'stalled activity must clear the old active task projection')
 assert.match(JSON.stringify(view.toJSON()),/activity is stale/)
 await act(async()=>button('Hide activity').props.onClick())
 await act(async()=>{release();await flush();t.mock.timers.tick(20000);await flush()})
 assert.equal(calls,2,'closing must stop the delayed read from scheduling another poll')
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/codex-app-server/)
})
