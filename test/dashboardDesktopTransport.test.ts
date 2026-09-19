import assert from 'node:assert/strict'
import test from 'node:test'
import {DashboardSettingsClient} from '../src/services/dashboardSettings'
import {installPersonalRuntimeTransport} from '../src/services/personalRuntimeTransport'
import {proxyPersonalRuntimeRequest} from '../electron/personalRuntimeProxy'

// DESKTOP-DASHBOARD-1: advertised dashboard read/save cross the adopted IPC boundary.
test('desktop dashboard reads, saves and reports conflicts without widening routes',async()=>{
 const originalFetch=globalThis.fetch,originalWindow=(globalThis as any).window
 const handoff={baseUrl:'http://127.0.0.1:8766/',installationId:'install',ownerSubject:'owner',projectId:'project',bearerToken:'private-token',adoptionSocket:'/private/p.sock',ipcDir:'/private'}
 let layout={schema_version:'opensaddle.dashboard-layout.v1',owner_subject:'owner',revision:0,widgets:['objective','attention','runs','projects','outcomes']},requests=0
 const server:typeof fetch=async(input,init)=>{
  requests++;const request=new Request(input,init)
  assert.equal(new URL(request.url).pathname,'/api/v2/settings/dashboard')
  assert.equal(request.headers.get('Authorization'),'Bearer private-token')
  assert.equal(request.headers.get('X-OpenSaddle-User'),'owner')
  if(request.method==='PUT'){
   const body=await request.json() as {expected_revision:number;widgets:string[]}
   if(body.expected_revision!==layout.revision)return Response.json({detail:'conflict'},{status:409})
   layout={...layout,revision:layout.revision+1,widgets:body.widgets}
  }else assert.equal(request.method,'GET')
  return Response.json(layout)
 }
 ;(globalThis as any).window={opensaddle:{personalRuntimeRequest:(request:unknown)=>proxyPersonalRuntimeRequest(handoff,request,server)}}
 try{
  installPersonalRuntimeTransport(handoff)
  const client=new DashboardSettingsClient(handoff.baseUrl,()=> 'owner')
  await assert.doesNotReject(()=>client.read(),'advertised dashboard read must cross desktop IPC')
  assert.deepEqual((await client.replace(0,['projects','outcomes'])).widgets,['projects','outcomes'])
  assert.equal((await client.read()).revision,1)
  await assert.rejects(client.replace(0,['runs']),/changed elsewhere/)
  const count=requests
  for(const [method,path] of [['POST','/api/v2/settings/dashboard'],['GET','/api/v2/settings/dashboard?owner=other'],['PUT','/api/v2/settings/dashboard/reset']] as const){
   await assert.rejects(proxyPersonalRuntimeRequest(handoff,{method,path,expectedBaseUrl:handoff.baseUrl,expectedInstallationId:handoff.installationId,expectedProjectId:handoff.projectId},server),/path/)
  }
  assert.equal(requests,count,'neighboring routes must not reach the server')
 }finally{globalThis.fetch=originalFetch;(globalThis as any).window=originalWindow}
})
