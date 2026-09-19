import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash}from'node:crypto'
import{CodingResultReviewClient}from'./codingResultReview'
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const spec={allowed_paths:['file.py'],schema_version:'opensaddle.coding-task.v1',verification_commands:[['python','-m','pytest']]}
const specDigest=hash(JSON.stringify(spec))
const run={project_id:'P',run_id:'run',policy:{obligations:{coding_task:spec,coding_task_digest:specDigest,coding_task_source_revision:'a'.repeat(40)}}}
const patch='--- file.py\n+++ file.py\n-old\n+new\n'
const manifest={schema_version:'opensaddle.coding-result.v1',project_id:'P',run_id:'run',source_revision:'a'.repeat(40),task_spec_digest:specDigest,execution_status:'completed',checks_status:'passed',patch:{format:'unified-diff',text:patch,sha256:hash(patch)},checks:[{argv:['python','-m','pytest'],exit_code:0,stdout:'1 passed',stderr:'',timed_out:false}],limitations:['Trusted-local execution']}
const bytes=JSON.stringify(manifest),artifactDigest=hash(bytes)
const record={schema_version:'opensaddle.coding-result-review.v1',project_id:'P',run_id:'run',artifact_id:'artifact',artifact_digest:artifactDigest,review:null}
test('coding review reads actual digest-verified artifact and submits exact human decision preconditions',async()=>{
 const original=globalThis.fetch;let body:unknown
 globalThis.fetch=async(input,init)=>{const path=new URL(String(input)).pathname;if(init?.method==='POST'){body=JSON.parse(String(init.body));return Response.json(record)}return path.endsWith('/runs/run')?Response.json(run):path.endsWith('/content')?new Response(bytes,{headers:{'Content-Type':'application/json'}}):Response.json(record)}
 try{const client=new CodingResultReviewClient('https://core.example',()=> 'owner','token'),value=await client.read('P','run');assert.equal(value.patch,patch);assert.equal(value.checks[0].stdout,'1 passed');assert.equal(value.review,null);await client.decide(value,'accepted','review-intent');assert.deepEqual(body,{artifact_id:'artifact',expected_artifact_digest:artifactDigest,decision:'accepted',idempotency_key:'review-intent'})}finally{globalThis.fetch=original}
})
test('tampered actual artifact bytes and substituted metadata fail closed',async()=>{
 const original=globalThis.fetch;try{const client=new CodingResultReviewClient('https://core.example',()=> 'owner');globalThis.fetch=async(input)=>String(input).endsWith('/content')?new Response(bytes+' '):Response.json(record);await assert.rejects(client.read('P','run'),/digest|integrity/);globalThis.fetch=async()=>Response.json({...record,project_id:'Q'});await assert.rejects(client.read('P','run'),/identity/)}finally{globalThis.fetch=original}
})

test('coding manifest cannot claim checks passed or substitute admitted arguments',async()=>{
 const original=globalThis.fetch
 try{
  const client=new CodingResultReviewClient('https://core.example',()=> 'owner')
  const wrong=JSON.stringify({...manifest,checks:[{...manifest.checks[0],exit_code:1}]})
  globalThis.fetch=async(input)=>String(input).endsWith('/content')?new Response(wrong):Response.json({...record,artifact_digest:hash(wrong)})
  await assert.rejects(client.read('P','run'),/claims passing checks/)
  globalThis.fetch=async(input)=>String(input).endsWith('/content')?new Response(bytes):String(input).endsWith('/runs/run')?Response.json({...run,policy:{obligations:{...run.policy.obligations,coding_task:{...spec,allowed_paths:['other.py']}}}}):Response.json(record)
  await assert.rejects(client.read('P','run'),/exact admitted arguments/)
 }finally{globalThis.fetch=original}
})

test('passing verification requires every admitted argv in exact order',async()=>{
 const original=globalThis.fetch
 try{
  const client=new CodingResultReviewClient('https://core.example',()=> 'owner')
  for(const checks of [[{...manifest.checks[0],argv:['true']}],[]]){
   const changed=JSON.stringify({...manifest,checks})
   globalThis.fetch=async(input)=>String(input).endsWith('/content')?new Response(changed):String(input).endsWith('/runs/run')?Response.json(run):Response.json({...record,artifact_digest:hash(changed)})
   await assert.rejects(client.read('P','run'),/check receipts|passing checks/)
  }
 }finally{globalThis.fetch=original}
})
