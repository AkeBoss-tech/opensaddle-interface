import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {TeamsClient} from '../../services/teams'
import {TeamProjectReviews} from './ProjectTeamSettings'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
// PROJECT-TEAM-UI-1: exact-revision explicit acceptance, stale review fencing.
test('Team manager reviews publication before accepting and must reload a conflict',async t=>{
 const writes:unknown[]=[]
 t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{if(init?.method==='POST'){writes.push(JSON.parse(String(init.body)));return new Response('',{status:409})}return Response.json({items:[{project_id:'Astra',team_id:'T',revision:4,state:'proposed'}]})})
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<TeamProjectReviews client={new TeamsClient('http://localhost',()=> 'manager')} teamId="T"/>);await flush()})
 const button=(name:string)=>view.root.findAllByType('button').find(node=>node.children.join('')===name)
 assert.equal(button('Accept project inheritance'),undefined)
 await act(async()=>button('Review Astra')!.props.onClick())
 assert.equal(writes.length,0)
 assert.match(JSON.stringify(view.toJSON()),/current and future presentation defaults/)
 await act(async()=>{button('Accept project inheritance')!.props.onClick();await flush()})
 assert.deepEqual(writes,[{expected_revision:4,action:'accept'}])
 assert.equal(button('Accept project inheritance'),undefined)
 assert.equal(button('Review Astra'),undefined)
 assert.match(JSON.stringify(view.toJSON()),/Reload before retrying/)
 await act(async()=>view.unmount())
})
