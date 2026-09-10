import assert from 'node:assert/strict'
import test from 'node:test'
import { proxyPersonalRuntimeRequest } from '../electron/personalRuntimeProxy'

test('scoped lifecycle crosses desktop transport with report credentials restricted to observations', async () => {
 const previousFetch=globalThis.fetch, previousWindow=globalThis.window
 const identity={baseUrl:'http://127.0.0.1:8766/',installationId:'install',projectId:'project',ownerSubject:'owner'}
 const handoff={...identity,bearerToken:'private-owner',adoptionSocket:'/private/socket',ipcDir:'/private'}
 const received:Request[]=[]
 const server:typeof fetch=async(input,init)=>{const request=new Request(input,init);received.push(request);return Response.json({ok:true})}
 ;(globalThis as any).window={opensaddle:{personalRuntimeRequest:(request:unknown)=>proxyPersonalRuntimeRequest(handoff,request,server)}}
 try {
  const {installPersonalRuntimeTransport}=await import('../src/services/personalRuntimeTransport')
  installPersonalRuntimeTransport(identity)
  for(const root of ['/api/v2/me','/api/v2/teams/team-one']) {
   await assert.doesNotReject(fetch(identity.baseUrl.slice(0,-1)+root+'/environment'),'scoped environment must cross desktop transport')
   for(const suffix of ['/application-renderer-candidates','/environment/content?'+new URLSearchParams({package_id:'dev.example',version:'1.0.0',manifest_digest:'a'.repeat(64),application_id:'view',environment_revision:'1',environment_digest:'b'.repeat(64),content_digest:'c'.repeat(64)})])await fetch(identity.baseUrl.slice(0,-1)+root+suffix)
   for(const suffix of ['/application-renderer-candidates/dev.example/enable','/application-renderer-candidates/dev.example/disable','/environment/selection','/renderer-host-sessions'])await fetch(identity.baseUrl.slice(0,-1)+root+suffix,{method:'POST',body:'{}'})
   await fetch(identity.baseUrl.slice(0,-1)+root+'/renderer-host-sessions/host-one/observations',{method:'POST',headers:{'X-OpenSaddle-Renderer-Host-Token':'report-proof'},body:'{"sequence":1,"state":"ready"}'})
   assert.equal(received.at(-1)?.headers.get('X-OpenSaddle-Renderer-Host-Token'),'report-proof')
   assert.equal(received.at(-1)?.headers.get('Authorization'),'Bearer private-owner')
  }
  const count=received.length
  for(const suffix of ['/environment','/renderer-host-sessions'])await assert.rejects(fetch(identity.baseUrl+'api/v2/me'+suffix,{method:'POST',headers:{'X-OpenSaddle-Renderer-Host-Token':'report-proof'},body:'{}'}))
  await assert.rejects(fetch(identity.baseUrl+'api/v2/me/renderer-host-sessions/host-one/observations',{method:'POST',body:'{}'}),/token/)
  await assert.rejects(fetch(identity.baseUrl+'api/v2/me/environment/content?package_id=anything'),/path/)
  assert.equal(received.length,count)
 } finally {globalThis.fetch=previousFetch;(globalThis as any).window=previousWindow}
})
