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
 try {
 assert.match(JSON.stringify(view.toJSON()),/Fix actual bug/);assert.doesNotMatch(JSON.stringify(view.toJSON()),/No local runs yet/)
 await act(async()=>{button(view,'Request cancellation').props.onClick();button(view,'Request cancellation').props.onClick();await flush()})
 assert.equal(requests,1);assert.match(JSON.stringify(view.toJSON()),/Cancellation requested/);assert.doesNotMatch(JSON.stringify(view.toJSON()),/Cancellation acknowledged/)
 status='cancelled'
 await act(async()=>{button(view,'Refresh task status').props.onClick();await flush()})
 assert.match(JSON.stringify(view.toJSON()),/Cancellation acknowledged/)
 assert.match(JSON.stringify(view.toJSON()),/Previously dispatched effects may still have occurred/)
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Run is stopped/)
 assert.match(view.root.findAllByType('a').find(node=>node.children.join('')==='Inspect result artifacts')!.props.href,/run=run-real.*project=P/)
 } finally {await act(async()=>view.unmount())}
 assert.equal(requests,1)
})
test('cancelled task shows its terminal state without treating absent result bytes as an access failure',async()=>{
 let reads=0
 const authority:AuthoritativeRunAuthority={runDetail:async()=>({...detail,status:'cancelled'}),review:async()=>{reads++;throw Error('no published result')}}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={authority} runId="run-real" projectId="P"/></MemoryRouter>);await flush()})
 try {
  assert.match(JSON.stringify(view.toJSON()),/Cancellation acknowledged/)
  assert.equal(reads,0)
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/The result is unavailable/)
 } finally { await act(async()=>view.unmount()) }
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

// PROJECT-TASK-JOURNEY-20260919: terminal result access is rechecked while visible.
test('completed task clears result and audit after Project access is revoked',async t=>{
 const originalInterval=globalThis.setInterval
 let poll:(()=>void)|undefined,denied=false
 globalThis.setInterval=((handler:Parameters<typeof setInterval>[0])=>{
  if(typeof handler==='function')poll=()=>handler()
  return 1 as unknown as ReturnType<typeof setInterval>
 }) as typeof setInterval
 t.after(()=>{globalThis.setInterval=originalInterval})
 const authority:AuthoritativeRunAuthority={
  runDetail:async()=>{if(denied)throw Error('Project access revoked');return {...detail,status:'completed'}},
  review:async()=>({runId:'run-real',resource:{artifact_id:'artifact-real',digest:'a'.repeat(64)},text:'PRIVATE PUBLISHED RESULT'}),
  connectorAudit:async()=>({runId:'run-real',projectId:'P',complete:true,items:[{sequence:1,timestamp:'2026-09-19T00:00:00Z',state:'completed'}]}),
 }
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={authority} runId="run-real" projectId="P"/></MemoryRouter>);await flush()})
 try {
  assert.match(JSON.stringify(view.toJSON()),/PRIVATE PUBLISHED RESULT/)
  await act(async()=>{button(view,'Inspect connector activity').props.onClick();await flush()})
  assert.match(JSON.stringify(view.toJSON()),/Audit stream ended/)
  denied=true
  await act(async()=>{poll?.();await flush()})
  assert.match(JSON.stringify(view.toJSON()),/Task unavailable.*Project access revoked/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/PRIVATE PUBLISHED RESULT|Audit stream ended|Fix actual bug/)
 } finally {await act(async()=>view.unmount())}
})

// PROJECT-TASK-JOURNEY-20260919: the heading uses Core's exact original task.
test('agent Run heading uses the authoritative user task and discloses execution instructions separately',async t=>{
 const {RemoteJourneyClient}=await import('../../services/remoteJourney')
 const original=globalThis.fetch
 t.after(()=>{globalThis.fetch=original})
 globalThis.fetch=async input=>{
  const path=new URL(String(input)).pathname
  if(path.endsWith('/members'))return Response.json({project_id:'P',members:[{subject:'owner',role:'owner',status:'active'}]})
  assert.equal(path,'/api/v2/runs/run-real')
  return Response.json({run_id:'run-real',project_id:'P',task:'REVIEWED PRIVATE INSTRUCTIONS: execute exact scope. USER TASK: Write a report.',
   user_task:'Write a report.',status:'running',requested_by:'owner',cancellation_requested:false,
   policy:{obligations:{agent_definition_digest:'a'.repeat(64)}}})
 }
 const authority=new RemoteJourneyClient('https://core.example',()=> 'owner')
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={authority} runId="run-real" projectId="P"/></MemoryRouter>);await flush()})
 try {
  const heading=view.root.findByType('h1')
  assert.equal(heading.children.join(''),'Write a report.')
  assert.equal(view.root.findAllByType('details').some(node=>node.findAllByType('summary').some(summary=>summary.children.join('')==='Execution instructions')),true)
 } finally {await act(async()=>view.unmount())}
})

// PROJECT-TASK-DETAIL: a Perspective cannot substitute another project's Run.
test('project task detail preserves workspace navigation and rejects cross-project details',async()=>{
 let wrong=false,cancels=0
 const authority:AuthoritativeRunAuthority={runDetail:async()=>({...detail,projectId:wrong?'OTHER':'P',task:wrong?'OTHER PRIVATE TASK':detail.task}),cancel:async()=>{cancels++}}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={authority} runId="run-real" projectId="P"/></MemoryRouter>);await flush()})
 assert.equal(view.root.findAllByType('a').find(node=>node.children.join('')==='Back to workspace')?.props.href,'/project/P')
 wrong=true
 await act(async()=>{button(view,'Refresh task status').props.onClick();await flush()})
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/OTHER PRIVATE TASK/)
 assert.match(JSON.stringify(view.toJSON()),/Task does not belong to this project/)
 assert.equal(view.root.findAllByType('button').some(node=>node.children.join('')==='Request cancellation'),false)
 assert.equal(cancels,0)
 await act(async()=>view.unmount())
})

test('project task detail rejects a substituted Run identity',async()=>{
 const authority:AuthoritativeRunAuthority={runDetail:async()=>({...detail,runId:'substituted',task:'SUBSTITUTED PRIVATE TASK'})}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={authority} runId="run-real" projectId="P"/></MemoryRouter>);await flush()})
 try {
  assert.doesNotMatch(JSON.stringify(view.toJSON()),/SUBSTITUTED PRIVATE TASK/)
  assert.match(JSON.stringify(view.toJSON()),/Task does not belong to this project/)
 } finally { await act(async()=>view.unmount()) }
})

test('Project task approval displays exact review and submits only the reviewed digest',async t=>{
 const {RunApprovalReviewClient}=await import('../../services/runApprovalReview')
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original})
 let status='awaiting_approval',canApprove=true,conflict=false,posts=0,digest='a'.repeat(64),user='approver'
 const calls:string[]=[]
 globalThis.fetch=async(input,options)=>{
  assert.equal(String(input),'http://core/api/v2/projects/P/runs/run-real/approval-review')
  assert.equal((options?.headers as Record<string,string>)['X-OpenSaddle-User'],user)
  calls.push(options?.method??'GET')
  if(options?.method==='POST'){
   posts++;assert.deepEqual(JSON.parse(options.body as string),{expected_review_digest:digest})
   if(conflict)return new Response(null,{status:409})
   status='queued';return Response.json({project_id:'P',run_id:'run-real',review_digest:digest,status,approval_scope:'run_admission',model_call_authorization:'not_granted'})
  }
  return Response.json({schema_version:'opensaddle.run-approval-review.v1',project_id:'P',run_id:'run-real',task:'Exact reviewed task',source_ref:'Exact source',requested_by:'requester',policy:{policy_hash:'policy-1',obligations:{network:false}},review_digest:digest,status,can_approve:canApprove,approval_scope:'run_admission',model_call_authorization:'not_granted'})
 }
 const client=new RunApprovalReviewClient('http://core',()=>user)
 const authority:AuthoritativeRunAuthority={runDetail:async()=>({...detail,status,canCancel:false})}
 let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={authority} runId="run-real" projectId="P" approvalReview={client}/></MemoryRouter>);await flush()})
 assert.ok(button(view,'Review task for approval'),'task page must expose authoritative approval review')
 assert.equal(button(view,'Approve reviewed task'),undefined);assert.equal(calls.length,0)
 await act(async()=>{button(view,'Review task for approval').props.onClick();await flush()})
 assert.match(JSON.stringify(view.toJSON()),/Exact reviewed task/);assert.match(JSON.stringify(view.toJSON()),/Exact source/)
 assert.match(view.root.findByType('pre').children.join(''),/"network": false/)
 conflict=true
 await act(async()=>{button(view,'Approve reviewed task').props.onClick();button(view,'Approve reviewed task').props.onClick();await flush()})
 assert.equal(posts,1);assert.equal(button(view,'Approve reviewed task'),undefined)
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Exact reviewed task/)
 assert.match(JSON.stringify(view.toJSON()),/Reload the review/)
 conflict=false;canApprove=false;digest='b'.repeat(64)
 await act(async()=>{button(view,'Review task for approval').props.onClick();await flush()})
 assert.equal(button(view,'Approve reviewed task'),undefined)
 canApprove=true
 await act(async()=>{button(view,'Reload approval review').props.onClick();await flush()})
 await act(async()=>{button(view,'Approve reviewed task').props.onClick();await flush()})
 assert.equal(posts,2);assert.equal(status,'queued');assert.equal(button(view,'Approve reviewed task'),undefined)
 assert.match(JSON.stringify(view.toJSON()),/queued/)
 globalThis.fetch=async()=>{user='other';return Response.json({project_id:'P',run_id:'run-real',review_digest:digest,status:'queued',approval_scope:'run_admission',model_call_authorization:'not_granted'})}
 await assert.rejects(client.approve('P','run-real',digest),/identity/)
})
