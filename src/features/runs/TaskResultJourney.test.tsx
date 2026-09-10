import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {createHash} from 'node:crypto'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {AuthoritativeRunSurface} from './AuthoritativeRunSurface'
import {RemoteJourneyClient} from '../../services/remoteJourney'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const text='Published answer: 527. <img src=x onerror=alert(1)>'
const digest=createHash('sha256').update(text).digest('hex')
const run={run_id:'run-result',project_id:'P',task:'Calculate',status:'completed',cancellation_requested:false,requested_by:'owner'}
const flush=()=>new Promise(resolve=>setTimeout(resolve,30))
function response(path:string,content=text){
 if(path.endsWith('/members'))return Response.json({project_id:'P',members:[]})
 if(path.endsWith('/artifacts'))return Response.json({run_id:run.run_id,artifacts:[{artifact_id:'artifact-result',content_digest:digest}]})
 if(path.endsWith('/content'))return new Response(content, {headers:{'Content-Type':'text/plain'}})
 return Response.json(run)
}
test('completed task displays checked artifact bytes and removes them when integrity fails',async()=>{
 const original=globalThis.fetch;let corrupt=false,view:ReactTestRenderer|undefined
 globalThis.fetch=async input=>response(new URL(String(input)).pathname,corrupt?'CORRUPTED RESULT':text)
 try{
  const authority=new RemoteJourneyClient('https://core.example',()=> 'owner')
  await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={authority} runId={run.run_id} projectId="P"/></MemoryRouter>);await flush()})
  await act(async()=>{await flush()})
  assert.equal(view!.root.findAllByType('pre')[0]?.children.join(''),text)
  assert.equal(view!.root.findAllByType('img').length,0)
  assert.match(JSON.stringify(view!.toJSON()),/do not establish correctness or human acceptance/)
  corrupt=true
  await act(async()=>{view!.root.findAllByType('button').find(node=>node.children.join('')==='Reload result')!.props.onClick();await flush()})
  await act(async()=>{await flush()})
  assert.equal(view!.root.findAllByType('pre').length,0)
  assert.match(JSON.stringify(view!.toJSON()),/result is unavailable/)
 }finally{if(view)await act(async()=>view!.unmount());globalThis.fetch=original}
})
test('result read rejects an account change while artifact bytes are arriving',async()=>{
 const original=globalThis.fetch;let subject='owner',release!:(response:Response)=>void
 globalThis.fetch=async input=>{
  const path=new URL(String(input)).pathname
  if(path.endsWith('/content'))return new Promise<Response>(resolve=>{release=resolve})
  return response(path)
 }
 try{
  const authority=new RemoteJourneyClient('https://core.example',()=>subject)
  const reading=authority.review('P',run.run_id)
  while(!release)await flush()
  subject='replacement'
  release(response('/content'))
  await assert.rejects(reading,/Result authority changed/)
 }finally{globalThis.fetch=original}
})
