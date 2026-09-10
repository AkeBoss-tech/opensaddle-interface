import assert from 'node:assert/strict'
import test from 'node:test'
import {readScopedViewState,writeScopedViewState} from './state'
import type {ApplicationRendererCandidate} from '../../services/contracts'
// SCOPED-VIEW-STATE-1: storage API contract, including browser storage failure.
test('scoped state persists only exact server account scope and package with signed schema validation',t=>{
 const values=new Map<string,string>(), prior=globalThis.localStorage
 Object.assign(globalThis,{localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}})
 t.after(()=>Object.assign(globalThis,{localStorage:prior}))
 const item={package_id:'view',package_version:'1',manifest_digest:'a'.repeat(64),application_id:'main',state_schema_version:1,state_max_bytes:8192,state_schema:{type:'object',additionalProperties:false,maxProperties:1,properties:{filter:{type:'string',maxLength:20}}}} as ApplicationRendererCandidate
 const scope={kind:'team' as const,id:'team-one'}
 assert.equal(writeScopedViewState('server/account',scope,item,'main',{filter:'mine'}),true)
 assert.deepEqual(readScopedViewState('server/account',scope,item,'main'),{filter:'mine'})
 for(const [server,target,renderer,instance] of [['other/account',scope,item,'main'],['server/other',scope,item,'main'],['server/account',{kind:'user',id:'team-one'},item,'main'],['server/account',{kind:'team',id:'team-two'},item,'main'],['server/account',scope,{...item,manifest_digest:'b'.repeat(64)},'main'],['server/account',scope,item,'other']] as const)assert.equal(readScopedViewState(server,target,renderer,instance),undefined)
 assert.equal(writeScopedViewState('server/account',scope,item,'main',{filter:'x'.repeat(21)}),false)
 assert.equal(writeScopedViewState('server/account',scope,item,'main',{permission:'admin'}),false)
 assert.deepEqual(readScopedViewState('server/account',scope,item,'main'),{filter:'mine'})
 for(const key of values.keys())values.set(key,'not json')
 assert.equal(readScopedViewState('server/account',scope,item,'main'),undefined)
 Object.assign(globalThis,{localStorage:{getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('quota')}}})
 assert.equal(readScopedViewState('server/account',scope,item,'main'),undefined)
 assert.equal(writeScopedViewState('server/account',scope,item,'main',{filter:'mine'}),false)
})
