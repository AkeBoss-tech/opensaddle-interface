/** Mounted host + real loopback Core HTTP proof; no browser or worker execution.
 * Start Core scripts.dev_run_approval_fixture, then pass STATE_DIR RECEIPT_PATH.
 * This changes only the explicitly identified fixture's reviewer membership.
 */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {AuthoritativeRunSurface} from '../src/features/runs/AuthoritativeRunSurface'
import {RunApprovalReviewClient} from '../src/services/runApprovalReview'
import {RemoteJourneyClient} from '../src/services/remoteJourney'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const [state,output]=process.argv.slice(2);assert.ok(state&&output)
const meta=JSON.parse(readFileSync(join(state,'fixture.json'),'utf8'))
assert.equal(meta.fixture,'run-approval-v1');assert.equal(meta.project_id,'approval-proof');assert.equal(new URL(meta.base_url).hostname,'127.0.0.1')
const token=(name:string)=>readFileSync(join(state,`${name}.token`),'utf8')
const base=meta.base_url,project=meta.project_id,[first,second]=meta.run_ids
const client=new RunApprovalReviewClient(base,()=> 'approval-reviewer',token('approval-reviewer'))
const journey=new RemoteJourneyClient(base,()=> 'approval-reviewer',token('approval-reviewer'))
const reader=new RunApprovalReviewClient(base,()=> 'approval-reader',token('approval-reader'))
let view:ReactTestRenderer|undefined
const button=(label:string)=>view!.root.findAllByType('button').find(node=>node.children.join('')===label)
async function until(test:()=>boolean){for(let i=0;i<200&&!test();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25))});assert.ok(test(),'Live approval condition timed out')}
async function mount(run:string){if(view)await act(async()=>view!.unmount());await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={journey} projectId={project} runId={run} approvalReview={client}/></MemoryRouter>)});await until(()=>Boolean(button('Review task for approval')))}
try{
 const readOnly=await reader.read(project,first);assert.equal(readOnly.can_approve,false)
 await assert.rejects(reader.approve(project,first,readOnly.review_digest))
 await assert.rejects(client.read('outside-project',first))
 await mount(first)
 await act(async()=>button('Review task for approval')!.props.onClick())
 await until(()=>Boolean(button('Approve reviewed task')))
 assert.match(JSON.stringify(view!.toJSON()),/Admit this fixture task/)
 assert.match(view!.root.findByType('pre').children.join(''),/"network": false/)
 const original=await client.read(project,first)
 await act(async()=>button('Approve reviewed task')!.props.onClick())
 await until(()=>!button('Approve reviewed task')&&JSON.stringify(view!.toJSON()).includes('queued'))
 const reopened=new RunApprovalReviewClient(base,()=> 'approval-reviewer',token('approval-reviewer'))
 assert.equal((await reopened.read(project,first)).status,'queued')
 await assert.rejects(reopened.approve(project,first,original.review_digest))
 await mount(second)
 await act(async()=>button('Review task for approval')!.props.onClick())
 await until(()=>Boolean(button('Approve reviewed task')))
 const revoked=await fetch(`${base}/api/v2/projects/${project}/members`,{method:'PUT',headers:{Authorization:`Bearer ${token('approval-owner')}`,'Content-Type':'application/json'},body:JSON.stringify({subject:'approval-reviewer',role:'auditor'})})
 assert.equal(revoked.status,200)
 await act(async()=>button('Approve reviewed task')!.props.onClick())
 await until(()=>JSON.stringify(view!.toJSON()).includes('Reload the review'))
 assert.equal(button('Approve reviewed task'),undefined)
 assert.equal((await reopened.read(project,second)).status,'awaiting_approval')
 await act(async()=>button('Review task for approval')!.props.onClick())
 await until(()=>JSON.stringify(view!.toJSON()).includes('your current role cannot approve'))
 assert.equal(button('Approve reviewed task'),undefined)
 writeFileSync(output,JSON.stringify({schema_version:'opensaddle.live-run-approval-proof.v1',project_id:project,run_ids:[first,second],checks:['auditor read-only and grant denied','cross-Project review denied','mounted host shows exact task/policy','explicit host approval reaches real Core','recreated client sees durable queued state','duplicate grant rejected','role revoked after display denies submission','host clears stale review and removes approval control','second task remains awaiting approval'],transport:'real HTTP to isolated loopback Core with fixture bearer authentication',limits:['No visual browser proof','No worker/model execution','Development identity only','Database restart proof recorded separately']},null,2)+'\n')
}finally{if(view)await act(async()=>view!.unmount())}
