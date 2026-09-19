import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ProjectKnowledgePanel, type ProjectKnowledgeAuthority } from './ProjectKnowledgePanel'
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const document = {path:'README.md',commit:'a'.repeat(40)}
const capture = {...document,captureId:'capture',digest:'sha256:'+'b'.repeat(64),state:'captured' as const}
const list = {initialized:true,truncated:false,documents:[document],captures:[capture]}
const button = (view:ReactTestRenderer,label:string) => view.root.findAllByType('button').find(node=>node.children.join('') === label)!
const flush = () => new Promise(resolve=>setImmediate(resolve))

test('capture stays unreviewed until exact retained bytes are inspected and explicitly approved', async () => {
  let captures = 0, reviews = 0, refreshed = 0, captured = false
  const authority:ProjectKnowledgeAuthority = {list:async()=>({...list,captures:captured?[capture]:[]}),setup:async()=>{},capture:async(_project,selected)=>{assert.deepEqual(selected,document);captures++;captured=true},inspect:async()=>({...capture,text:'Actual document <script>inert</script>'}),review:async(_project,selected)=>{assert.equal(selected.digest,capture.digest);reviews++}}
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<ProjectKnowledgePanel authority={authority} projectId="P" onReviewed={()=>{refreshed++}}/>);await flush()})
  assert.equal(button(view,'Approve this exact source for task context'),undefined)
  await act(async()=>view.root.findByType('select').props.onChange({target:{value:document.path}}))
  await act(async()=>{button(view,'Capture selected version').props.onClick();await flush()})
  assert.equal(captures,1);assert.equal(reviews,0);assert.match(JSON.stringify(view.toJSON()),/Captured · review required/)
  await act(async()=>{button(view,'Inspect README.md').props.onClick();await flush()})
  assert.match(JSON.stringify(view.toJSON()),/Actual document <script>inert<\/script>/)
  assert.equal(view.root.findAllByType('script').length,0)
  await act(async()=>{button(view,'Approve this exact source for task context').props.onClick();button(view,'Approve this exact source for task context').props.onClick();await flush()})
  assert.equal(reviews,1);assert.equal(refreshed,1)
  await act(async()=>view.unmount())
})

test('revoked reread clears protected document before denial and replacement rejects stale inspection', async () => {
  let reject!:(error:Error)=>void, calls=0
  const authority:ProjectKnowledgeAuthority = {list:async()=>list,setup:async()=>{},capture:async()=>{},review:async()=>{},inspect:async()=>{calls++;if(calls===1)return{...capture,text:'PRIVATE DOCUMENT'};return new Promise((_resolve,no)=>{reject=no})}}
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<ProjectKnowledgePanel authority={authority} projectId="P" onReviewed={()=>{}}/>);await flush()})
  await act(async()=>{button(view,'Inspect README.md').props.onClick();await flush()})
  assert.match(JSON.stringify(view.toJSON()),/PRIVATE DOCUMENT/)
  await act(async()=>{button(view,'Inspect README.md').props.onClick();await flush()})
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/PRIVATE DOCUMENT/)
  await act(async()=>{reject(Error('revoked source'));await flush()})
  assert.match(JSON.stringify(view.toJSON()),/revoked source/)
  await act(async()=>{view.update(<ProjectKnowledgePanel projectId="Q" onReviewed={()=>{}}/>);await flush()})
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/README.md|revoked source|PRIVATE DOCUMENT/)
  await act(async()=>view.unmount())
})

test('late protected inspection cannot populate a replacement Project and reopening only reads', async () => {
  let resolve!:(value: typeof capture & {text:string})=>void, mutations=0
  const authority:ProjectKnowledgeAuthority = {list:async()=>list,setup:async()=>{mutations++},capture:async()=>{mutations++},review:async()=>{mutations++},inspect:()=>new Promise(done=>{resolve=done})}
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<ProjectKnowledgePanel authority={authority} projectId="P" onReviewed={()=>{}}/>);await flush()})
  await act(async()=>{button(view,'Inspect README.md').props.onClick();await flush()})
  await act(async()=>{view.update(<ProjectKnowledgePanel projectId="Q" onReviewed={()=>{}}/>);await flush()})
  await act(async()=>{resolve({...capture,text:'LATE PRIVATE DOCUMENT'});await flush()})
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/LATE PRIVATE DOCUMENT|README.md/)
  await act(async()=>view.unmount())
  await act(async()=>{view=create(<ProjectKnowledgePanel authority={authority} projectId="P" onReviewed={()=>{}}/>);await flush()})
  assert.equal(mutations,0)
  await act(async()=>view.unmount())
})

test('knowledge setup is explicit and unknown capture response retry preserves one intent', async () => {
  let initialized=false, setupCalls=0;const intents:string[]=[]
  const authority:ProjectKnowledgeAuthority = {list:async()=>({...list,initialized,captures:[]}),setup:async()=>{setupCalls++;initialized=true},capture:async(_project,_document,intent)=>{intents.push(intent);throw Error('delivery unknown')},review:async()=>{},inspect:async()=>({...capture,text:'doc'})}
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<ProjectKnowledgePanel authority={authority} projectId="P" onReviewed={()=>{}}/>);await flush()})
  assert.equal(setupCalls,0)
  await act(async()=>view.root.findByType('select').props.onChange({target:{value:document.path}}))
  assert.equal(button(view,'Capture selected version').props.disabled,true)
  await act(async()=>{button(view,'Set up project knowledge').props.onClick();await flush()})
  assert.equal(setupCalls,1)
  await act(async()=>{button(view,'Capture selected version').props.onClick();await flush()})
  await act(async()=>{button(view,'Capture selected version').props.onClick();await flush()})
  assert.equal(intents.length,2);assert.equal(intents[0],intents[1])
  await act(async()=>view.unmount())
})

test('withdraw and restore bind listed version, preserve review history and clear inspected bytes', async () => {
  let availability: {state:'available'|'withdrawn';revision:number}={state:'available',revision:2}, calls=0, refreshed=0
  let complete!:()=>void
  const reviewed={...capture,state:'reviewed' as const}
  const authority:ProjectKnowledgeAuthority={list:async()=>({...list,captures:[{...reviewed,availability}]}),setup:async()=>{},capture:async()=>{},review:async()=>{},inspect:async()=>({...reviewed,text:'PRIVATE BYTES'}),setAvailability:async(project,selected,state)=>{assert.equal(project,'P');assert.deepEqual(selected.availability,availability);assert.equal(selected.digest,capture.digest);calls++;await new Promise<void>(done=>{complete=done});availability={state,revision:availability.revision+1};return availability}}
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<ProjectKnowledgePanel authority={authority} projectId="P" onReviewed={()=>{refreshed++}}/>);await flush()})
  await act(async()=>{button(view,'Inspect README.md').props.onClick();await flush()})
  assert.match(JSON.stringify(view.toJSON()),/PRIVATE BYTES/)
  await act(async()=>{button(view,'Withdraw source access').props.onClick();button(view,'Withdraw source access').props.onClick();await flush()})
  assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(view.toJSON()),/PRIVATE BYTES/)
  await act(async()=>{complete();await flush()})
  assert.equal(refreshed,1);assert.equal(button(view,'Inspect README.md').props.disabled,true)
  assert.match(JSON.stringify(view.toJSON()),/Review recorded/);assert.ok(button(view,'Restore source access'))
  await act(async()=>{button(view,'Restore source access').props.onClick();await flush();complete();await flush()})
  assert.equal(refreshed,2);assert.equal(button(view,'Inspect README.md').props.disabled,false)
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/PRIVATE BYTES/)
  await act(async()=>view.unmount())
})

test('unknown withdrawal clears protected content, refreshes eligibility, and stale completion cannot affect another project', async () => {
  let reject!:(reason:Error)=>void, refreshed=0, reads=0
  const authority:ProjectKnowledgeAuthority={list:async()=>{reads++;return {...list,captures:[{...capture,availability:{state:'available',revision:0}}]}},setup:async()=>{},capture:async()=>{},review:async()=>{},inspect:async()=>({...capture,text:'PRIVATE BYTES'}),setAvailability:async()=>new Promise((_resolve,no)=>{reject=no})}
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<ProjectKnowledgePanel authority={authority} projectId="P" onReviewed={()=>{refreshed++}}/>);await flush()})
  await act(async()=>{button(view,'Inspect README.md').props.onClick();await flush()})
  await act(async()=>{button(view,'Withdraw source access').props.onClick();await flush();reject(Error('stale revision'));await flush()})
  assert.equal(refreshed,1);assert.equal(reads,2);assert.doesNotMatch(JSON.stringify(view.toJSON()),/PRIVATE BYTES/);assert.match(JSON.stringify(view.toJSON()),/stale revision/)
  await act(async()=>{button(view,'Withdraw source access').props.onClick();await flush()})
  await act(async()=>{view.update(<ProjectKnowledgePanel projectId="Q" onReviewed={()=>{refreshed++}}/>);await flush()})
  await act(async()=>{reject(Error('late response'));await flush()})
  assert.equal(refreshed,1);assert.doesNotMatch(JSON.stringify(view.toJSON()),/late response|README.md/)
  await act(async()=>view.unmount())
})

// INV-RETAINED-SOURCE-FRESHNESS: status is descriptive, never a review mutation.
test('retained review history distinguishes changed content from unavailable freshness', async () => {
  let mutations=0
  const authority:ProjectKnowledgeAuthority={list:async()=>({...list,captures:[{...capture,state:'reviewed',freshness:{state:'changed',checkedCommit:'c'.repeat(40)}}]}),setup:async()=>{mutations++},capture:async()=>{mutations++},inspect:async()=>({...capture,text:'Historical content'}),review:async()=>{mutations++}}
  let view!:ReactTestRenderer
  await act(async()=>{view=create(<ProjectKnowledgePanel authority={authority} projectId="P" onReviewed={()=>{}}/>);await flush()})
  assert.match(JSON.stringify(view.toJSON()),/Source content changed since capture/)
  assert.match(JSON.stringify(view.toJSON()),/Review recorded/)
  assert.match(JSON.stringify(view.toJSON()),/cccccccccccccccccccccccccccccccccccccccc/)
  assert.equal(mutations,0)
  await act(async()=>view.unmount())
})
