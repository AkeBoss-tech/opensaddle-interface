import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act,create,type ReactTestRenderer } from 'react-test-renderer'
import { CodingResultPanel } from './CodingResultPanel'
import type { CodingResult,CodingResultAuthority } from '../../services/codingResultReview'
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT:boolean }).IS_REACT_ACT_ENVIRONMENT=true
const result:CodingResult={projectId:'P',runId:'run',artifactId:'artifact',artifactDigest:'a'.repeat(64),allowedPaths:['file.py'],sourceRevision:'b'.repeat(40),taskSpecDigest:'c'.repeat(64),executionStatus:'completed',checksStatus:'failed',patch:'--- file.py\n+++ file.py\n-real bug\n+fixed bug',patchDigest:'d'.repeat(64),checks:[{argv:['python','-m','pytest'],exit_code:1,stdout:'1 failed',stderr:'',timed_out:false}],limitations:['One check failed'],review:null}
const button=(view:ReactTestRenderer,label:string)=>view.root.findAllByType('button').find(node=>node.children.join('')===label)!
const flush=()=>new Promise(resolve=>setImmediate(resolve))
test('finished failed checks and human decision remain distinct with no automatic acceptance',async()=>{
 let accepted=false,calls=0;const authority:CodingResultAuthority={read:async()=>({...result,review:accepted?{decision:'accepted',reviewedBy:'human',reviewedAt:'now'}:null}),decide:async(value,decision)=>{assert.equal(value.artifactDigest,result.artifactDigest);assert.equal(decision,'accepted');calls++;accepted=true}}
 let view!:ReactTestRenderer;await act(async()=>{view=create(<CodingResultPanel authority={authority} projectId="P" runId="run"/>);await flush()})
 const displayed=JSON.stringify(view.toJSON());assert.match(displayed,/completed/);assert.match(displayed,/Checks failed/);assert.match(displayed,/Not decided/);assert.equal(calls,0)
 await act(async()=>{button(view,'Accept this exact result').props.onClick();button(view,'Accept this exact result').props.onClick();await flush()})
 assert.equal(calls,1);assert.match(JSON.stringify(view.toJSON()),/accepted by human/)
 await act(async()=>view.unmount());await act(async()=>{view=create(<CodingResultPanel authority={authority} projectId="P" runId="run"/>);await flush()});assert.equal(calls,1);assert.equal(button(view,'Accept this exact result'),undefined);await act(async()=>view.unmount())
})
test('stale decision denial clears displayed bytes and old route response cannot restore them',async()=>{
 let resolve!:(value:CodingResult)=>void,calls=0;const authority:CodingResultAuthority={read:async()=>{calls++;if(calls===1)return result;return new Promise(done=>{resolve=done})},decide:async()=>{throw Error('stale artifact; refresh')}}
 let view!:ReactTestRenderer;await act(async()=>{view=create(<CodingResultPanel authority={authority} projectId="P" runId="run"/>);await flush()})
 await act(async()=>{button(view,'Reject this exact result').props.onClick();await flush()});assert.match(JSON.stringify(view.toJSON()),/stale artifact/);assert.doesNotMatch(JSON.stringify(view.toJSON()),/fixed bug/)
 await act(async()=>{button(view,'Refresh exact result').props.onClick();await flush()})
 const other:CodingResultAuthority={read:async()=>({...result,projectId:'Q',patch:'OTHER RESULT'}),decide:async()=>{}}
 await act(async()=>{view.update(<CodingResultPanel authority={other} projectId="Q" runId="run"/>);await flush()})
 await act(async()=>{resolve(result);await flush()});assert.doesNotMatch(JSON.stringify(view.toJSON()),/fixed bug/);assert.match(JSON.stringify(view.toJSON()),/OTHER RESULT/);await act(async()=>view.unmount())
})

test('dirty launch baseline and truncated output are explicit in review',async()=>{
 const authority:CodingResultAuthority={read:async()=>({...result,baseline:{workspaceDigest:'e'.repeat(64),indexDigest:'f'.repeat(64),files:[{path:'file.py',digest:'1'.repeat(64)}]},verificationBeforeDigest:'2'.repeat(64),verificationAfterDigest:'2'.repeat(64),observationScope:'tracked and unignored files; external effects not attested',checks:[{...result.checks[0],output_truncated:['stdout']}]}),decide:async()=>{}}
 let view!:ReactTestRenderer;await act(async()=>{view=create(<CodingResultPanel authority={authority} projectId="P" runId="run"/>);await flush()})
 const text=JSON.stringify(view.toJSON());assert.match(text,/including any preexisting edits/);assert.match(text,/Launch workspace digest/);assert.match(text,/Output truncated: stdout/);assert.match(text,/displayed output is partial/);await act(async()=>view.unmount())
})
