/** Actual signed resource renderer + Core HTTP; mounted DOM adapter, not browser proof. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import vm from 'node:vm'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {RemoteMalleableShellClient} from '../src/services/remoteMalleableShell'
import {ProjectTaskFeedClient} from '../src/services/projectTaskFeed'
import {InstalledProjectView} from '../src/perspectives/project/InstalledProjectView'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const [state,receipt]=process.argv.slice(2),m=JSON.parse(readFileSync(join(state,'fixture.json'),'utf8'))
assert.equal(m.fixture,'resource-perspective-v1');assert.equal(new URL(m.base_url).hostname,'127.0.0.1')
const member=readFileSync(join(state,'member.token'),'utf8'),owner=readFileSync(join(state,'owner.token'),'utf8')
const shell=new RemoteMalleableShellClient(m.base_url,()=> 'renderer-member',member)
const renderer=(await shell.applicationRenderers(m.project_id)).find(r=>r.application_id==='resource-dashboard')!
assert.ok(renderer);assert.equal(renderer.package_ref.manifest_digest,m.package_ref.manifest_digest)
const model=await new ProjectTaskFeedClient(m.base_url,()=> 'renderer-member',member).read(m.project_id)
const listeners=new Set<(event:any)=>void>(),handlers=new Map<string,((event:any)=>void)[]>(),messages:any[]=[]
const originalAdd=globalThis.addEventListener,originalRemove=globalThis.removeEventListener
Object.assign(globalThis,{addEventListener:(_:string,fn:any)=>listeners.add(fn),removeEventListener:(_:string,fn:any)=>listeners.delete(fn)})
const nodes:any={resources:{textContent:''},resync:{},stop:{},commands:{},artifacts:{},invoke:{},'command-result':{textContent:''}}
const dom={getElementById:(id:string)=>nodes[id]}
const source={postMessage:(data:any)=>{messages.push(data);for(const fn of handlers.get('message')??[])fn({source:parent,data})}}
const parent={postMessage:(data:any)=>{for(const fn of listeners)fn({source,data})}},node={contentWindow:source,dataset:{}}
const displayed=()=>{try{return JSON.parse(nodes.resources.textContent)}catch{return null}}
async function until(check:()=>boolean){for(let i=0;i<500&&!check();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50))});assert.ok(check(),'Live resource condition timed out')}
async function ownerRequest(path:string,body?:object,method='POST'){
 const r=await fetch(m.base_url+path,{method,headers:{Authorization:'Bearer '+owner,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,'Fixture owner operation '+path+' failed '+r.status);return r.json()
}
let view!:ReactTestRenderer
try{
 await act(async()=>{view=create(<InstalledProjectView client={shell} renderer={renderer} model={model} connectionKey="resource-member" onOpenTask={()=>{}} onNewTask={()=>{}}/>,{createNodeMock:()=>node})})
 await until(()=>view.root.findAllByType('iframe').length===1)
 const html=view.root.findByType('iframe').props.srcDoc
 const context=vm.createContext({document:dom,parent,addEventListener:(kind:string,fn:any)=>handlers.set(kind,[...(handlers.get(kind)??[]),fn])})
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(script[1],context)
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 await until(()=>Object.keys(displayed()?.snapshots??{}).length===3)
 assert.equal(displayed().snapshots.sources.items.length,1);assert.equal(displayed().snapshots.devices.items.length,0)
 assert.ok(displayed().snapshots.approvals.items.some((r:any)=>r.run_id===m.pending_run_id))
 console.log('Signed plugin displays all three real Core resource snapshots.')
 const reviewPath=`/api/v2/projects/${m.project_id}/runs/${m.pending_run_id}/approval-review`
 const review=await ownerRequest(reviewPath,undefined,'GET')
 await act(async()=>{await ownerRequest(reviewPath,{expected_review_digest:review.review_digest})})
 await until(()=>displayed().snapshots.approvals.items.length===0)
 await act(async()=>{await ownerRequest('/api/v2/sources',{project_id:m.project_id,source_kind:'connected_revision',revision:'fixture-v2',snapshot_digest:'b'.repeat(64)})})
 await until(()=>displayed().snapshots.sources.items.length===2)
 assert.equal(view.root.findByType('iframe').props.srcDoc,html)
 const before={...displayed().cursors}
 await act(async()=>nodes.resync.onclick())
 await until(()=>Object.keys(before).every(k=>displayed().cursors[k]>before[k]))
 console.log('Approval/source updates and explicit resync reached the same signed frame.')
 await act(async()=>nodes.stop.onclick())
 const stopped=JSON.stringify(displayed())
 await act(async()=>{await ownerRequest('/api/v2/sources',{project_id:m.project_id,source_kind:'connected_revision',revision:'fixture-v3',snapshot_digest:'c'.repeat(64)});await new Promise(resolve=>setTimeout(resolve,6000))})
 assert.equal(JSON.stringify(displayed()),stopped,'Unsubscribed plugin must not receive further snapshots')
 await act(async()=>nodes.commands.onclick())
 await until(()=>nodes['command-result'].textContent==='Review command ready')
 await act(async()=>nodes.artifacts.onclick())
 await until(()=>nodes['command-result'].textContent==='Exact artifact ready')
 await act(async()=>nodes.invoke.onclick())
 await until(()=>nodes['command-result'].textContent.includes('invocation_id'))
 const pluginReceipt=JSON.parse(nodes['command-result'].textContent)
 const descriptor=(await shell.commands(m.project_id)).find(d=>d.command_id===pluginReceipt.command_id)!
 const builtinReceipt=await shell.invoke(descriptor,pluginReceipt.resource,{})
 assert.equal(pluginReceipt.descriptor_digest,builtinReceipt.descriptor_digest)
 assert.deepEqual(pluginReceipt.resource,builtinReceipt.resource)
 assert.deepEqual(pluginReceipt.receipt,builtinReceipt.receipt)
 const persisted=await new RemoteMalleableShellClient(m.base_url,()=> 'renderer-member',member).invocation(pluginReceipt.invocation_id)
 assert.equal(persisted.invocation_id,pluginReceipt.invocation_id);assert.deepEqual(persisted.receipt,pluginReceipt.receipt)
 console.log('Signed command and built-in client share exact descriptor, resource and receipt semantics.')
 await ownerRequest(`/api/v2/runs/${m.pending_run_id}/cancel`)
 await act(async()=>{await ownerRequest(`/api/v2/projects/${m.project_id}/environment/changes`,{expected_revision:m.environment_revision,definition:{commands:[],bindings:[],services:[],packages:[],applications:[]},reason:'finish disposable resource subscription proof'})})
 await until(()=>view.root.findAllByType('iframe').length===0)
 const resources=messages.filter(v=>v.kind==='resources'&&v.subscription_id)
 assert.ok(resources.every(v=>v.projection.project_id===m.project_id));assert.doesNotMatch(JSON.stringify(messages),new RegExp(member+'|'+owner))
 writeFileSync(receipt,JSON.stringify({schema_version:'opensaddle.resource-subscriptions-live-proof.v1',package_ref:renderer.package_ref,content_digest:renderer.content_digest,command_proof:{plugin:pluginReceipt,builtin_invocation_id:builtinReceipt.invocation_id,persisted_readback:true},project_id:m.project_id,resource_messages:resources.map(v=>({subscription:v.subscription_id,cursor:v.cursor,items:v.projection.items.length})),checks:['actual signed catalog and immutable renderer bytes','actual plugin JavaScript subscribes to sources devices approvals','real Core approval transition updates queue','new source updates same frame','explicit resync advances all cursors','unsubscribe prevents further source delivery','environment removal revokes frame','fixture pending Run cancelled','signed plugin invokes exact artifact command','built-in client uses same descriptor resource and receipt semantics','new client reads durable plugin invocation'],limits:['Empty Project device assignments; no device execution','Mounted React with minimal DOM adapter; not browser visual or sandbox proof'],completed_at:new Date().toISOString()},null,2)+'\n')
 console.log('Signed resource subscription proof passed.')
}finally{if(view)await act(async()=>view.unmount());Object.assign(globalThis,{addEventListener:originalAdd,removeEventListener:originalRemove})}
