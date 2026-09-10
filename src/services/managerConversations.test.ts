import assert from 'node:assert/strict'
import test from 'node:test'
import {ManagerConversationsClient} from './managerConversations'
test('manager intent creation cannot submit after account changes',async t=>{
 let user='one',requests=0
 t.mock.method(globalThis,'fetch',async()=>{requests++;throw Error('must not submit')})
 const client=new ManagerConversationsClient('http://fixture',()=>user)
 const pending=client.create('Private title',['A']);user='two'
 await assert.rejects(pending,/account changed/)
 assert.equal(requests,0)
})
test('empty conversation pages cannot loop forever on repeated cursors',async t=>{
 let requests=0
 t.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json({items:[],next_cursor:'again'})})
 await assert.rejects(new ManagerConversationsClient('http://fixture',()=> 'one').list(),/page limits/)
 assert.equal(requests,2)
})
