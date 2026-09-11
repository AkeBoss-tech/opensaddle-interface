import React from 'react'
import assert from 'node:assert/strict'
import test from 'node:test'
import {act,create} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {registerHooks} from 'node:module'
const hooks=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export {}',shortCircuit:true}:next(url,context)}})
const {ProjectProfilePanel}=await import('./ConnectedLocalProjectPage')
hooks.deregister()
import type {LocalProjectClient} from '../../services/contracts'
Object.assign(globalThis,{React,IS_REACT_ACT_ENVIRONMENT:true})
// PROJECT-PROFILE-AVAILABILITY-1
 test('missing profile capability is unavailable rather than permanently loading',async()=>{
 let view!:ReturnType<typeof create>
 await act(async()=>{view=create(<MemoryRouter><ProjectProfilePanel projectId="P"/></MemoryRouter>)})
 assert.match(JSON.stringify(view.toJSON()),/not available on this connection/)
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Loading authoritative/)
 await act(async()=>view.unmount())
})
test('profile request errors replace loading and capability removal clears the error',async()=>{
 let view!:ReturnType<typeof create>
 const client={onboardingState:async()=>{throw Error('Profile request denied')}} as unknown as LocalProjectClient
 await act(async()=>{view=create(<MemoryRouter><ProjectProfilePanel projectId="P" client={client}/></MemoryRouter>)})
 assert.match(JSON.stringify(view.toJSON()),/Profile request denied/)
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Loading authoritative/)
 await act(async()=>view.update(<MemoryRouter><ProjectProfilePanel projectId="P"/></MemoryRouter>))
 assert.match(JSON.stringify(view.toJSON()),/not available on this connection/)
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Profile request denied/)
 await act(async()=>view.unmount())
})
