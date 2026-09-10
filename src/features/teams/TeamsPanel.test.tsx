import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {TeamsPanel} from './TeamsPanel'
import {TeamsClient} from '../../services/teams'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
// TEAM-UI-1: recipients explicitly review and accept the displayed Team revision.
test('invitation is not membership until recipient reviews and accepts',async t=>{
 let accepted=false;let body:unknown
 const team={team_id:'T',display_name:'Research',revision:7,role:'member'}
 t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{if(url.endsWith('/accept')){body=JSON.parse(String(init?.body));accepted=true;return Response.json({...team,revision:8})}if(url.endsWith('/team-invitations'))return Response.json({items:accepted?[]:[team]});return Response.json({items:accepted?[{...team,viewer_role:'member'}]:[]})})
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<TeamsPanel client={new TeamsClient('http://localhost',()=> 'recipient')}/>);await flush()})
 const button=(name:string)=>view.root.findAllByType('button').find(node=>node.children.includes(name))!
 assert.equal(accepted,false)
 await act(async()=>button('Review invitation').props.onClick())
 assert.equal(accepted,false)
 await act(async()=>{button('Accept invitation').props.onClick();await flush();await flush()})
 assert.deepEqual(body,{expected_revision:7})
 assert.equal(button('Review invitation'),undefined)
 assert.match(JSON.stringify(view.toJSON()),/Research/)
 await act(async()=>view.unmount())
})
