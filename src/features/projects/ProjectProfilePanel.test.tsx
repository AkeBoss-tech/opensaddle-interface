import React from 'react'
import assert from 'node:assert/strict'
import test from 'node:test'
import {act,create} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {registerHooks} from 'node:module'
const hooks=registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export {}',shortCircuit:true}:next(url,context)}})
const {ProjectProfilePanel}=await import('./ConnectedLocalProjectPage')
hooks.deregister()
import type {LocalProjectClient,ProjectOnboardingState} from '../../services/contracts'
Object.assign(globalThis,{React,IS_REACT_ACT_ENVIRONMENT:true})
// PROJECT-PROFILE-AVAILABILITY-1
test('project profile reads and renders authoritative onboarding state for the selected project',async()=>{
 const requested:string[]=[]
 const state:ProjectOnboardingState={
  contract:'opensaddle.project-onboarding/v1',projectId:'P',status:'ready',
  fingerprint:'source-fingerprint',
  discovery:{contract:'krail.project-discovery/v1',root:'/repo',mode:'onboard',fingerprint:'source-fingerprint',languages:['TypeScript'],ecosystems:['npm'],fileCount:1,commands:[]},
  profile:{contract:'krail.project-profile/v1',claims:[{text:'Source-backed claim',evidence:[{path:'src/app.ts',revision:'main',digest:'abc123',span:{startLine:2,endLine:4}}]}],review:{status:'accepted'}},
  recommendationOptions:[],executionReady:true,executionBarriers:[],refreshRequired:false,
 }
 const client={onboardingState:async(projectId:string)=>{requested.push(projectId);return state}} as unknown as LocalProjectClient
 let view!:ReturnType<typeof create>
 await act(async()=>{view=create(<MemoryRouter><ProjectProfilePanel projectId="P" client={client}/></MemoryRouter>)})
 assert.deepEqual(requested,['P'])
 const rendered=JSON.stringify(view.toJSON())
 assert.match(rendered,/source-fingerprint/)
 assert.match(rendered,/npm/)
 assert.match(rendered,/Source-backed claim/)
 assert.match(rendered,/src\/app\.ts:2-4@main#abc123/)
 await act(async()=>view.unmount())
})
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
