import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { DevicePairing } from './DevicePairing'
import { PersonalDevicesClient, type PersonalDevice } from '../../services/personalDevices'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const device:PersonalDevice={deviceId:'device_1',ownerSubject:'owner',displayName:'Laptop',platform:'macos',pairingState:'unpaired',connectionState:'unknown'}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
// PERSONAL-DEVICE-PAIRING-UI-1: a fingerprint is never accepted implicitly.
test('pairing hides the consumed code and confirms only an explicit fingerprint match', async t=>{
  const fingerprint='a'.repeat(64), secret='s'.repeat(43)
  const requests:Array<{url:string;body:unknown}>=[]
  t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{
    const body=init?.body?JSON.parse(String(init.body)):null
    requests.push({url,body})
    if(url.endsWith('/pairing'))return Response.json({protocol:'opensaddle.device-pairing.v1',device_id:'device_1',pairing_id:'pairing_1',secret,expires_at:new Date(Date.now()+300000).toISOString()})
    if(url.endsWith('/confirm'))return Response.json({device_id:'device_1',pairing_state:'paired',fingerprint})
    return Response.json({device_id:'device_1',pairing_id:'pairing_1',state:'claimed',fingerprint})
  })
  const authority=new PersonalDevicesClient('http://localhost',()=> 'owner',undefined,true)
  let changed=0, view!:ReactTestRenderer
  await act(async()=>{view=create(<DevicePairing authority={authority} device={device} onChanged={()=>changed++}/>);await flush()})
  const button=(label:string)=>view.root.findAllByType('button').find(node=>node.children.includes(label))!
  await act(async()=>{button('Start pairing').props.onClick();await flush()})
  assert.equal(view.root.findByType('input').props.value,`pairing_1:device_1:${secret}`)
  await act(async()=>{button('Check device').props.onClick();await flush()})
  assert.doesNotMatch(JSON.stringify(view.toJSON()),new RegExp(secret))
  assert.equal(button('Confirm pairing').props.disabled,true)
  assert.equal(changed,0)
  await act(async()=>{view.root.findByType('input').props.onChange({target:{checked:true}})})
  assert.equal(button('Confirm pairing').props.disabled,false)
  await act(async()=>{button('Confirm pairing').props.onClick();await flush()})
  assert.deepEqual(requests.at(-1)?.body,{fingerprint})
  assert.equal(changed,1)
  await act(async()=>view.unmount())
})
test('unpair requires a deliberate action and binds the displayed enrollment revision',async t=>{
  let body:unknown, changed=0
  t.mock.method(globalThis,'fetch',async(_url:string,init?:RequestInit)=>{body=JSON.parse(String(init?.body));return Response.json({device_id:'device_1',pairing_state:'revoked',revision:8})})
  const authority=new PersonalDevicesClient('http://localhost',()=> 'owner',undefined,true)
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<DevicePairing authority={authority} device={{...device,pairingState:'paired',enrollmentRevision:7}} onChanged={()=>changed++}/>);await flush()})
  await act(async()=>{view.root.findByType('button').props.onClick()})
  assert.equal(body,undefined)
  await act(async()=>{view.root.findAllByType('button').find(node=>node.children.includes('Revoke pairing'))!.props.onClick();await flush()})
  assert.deepEqual(body,{expected_revision:7});assert.equal(changed,1)
  await act(async()=>view.unmount())
})
