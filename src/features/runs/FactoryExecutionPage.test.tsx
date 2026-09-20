import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { FactoryExecutionSurface } from './FactoryExecutionPage'
import type { FactoryExecutionClient, FactoryExecution } from '../../services/factoryExecution'
import type { CodingResultAuthority, CodingResult } from '../../services/codingResultReview'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const h=(c:string)=>c.repeat(64),a=`run_${'a'.repeat(32)}`,b=`run_${'b'.repeat(32)}`,executionId=`fexec_${'e'.repeat(32)}`
const cursor:FactoryExecution={executionId,projectId:'P',factoryId:'factory_example',factoryVersion:1,compileDigest:h('c'),requestedBy:'owner',state:'awaiting_a',aRunId:a,bRunId:null,aArtifactId:null,aArtifactDigest:null}
const evidence={projectId:'P',runId:a,artifactId:'art_abc',artifactDigest:h('d'),review:{reviewId:`review_${'f'.repeat(32)}`,decision:'accepted',reviewedBy:'owner',reviewedAt:'now'},executionStatus:'completed',checksStatus:'passed',limitations:[],patch:'diff'} as CodingResult
const content=(node:any):string=>typeof node==='string'?node:(node?.children??[]).map(content).join('')
const button=(view:ReactTestRenderer,label:string)=>view.root.findAllByType('button').find(node=>content(node)===label)
const flush=()=>new Promise(resolve=>setImmediate(resolve))

test('FACTORY-UI-2: mounted existing execution waits for an explicit A advance and shows B Run',async()=>{
  let current=cursor,advances=0,accepted=false
  const client={identity:()=> 'owner',read:async()=>current,advance:async()=>{advances++;current={...cursor,state:'awaiting_b',bRunId:b};return current},binding:async()=>({factoryId:'factory_example',factoryVersion:1,compileDigest:h('c'),goalId:'goal_one',criteria:[{criterionId:'acceptance_1',criterion:'Tests pass'}]})} as unknown as FactoryExecutionClient
  const codingResults={read:async()=>({...evidence,runId:current.state==='awaiting_a'?a:b,review:accepted?evidence.review:null}),decide:async()=>{}} as CodingResultAuthority
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<MemoryRouter><FactoryExecutionSurface projectId="P" executionId={executionId} client={client} codingResults={codingResults}/></MemoryRouter>);await flush()})
  assert.equal(advances,0)
  assert.equal(button(view,'Advance this exact result to step B'),undefined)
  assert.match(content(view.toJSON()),/Step B.*Not admitted/s)
  accepted=true
  await act(async()=>{button(view,'Refresh execution and evidence')!.props.onClick();await flush()})
  assert.ok(button(view,'Advance this exact result to step B'))
  await act(async()=>{button(view,'Advance this exact result to step B')!.props.onClick();await flush()})
  assert.equal(advances,1)
  assert.match(content(view.toJSON()),new RegExp(b))
  await act(async()=>view.unmount())
})

test('FACTORY-UI-2: final acceptance requires every fixed B criterion after current review',async()=>{
  let accepts=0
  const current:FactoryExecution={...cursor,state:'awaiting_b',bRunId:b,aArtifactId:'art_abc',aArtifactDigest:h('d')}
  const client={identity:()=> 'owner',read:async()=>current,binding:async()=>({factoryId:'factory_example',factoryVersion:1,compileDigest:h('c'),goalId:'goal_one',criteria:[{criterionId:'acceptance_1',criterion:'Tests pass'}]}),accept:async()=>{accepts++;return{state:'applied'}}} as unknown as FactoryExecutionClient
  const codingResults={read:async()=>({...evidence,runId:b}),decide:async()=>{}} as CodingResultAuthority
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<MemoryRouter><FactoryExecutionSurface projectId="P" executionId={executionId} client={client} codingResults={codingResults}/></MemoryRouter>);await flush()})
  assert.equal(button(view,'Accept exact step B criteria and complete Goal')?.props.disabled,true)
  assert.equal(accepts,0)
  await act(async()=>view.root.findByType('input').props.onChange({target:{checked:true}}))
  assert.equal(button(view,'Accept exact step B criteria and complete Goal')?.props.disabled,false)
  await act(async()=>{button(view,'Accept exact step B criteria and complete Goal')!.props.onClick();await flush()})
  assert.equal(accepts,1)
  await act(async()=>view.unmount())
})
