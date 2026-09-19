import React from 'react'
import assert from 'node:assert/strict'
import test from 'node:test'
import {act, create, type ReactTestRenderer} from 'react-test-renderer'
import type {ServiceBundle} from '../../services'
import {useProductSurface} from './useProductSurface'

// PRODUCT-SURFACE-RECOVERY-1: loss of authority must not replace the chosen UI.
test('connected surface survives negotiation and outage, but never crosses connection identity', async()=>{
  const connected={controlPlane:{connected:true,v2Capabilities:true}} as ServiceBundle
  const offline={controlPlane:{connected:false,v2Capabilities:false}} as ServiceBundle
  function View({services,identity}:{services:ServiceBundle|null;identity:string}){
    const connectedSurface=useProductSurface(services,identity)
    return <section aria-label={connectedSurface?'Workspace':'Legacy'}><button disabled={!services?.controlPlane.connected}>Run task</button></section>
  }
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<View services={connected} identity="server-a/owner-a"/>)})
  try{
    assert.equal(view.root.findByType('section').props['aria-label'],'Workspace')
    for(const state of [null,offline,connected]){
      await act(async()=>view.update(<View services={state} identity="server-a/owner-a"/>))
      assert.equal(view.root.findByType('section').props['aria-label'],'Workspace','same workspace must survive service replacement')
      assert.equal(view.root.findByType('button').props.disabled,!state?.controlPlane.connected)
    }
    const legacy={controlPlane:{connected:true,v2Capabilities:false}} as ServiceBundle
    await act(async()=>view.update(<View services={legacy} identity="server-a/owner-a"/>))
    assert.equal(view.root.findByType('section').props['aria-label'],'Legacy','a live replacement server must use its negotiated surface')
    await act(async()=>view.update(<View services={connected} identity="server-a/owner-a"/>))
    await act(async()=>view.update(<View services={null} identity="server-b/owner-a"/>))
    assert.equal(view.root.findByType('section').props['aria-label'],'Legacy','unverified new endpoint must not inherit a surface decision')
    await act(async()=>view.update(<View services={connected} identity="server-b/owner-a"/>))
    await act(async()=>view.update(<View services={null} identity="server-b/owner-b"/>))
    assert.equal(view.root.findByType('section').props['aria-label'],'Legacy','new account must negotiate independently')
  }finally{await act(async()=>view.unmount())}
})
