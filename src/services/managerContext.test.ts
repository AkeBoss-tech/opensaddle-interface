import assert from 'node:assert/strict'
import test from 'node:test'
import {ManagerContextClient} from './managerContext'
const response=(ids=['A'])=>({schema_version:'opensaddle.manager-context.v1',generated_at:'2026-09-10T10:00:00Z',project_ids:ids,projects:ids.map(project_id=>({project_id,status:'active',objective:null,next_action:null})),active_runs:[],outcomes:[],attention_items:[],truncated:{active_runs:false,outcomes:false,attention_items:false},execution_authority:false})
test('manager client sends exact selection and rejects broadened or unbounded projections',async t=>{
 let value:any=response(),body=''
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{body=String(init.body);return Response.json(value)})
 const client=new ManagerContextClient('http://fixture',()=> 'owner')
 assert.deepEqual((await client.preview(['A'])).project_ids,['A'])
 assert.deepEqual(JSON.parse(body),{project_ids:['A']})
 for(const invalid of [{...response(),project_ids:['A','B']},{...response(),active_runs:[{project_id:'B',run_id:'R',task:'private',status:'running'}]},{...response(),projects:[{project_id:'A',status:'active',objective:'x'.repeat(1001),next_action:null}]},{...response(),execution_authority:true},{...response(),credentials:'secret'}]){
  value=invalid;await assert.rejects(client.preview(['A']),/out-of-scope/)
 }
 await assert.rejects(client.preview([]),/Choose/)
 await assert.rejects(client.preview(['A','A']),/Choose/)
})
test('manager client rejects an old account response',async t=>{
 let user='first',release!:(value:Response)=>void
 t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>{release=resolve}))
 const client=new ManagerContextClient('http://fixture',()=>user),pending=client.preview(['A'])
 user='second';release(Response.json(response()))
 await assert.rejects(pending,/account changed/)
})
