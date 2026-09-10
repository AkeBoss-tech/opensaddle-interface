import test from 'node:test'
import assert from 'node:assert/strict'
import {ProjectTaskFeedClient} from './projectTaskFeed'
test('Project task client pages without global or administrative reads and fences identity',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let user='member',change=false,reads=0
 globalThis.fetch=async input=>{const url=new URL(String(input));assert.equal(url.pathname,'/api/v2/projects/P/task-feed');reads++;if(change)user='other';return Response.json({schema_version:'opensaddle.project-task-feed.v1',project_id:'P',items:[{id:url.searchParams.get('after')?'b':'a',title:'Scoped task',status:'running',verification:'not_assessed'}],next_cursor:url.searchParams.get('after')?null:'a'})}
 const client=new ProjectTaskFeedClient('http://core',()=>user);assert.deepEqual((await client.read('P')).tasks.map(item=>item.id),['a','b']);assert.equal(reads,3)
 change=true;await assert.rejects(client.read('P'),/Invalid Project task feed/)
})
