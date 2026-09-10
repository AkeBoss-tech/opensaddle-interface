import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {PerspectiveHost} from '../PerspectiveHost'
import {resolveProjectPerspective} from './builtins'
import {projectTaskModel} from './model'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
// PROJECT-PERSPECTIVES-1: switching surfaces preserves canonical run identity.
test('both registered perspectives open the same canonical task and unknown preference falls back',async()=>{
 const model=projectTaskModel({projectId:'P',members:[],workers:[],activeRuns:[{runId:'run-one',task:'Inspect source',status:'running',leaseEpoch:1,requestedBy:'owner',cancellationRequested:false}],results:[{runId:'result-one',title:'Finished task',status:'completed',verified:true}]},'P')
 let opened='',created=0,view!:ReactTestRenderer
 const inputs={model,onOpenTask:(id:string)=>{opened=id},onNewTask:()=>{created++}}
 for(const id of ['dialogue','dispatch']){
  await act(async()=>{if(view)view.unmount();view=create(<PerspectiveHost perspective={resolveProjectPerspective(id).perspective} projectId="P" inputs={inputs}/> )})
  assert.match(JSON.stringify(view.toJSON()),/Inspect source/)
  const task=view.root.findAllByType('button').find(button=>button.findAllByType('strong').some(node=>node.children.includes('Inspect source')))!
  await act(async()=>task.props.onClick());assert.equal(opened,'run-one')
  await act(async()=>view.root.findAllByType('button').find(button=>button.children.includes('New task'))!.props.onClick())
 }
 assert.equal(created,2)
 assert.equal(resolveProjectPerspective('missing.package').fallback,true)
 assert.equal(resolveProjectPerspective('missing.package').perspective.id,'dialogue')
 assert.throws(()=>projectTaskModel({projectId:'Other',members:[],workers:[]},'P'),/mismatch/)
 assert.equal(Object.isFrozen(model.tasks),true)
 await act(async()=>view.unmount())
})
