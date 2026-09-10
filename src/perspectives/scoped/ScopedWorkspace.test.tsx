import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {MemoryRouter} from 'react-router-dom'
import {ScopedWorkspace} from './ScopedWorkspace'
import {ScopedRendererClient} from '../../services/scopedRenderers'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const flush=()=>new Promise(resolve=>setImmediate(resolve))
// SCOPED-WORKSPACE-CONNECTION-1: fallback belongs to a server/account/Team.
test('an unavailable view on one server does not suppress the same account view on another',async t=>{
 const scope={kind:'user',id:'owner'}, hash='a'.repeat(64)
 const ref={package_id:'view',version:'1.0.0',manifest_digest:hash}
 const environment={schema_version:'opensaddle.scoped-environment.v1',scope,viewer_subject:'owner',revision:1,definition_digest:hash,definition:{commands:[],bindings:[],services:[],applications:[{application_id:'home',package_ref:ref}]}}
 const candidate={application_id:'home',package_id:'view',package_version:'1.0.0',manifest_digest:hash,title:'Second server view',available:{available:true},enablement:{status:'enabled',version:'1.0.0'},content_digest:hash,size_bytes:10,environment_application:{instances:[{instance_id:'home-1'}]},descriptor:{ui_contract:{schema_version:'opensaddle.ui-contract.v1',scope:'user',mount_kind:'perspective',host_api_min:1,host_api_max:1,required_capabilities:[]}}}
 const requests:string[]=[]
 t.mock.method(globalThis,'fetch',async(input:any)=>{
  const url=new URL(String(input));requests.push(url.href)
  if(url.pathname.endsWith('/environment'))return Response.json(environment)
  if(url.pathname.endsWith('/application-renderer-candidates'))return Response.json({schema_version:'opensaddle.scoped-renderer-candidates.v1',scope,activation_supported:true,items:url.hostname==='first.test'?[]:[candidate]})
  // Keep external content delivery pending so the actual host stays loading.
  if(url.pathname.endsWith('/environment/content'))return new Promise<Response>(()=>{})
  throw Error('Unexpected request: '+url.pathname)
 })
 const events=new EventTarget()
 const previousAdd=globalThis.addEventListener, previousRemove=globalThis.removeEventListener
 globalThis.addEventListener=events.addEventListener.bind(events) as typeof addEventListener
 globalThis.removeEventListener=events.removeEventListener.bind(events) as typeof removeEventListener
 let view!:ReactTestRenderer
 const render=(base:string)=><MemoryRouter><ScopedWorkspace client={new ScopedRendererClient(base,()=> 'owner')}><p>Default content</p></ScopedWorkspace></MemoryRouter>
 try {
  await act(async()=>{view=create(render('http://first.test'));await flush()})
  assert.match(JSON.stringify(view.toJSON()),/Retry selected view/)
  await act(async()=>{view.update(render('http://second.test'));await flush()})
  assert.equal(view.root.findAllByProps({'aria-label':'Selected scoped view'}).length,1,'new server must mount its selected view without inheriting previous fallback')
  assert.match(JSON.stringify(view.toJSON()),/Second server view/)
  assert.ok(requests.some(url=>url.startsWith('http://second.test/api/v2/me/environment/content')))
 } finally {
  if(view)await act(async()=>view.unmount())
  globalThis.addEventListener=previousAdd;globalThis.removeEventListener=previousRemove
 }
})
