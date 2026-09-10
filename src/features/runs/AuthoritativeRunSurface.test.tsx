import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {AuthoritativeRunSurface,type AuthoritativeRunAuthority,type AuthoritativeRunDetail} from './AuthoritativeRunSurface'
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const detail:AuthoritativeRunDetail={runId:'run-real',projectId:'P',task:'Fix actual bug',status:'running',cancellationRequested:false,canCancel:true,codingTask:false}
const flush=()=>new Promise(resolve=>setImmediate(resolve))
const button=(view:ReactTestRenderer,label:string)=>view.root.findAllByType('button').find(node=>node.children.join('')===label)!
test('running task loads exact status and cancellation stays requested until authoritative acknowledgment',async()=>{
 let requests=0,status='running',requested=false
 const authority:AuthoritativeRunAuthority={runDetail:async(id)=>{assert.equal(id,'run-real');return{...detail,status,cancellationRequested:requested}},cancel:async(id)=>{assert.equal(id,'run-real');requests++;requested=true}}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={authority} runId="run-real"/></MemoryRouter>);await flush()})
 assert.match(JSON.stringify(view.toJSON()),/Fix actual bug/);assert.doesNotMatch(JSON.stringify(view.toJSON()),/No local runs yet/)
 await act(async()=>{button(view,'Request cancellation').props.onClick();button(view,'Request cancellation').props.onClick();await flush()})
 assert.equal(requests,1);assert.match(JSON.stringify(view.toJSON()),/Cancellation requested/);assert.doesNotMatch(JSON.stringify(view.toJSON()),/Cancellation acknowledged/)
 status='cancelled'
 await act(async()=>{button(view,'Refresh task status').props.onClick();await flush()})
 assert.match(JSON.stringify(view.toJSON()),/Cancellation acknowledged/)
 assert.match(view.root.findAllByType('a').find(node=>node.children.join('')==='Inspect result artifacts')!.props.href,/run=run-real.*project=P/)
 await act(async()=>view.unmount());assert.equal(requests,1)
})
test('route replacement fences late private status and unmount never cancels',async()=>{
 let resolve!:(value:AuthoritativeRunDetail)=>void,cancels=0
 const old:AuthoritativeRunAuthority={runDetail:()=>new Promise(done=>{resolve=done}),cancel:async()=>{cancels++}}
 const fresh:AuthoritativeRunAuthority={runDetail:async()=>({...detail,runId:'new',task:'Current task'})}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={old} runId="old"/></MemoryRouter>);await flush()})
 await act(async()=>{view.update(<MemoryRouter><AuthoritativeRunSurface authority={fresh} runId="new"/></MemoryRouter>);await flush()})
 await act(async()=>{resolve({...detail,runId:'old',task:'OLD PRIVATE TASK'});await flush()})
 assert.match(JSON.stringify(view.toJSON()),/Current task/);assert.doesNotMatch(JSON.stringify(view.toJSON()),/OLD PRIVATE TASK/)
 await act(async()=>view.unmount());assert.equal(cancels,0)
})
test('backend loss clears protected status and never becomes an empty local run list',async()=>{
 let failed=false
 const authority:AuthoritativeRunAuthority={runDetail:async()=>{if(failed)throw Error('backend disconnected');return detail}}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={authority} runId="run-real"/></MemoryRouter>);await flush()})
 failed=true;await act(async()=>{button(view,'Refresh task status').props.onClick();await flush()})
 assert.match(JSON.stringify(view.toJSON()),/Task unavailable.*backend disconnected/);assert.doesNotMatch(JSON.stringify(view.toJSON()),/Fix actual bug|No local runs yet/)
 await act(async()=>view.unmount())
})
