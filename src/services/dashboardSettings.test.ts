import assert from 'node:assert/strict'
import test from 'node:test'
import {DashboardSettingsClient} from './dashboardSettings'

test('dashboard client fences changed account and validates response layout',async t=>{
 let user='one',release!:(response:Response)=>void
 t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>{release=resolve}))
 const client=new DashboardSettingsClient('http://fixture',()=>user)
 const pending=client.read();user='two'
 release(Response.json({schema_version:'opensaddle.dashboard-layout.v1',owner_subject:'one',revision:1,widgets:['projects']}))
 await assert.rejects(pending,/account changed/)
 t.mock.method(globalThis,'fetch',async()=>Response.json({schema_version:'opensaddle.dashboard-layout.v1',owner_subject:'two',revision:1,widgets:['runs','runs']}))
 await assert.rejects(client.read(),/Invalid dashboard/)
 t.mock.method(globalThis,'fetch',async()=>new Response('',{status:409}))
 await assert.rejects(client.replace(1,['projects']),/draft is preserved/)
})
