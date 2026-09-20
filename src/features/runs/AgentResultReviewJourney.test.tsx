import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {createHash} from 'node:crypto'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {AuthoritativeRunSurface,type AuthoritativeRunAuthority} from './AuthoritativeRunSurface'
import {AgentResultReviewClient} from '../../services/agentResultReview'
import {RemoteJourneyClient} from '../../services/remoteJourney'

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const target='ORBIT-7E42. This is the reviewed answer.'
const decoy='Earlier artifact, not the final native agent result.'
const targetDigest=createHash('sha256').update(target).digest('hex')
const decoyDigest=createHash('sha256').update(decoy).digest('hex')
const flush=()=>new Promise(resolve=>setTimeout(resolve,30))
async function untilRendered(view:ReactTestRenderer,pattern:RegExp){for(let attempt=0;attempt<20;attempt++){if(pattern.test(JSON.stringify(view.toJSON())))return;await act(async()=>{await flush()})}assert.match(JSON.stringify(view.toJSON()),pattern)}
const run:AuthoritativeRunAuthority={runDetail:async()=>({runId:'run_accepted',projectId:'P',task:'Read the README',status:'completed',cancellationRequested:false,canCancel:false,codingTask:false,agentResultTask:true})}
const envelope=(revision=0,decision?:'accepted'|'rejected')=>({schema_version:'opensaddle.agent-result-review.v1',scope:'historical_run_result_only',project_id:'P',run_id:'run_accepted',artifact_id:'art_final',artifact_digest:targetDigest,review_revision:revision,can_review:true,review:decision?{review_id:'arr_1',artifact_id:'art_final',artifact_digest:targetDigest,revision,decision,note:'',reviewed_by:'owner',reviewed_at:'2026-09-19T23:00:00Z',is_current:true}:null})
function click(view:ReactTestRenderer,name:string){const button=view.root.findAllByType('button').find(node=>node.children.join('')===name);assert.ok(button,`missing ${name}`);button.props.onClick()}

test('normal task reviews only Core final artifact, then reloads persisted human decision',async()=>{
  const original=globalThis.fetch;let revision=0,decision:'accepted'|'rejected'|undefined,posts=0,view:ReactTestRenderer|undefined
  globalThis.fetch=async(input,init)=>{
    const path=new URL(String(input)).pathname
    if(path.endsWith('/agent-result/review')){
      if(init?.method==='POST'){
        const body=JSON.parse(String(init.body)) as Record<string,unknown>
        assert.deepEqual(body,{artifact_id:'art_final',expected_artifact_digest:targetDigest,decision:body.decision,expected_review_revision:revision,idempotency_key:body.idempotency_key})
        assert.match(String(body.idempotency_key),/^[0-9a-f-]{36}$/)
        posts++;revision++;decision=body.decision as 'accepted'|'rejected'
      }
      return Response.json(envelope(revision,decision))
    }
    if(path.endsWith('/artifacts'))return Response.json({run_id:'run_accepted',artifacts:[{artifact_id:'art_decoy',content_digest:decoyDigest},{artifact_id:'art_final',content_digest:targetDigest}]})
    if(path.endsWith('/art_final/content'))return new Response(target)
    if(path.endsWith('/art_decoy/content'))return new Response(decoy)
    throw Error(`unexpected path ${path}`)
  }
  try{
    const client=new AgentResultReviewClient('https://core.example',()=> 'owner')
    await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={run} agentResultReview={client} projectId="P" runId="run_accepted"/></MemoryRouter>);await flush()})
    await untilRendered(view!,/ORBIT-7E42/)
    assert.doesNotMatch(JSON.stringify(view!.toJSON()),/Earlier artifact/)
    assert.equal(view!.root.findAllByProps({className:'task-result-json'}).length,0)
    assert.equal(view!.root.findAllByType('pre')[0]?.children.join(''),target)
    await act(async()=>{click(view!,'Accept result');await flush()})
    await untilRendered(view!,/ORBIT-7E42/)
    assert.equal(posts,1)
    assert.match(JSON.stringify(view!.toJSON()),/accepted by owner/)
    await act(async()=>{view!.unmount();view=create(<MemoryRouter><AuthoritativeRunSurface authority={run} agentResultReview={client} projectId="P" runId="run_accepted"/></MemoryRouter>);await flush()})
    await untilRendered(view!,/ORBIT-7E42/)
    assert.match(JSON.stringify(view!.toJSON()),/accepted by owner/)
    assert.equal(posts,1)
    await act(async()=>{click(view!,'Revise decision');await flush()})
    assert.match(JSON.stringify(view!.toJSON()),/A new decision will replace the current one/)
    await act(async()=>{click(view!,'Request changes');await flush()})
    await untilRendered(view!,/rejected by owner/)
    assert.equal(posts,2)
  }finally{if(view)await act(async()=>view!.unmount());globalThis.fetch=original}
})

test('JSON agent result is indented in a bounded text block while exact bytes remain available',async()=>{
  const original=globalThis.fetch,content=JSON.stringify({repository:{full_name:'modelcontextprotocol/python-sdk',visibility:'public'},reviewed:true})
  const contentDigest=createHash('sha256').update(content).digest('hex')
  let view:ReactTestRenderer|undefined
  globalThis.fetch=async input=>{
    const path=new URL(String(input)).pathname
    if(path.endsWith('/agent-result/review'))return Response.json({...envelope(),artifact_digest:contentDigest})
    if(path.endsWith('/art_final/content'))return new Response(content)
    throw Error(`unexpected path ${path}`)
  }
  try{
    const client=new AgentResultReviewClient('https://core.example',()=> 'owner')
    await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={run} agentResultReview={client} projectId="P" runId="run_accepted"/></MemoryRouter>);await flush()})
    await untilRendered(view!,/modelcontextprotocol\/python-sdk/)
    const pretty=view!.root.findByProps({className:'task-result-json'})
    assert.equal(pretty.type,'pre')
    assert.equal(pretty.children.join(''),JSON.stringify(JSON.parse(content),null,2))
    assert.equal(view!.root.findByProps({className:'task-result-source'}).children.join(''),content)
    assert.doesNotMatch(JSON.stringify(view!.toJSON()),/Execution ended; this does not imply verification or human acceptance/)
  }finally{if(view)await act(async()=>view!.unmount());globalThis.fetch=original}
})

test('lost decision acknowledgement never auto-reposts; explicit retry reuses the same intent',async()=>{
  const original=globalThis.fetch;let revision=0,decision:'accepted'|'rejected'|undefined,posts:string[]=[],view:ReactTestRenderer|undefined
  globalThis.fetch=async(input,init)=>{
    const path=new URL(String(input)).pathname
    if(path.endsWith('/agent-result/review')){
      if(init?.method==='POST'){
        const body=JSON.parse(String(init.body)) as Record<string,unknown>
        posts.push(String(body.idempotency_key))
        if(posts.length===1)throw Error('lost acknowledgement')
        revision=1;decision='rejected'
      }
      return Response.json(envelope(revision,decision))
    }
    if(path.endsWith('/art_final/content'))return new Response(target)
    throw Error(`unexpected path ${path}`)
  }
  try{
    const client=new AgentResultReviewClient('https://core.example',()=> 'owner')
    await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={run} agentResultReview={client} projectId="P" runId="run_accepted"/></MemoryRouter>);await flush()})
    await act(async()=>{await flush()})
    await act(async()=>{click(view!,'Request changes');await flush()})
    assert.equal(posts.length,1)
    assert.match(JSON.stringify(view!.toJSON()),/Decision outcome is not confirmed/)
    await act(async()=>{click(view!,'Check exact result and decision');await flush()})
    assert.equal(posts.length,1)
    await act(async()=>{click(view!,'Retry the same decision request');await flush()})
    await act(async()=>{await flush()})
    assert.deepEqual(posts,[posts[0],posts[0]])
    assert.match(JSON.stringify(view!.toJSON()),/rejected by owner/)
  }finally{if(view)await act(async()=>view!.unmount());globalThis.fetch=original}
})

test('current authority loss removes already displayed artifact bytes and decision controls',async()=>{
  const original=globalThis.fetch;let revoked=false,view:ReactTestRenderer|undefined
  globalThis.fetch=async input=>{
    const path=new URL(String(input)).pathname
    if(path.endsWith('/agent-result/review'))return revoked?Response.json({detail:'forbidden'},{status:403}):Response.json(envelope())
    if(path.endsWith('/art_final/content'))return new Response(target)
    throw Error(`unexpected path ${path}`)
  }
  try{
    const client=new AgentResultReviewClient('https://core.example',()=> 'owner')
    await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={run} agentResultReview={client} projectId="P" runId="run_accepted"/></MemoryRouter>);await flush()})
    await untilRendered(view!,/ORBIT-7E42/)
    revoked=true
    await act(async()=>{click(view!,'Check exact result and decision');await flush()})
    const rendered=JSON.stringify(view!.toJSON())
    assert.doesNotMatch(rendered,/ORBIT-7E42/)
    assert.doesNotMatch(rendered,/Accept result/)
    assert.match(rendered,/review unavailable \(403\)/)
  }finally{if(view)await act(async()=>view!.unmount());globalThis.fetch=original}
})

test('background authority check keeps readable bytes while pending, then removes them on denial',async()=>{
  const originalFetch=globalThis.fetch,originalInterval=globalThis.setInterval
  let backgroundTick:(()=>void)|undefined,hold=false,release:((response:Response)=>void)|undefined,view:ReactTestRenderer|undefined
  globalThis.setInterval=((callback:()=>void,delay?:number)=>{if(delay===5000)backgroundTick=callback;return originalInterval(callback,delay)}) as typeof setInterval
  globalThis.fetch=async input=>{
    const path=new URL(String(input)).pathname
    if(path.endsWith('/agent-result/review'))return hold?new Promise<Response>(resolve=>{release=resolve}):Response.json(envelope())
    if(path.endsWith('/art_final/content'))return new Response(target)
    throw Error(`unexpected path ${path}`)
  }
  try{
    const client=new AgentResultReviewClient('https://core.example',()=> 'owner')
    await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={run} agentResultReview={client} projectId="P" runId="run_accepted"/></MemoryRouter>);await flush()})
    await untilRendered(view!,/ORBIT-7E42/)
    assert.ok(backgroundTick)
    hold=true
    await act(async()=>{backgroundTick!();await flush()})
    assert.ok(release)
    assert.match(JSON.stringify(view!.toJSON()),/ORBIT-7E42/)
    await act(async()=>{release!(Response.json({detail:'forbidden'},{status:403}));await flush()})
    const rendered=JSON.stringify(view!.toJSON())
    assert.doesNotMatch(rendered,/ORBIT-7E42|Accept result/)
    assert.match(rendered,/review unavailable \(403\)/)
  }finally{if(view)await act(async()=>view!.unmount());globalThis.fetch=originalFetch;globalThis.setInterval=originalInterval}
})

test('a changed exact review target during artifact read is never offered for human decision',async()=>{
  const original=globalThis.fetch;let reads=0,view:ReactTestRenderer|undefined
  globalThis.fetch=async input=>{
    const path=new URL(String(input)).pathname
    if(path.endsWith('/agent-result/review'))return Response.json({...envelope(),artifact_digest:++reads===1?targetDigest:decoyDigest})
    if(path.endsWith('/art_final/content'))return new Response(target)
    throw Error(`unexpected path ${path}`)
  }
  try{
    const client=new AgentResultReviewClient('https://core.example',()=> 'owner')
    await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={run} agentResultReview={client} projectId="P" runId="run_accepted"/></MemoryRouter>);await flush()})
    await untilRendered(view!,/changed during read/)
    const rendered=JSON.stringify(view!.toJSON())
    assert.doesNotMatch(rendered,/ORBIT-7E42/)
    assert.doesNotMatch(rendered,/Accept result/)
  }finally{if(view)await act(async()=>view!.unmount());globalThis.fetch=original}
})

test('advertised review feature leaves an ordinary completed non-agent result readable',async()=>{
  const original=globalThis.fetch;let reviewGets=0,view:ReactTestRenderer|undefined
  globalThis.fetch=async input=>{
    const path=new URL(String(input)).pathname
    if(path.endsWith('/agent-result/review')){reviewGets++;return Response.json({detail:'not generic agent'},{status:409})}
    if(path.endsWith('/members'))return Response.json({project_id:'P',members:[{subject:'owner',status:'active',role:'owner'}]})
    if(path.endsWith('/artifacts'))return Response.json({run_id:'run_accepted',artifacts:[{artifact_id:'art_final',content_digest:targetDigest}]})
    if(path.endsWith('/art_final/content'))return new Response(target)
    if(path.endsWith('/runs/run_accepted'))return Response.json({run_id:'run_accepted',project_id:'P',task:'Read the README',status:'completed',requested_by:'owner',cancellation_requested:false,policy:{obligations:{}}})
    throw Error(`unexpected path ${path}`)
  }
  try{
    const authority=new RemoteJourneyClient('https://core.example',()=> 'owner')
    const review=new AgentResultReviewClient('https://core.example',()=> 'owner')
    await act(async()=>{view=create(<MemoryRouter><AuthoritativeRunSurface authority={authority} agentResultReview={review} projectId="P" runId="run_accepted"/></MemoryRouter>);await flush()})
    await act(async()=>{await flush()})
    assert.match(JSON.stringify(view!.toJSON()),/ORBIT-7E42/)
    assert.equal(reviewGets,0)
    assert.doesNotMatch(JSON.stringify(view!.toJSON()),/Accept result/)
  }finally{if(view)await act(async()=>view!.unmount());globalThis.fetch=original}
})
