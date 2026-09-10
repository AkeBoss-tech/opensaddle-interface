import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {createHash} from 'node:crypto'
import {readProjectViewState} from './state'
import {InstalledProjectView} from './InstalledProjectView'
import {installedProjectViews,PROJECT_VIEW_CONTRACT} from './installed'
import {reportAnnotatorV1,reportAnnotatorV2} from '../../applications/fixturePackages'
import type {ApplicationRendererDescriptor,MalleableShellClient} from '../../services/contracts'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
// INSTALLED-PROJECT-VIEW-1: exact bytes and framed messages, host-owned task navigation.
test('installed view opens only projected tasks from its exact initialized frame',async t=>{
 const fragment='<p>Tasks</p>',renderer={...reportAnnotatorV1,authority:'core',execution_trust:'trusted_signed_publisher',input_schema:{$id:PROJECT_VIEW_CONTRACT},size:Buffer.byteLength(fragment),content_digest:createHash('sha256').update(fragment).digest('hex')} as unknown as ApplicationRendererDescriptor
 assert.equal(installedProjectViews([renderer]).length,1)
 assert.equal(installedProjectViews([{...renderer,input_schema:{}}]).length,0)
 const storage=new Map<string,string>();Object.assign(globalThis,{sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)}})
 const listeners=new Set<(event:any)=>void>();Object.assign(globalThis,{addEventListener:(_:string,fn:(event:any)=>void)=>listeners.add(fn),removeEventListener:(_:string,fn:(event:any)=>void)=>listeners.delete(fn)})
 let init:any;const source={postMessage:(message:any)=>{init=message}},node={contentWindow:source,dataset:{}}
 let enabled=true,authorizedRenderer=renderer
 const failures:string[]=[];const opened:string[]=[];const client={applicationRenderers:async()=>enabled?[authorizedRenderer]:[],applicationRendererContent:async()=>new Response(fragment,{headers:{'Content-Type':renderer.media_type}})} as unknown as MalleableShellClient
 const model={projectId:'P',tasks:[{id:'R',title:'Task',status:'queued',verified:false,source:'active_run' as const}]}
 let view!:ReactTestRenderer
 t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(<InstalledProjectView onUnavailable={reason=>failures.push(reason)} client={client} renderer={renderer} model={model} connectionKey="C" stateScope="server/user" onOpenTask={id=>opened.push(id)} onNewTask={()=>opened.push('new')}/>,{createNodeMock:()=>node});await new Promise(resolve=>setTimeout(resolve,20))})
 for(let i=0;i<50&&!view.root.findAllByType('iframe').length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
 assert.equal(view.root.findAllByType('iframe').length,1,JSON.stringify(view.toJSON()))
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 assert.deepEqual(init.projection.model.tasks.map((task:any)=>task.id),['R'])
 const send=(data:any,from:any=source)=>{for(const listener of listeners)listener({source:from,data:{...init,...data}})}
 await act(async()=>{send({kind:'request',action:'open_task',task_id:'R'});send({kind:'ready'});send({kind:'request',action:'open_task',task_id:'outside'});send({kind:'request',action:'open_task',task_id:'R'},{});send({kind:'request',action:'open_task',task_id:'R',nonce:'stale'});send({kind:'request',action:'open_task',task_id:'R'})})
 assert.deepEqual(opened,['R'])
 await act(async()=>view.update(<InstalledProjectView onUnavailable={reason=>failures.push(reason)} client={client} renderer={renderer} model={model} connectionKey="C" stateScope="server/user" onOpenTask={id=>opened.push('updated:'+id)} onNewTask={()=>{}}/>))
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5100));send({kind:'request',action:'open_task',task_id:'R'})})
 assert.deepEqual(opened,['R','updated:R'])
 assert.equal(view.root.findAllByType('iframe').length,1)
 await act(async()=>send({kind:'state',state:{query:'retained'}}))
 assert.equal(storage.size,2)
 assert.equal(readProjectViewState('other-server/user','P',renderer),undefined)
 assert.equal(readProjectViewState('server/other-user','P',renderer),undefined)
 assert.equal(readProjectViewState('server/user','Other',renderer),undefined)
 assert.equal(readProjectViewState('server/user','P',{...renderer,state_schema:{...renderer.state_schema,required:['query']},package_ref:{...renderer.package_ref,manifest_digest:'f'.repeat(64)}}),undefined)
 await act(async()=>send({kind:'state',state:{query:'invalid',unexpected:true}}))
 assert.match([...storage.values()][0]!,/retained/)
 await act(async()=>view.unmount())
 node.dataset={}
 await act(async()=>{view=create(<InstalledProjectView onUnavailable={reason=>failures.push(reason)} client={client} renderer={renderer} model={model} connectionKey="C" stateScope="server/user" onOpenTask={()=>{}} onNewTask={()=>{}}/>,{createNodeMock:()=>node});await new Promise(resolve=>setTimeout(resolve,20))})
 for(let i=0;i<50&&!view.root.findAllByType('iframe').length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 assert.deepEqual(init.state,{query:'retained'})
 const compatible={...renderer,package_ref:{...renderer.package_ref,version:'1.0.1',manifest_digest:'3'.repeat(64)},state_schema:{...renderer.state_schema,properties:{pinned:{type:'boolean' as const},query:{maxLength:200,type:'string' as const}}}}
 authorizedRenderer=compatible
 await act(async()=>view.unmount());node.dataset={}
 await act(async()=>{view=create(<InstalledProjectView onUnavailable={reason=>failures.push(reason)} client={client} renderer={compatible} model={model} connectionKey="C" stateScope="server/user" onOpenTask={()=>{}} onNewTask={()=>{}}/>,{createNodeMock:()=>node});await new Promise(resolve=>setTimeout(resolve,20))})
 for(let i=0;i<50&&!view.root.findAllByType('iframe').length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 assert.deepEqual(init.state,{query:'retained'},'compatible package update must retain state')
 assert.equal(readProjectViewState('server/user','P',{...compatible,state_max_bytes:1}),undefined)
 const upgraded={...renderer,state_schema_version:2,state_schema:reportAnnotatorV2.state_schema,state_migrations:reportAnnotatorV2.state_migrations,package_ref:{...renderer.package_ref,version:'2.0.0',manifest_digest:'2'.repeat(64)}}
 assert.deepEqual(readProjectViewState('server/user','P',upgraded),{search:'retained',layout:'compact'})
 assert.equal(readProjectViewState('server/user','P',{...upgraded,state_migrations:[]}),undefined)
 assert.equal(readProjectViewState('server/user','P',{...upgraded,package_ref:{...upgraded.package_ref,package_id:'other-package'}}),undefined)
 assert.deepEqual(readProjectViewState('server/user','P',renderer),{query:'retained'})
 authorizedRenderer=upgraded
 await act(async()=>view.unmount());node.dataset={}
 await act(async()=>{view=create(<InstalledProjectView onUnavailable={reason=>failures.push(reason)} client={client} renderer={upgraded} model={model} connectionKey="C" stateScope="server/user" onOpenTask={()=>{}} onNewTask={()=>{}}/>,{createNodeMock:()=>node});await new Promise(resolve=>setTimeout(resolve,20))})
 for(let i=0;i<50&&!view.root.findAllByType('iframe').length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 assert.deepEqual(init.state,{search:'retained',layout:'compact'})
 assert.match(JSON.stringify(view.toJSON()),/previous package.*state is preserved/)

 await act(async()=>send({kind:'ready'}))
 enabled=false
 await act(async()=>{send({kind:'request',action:'open_task',task_id:'R'});await new Promise(resolve=>setTimeout(resolve,20))})
 assert.deepEqual(opened,['R','updated:R'])
 assert.equal(view.root.findAllByType('iframe').length,0)
 assert.match(JSON.stringify(view.toJSON()),/lost authorization/)
 assert.ok(failures.some(reason=>reason.includes('lost authorization')),'host must receive installed view failure for safe fallback')

 await act(async()=>view.unmount())
 assert.equal(listeners.size,0)
})

// INSTALLED-PROJECT-LIVE-1: compatible views update within the authorized frame.
test('live projections retain their frame, reauthorize updates and fence removed tasks', async t => {
 const fragment='<p>Live tasks</p>'
 const renderer={...reportAnnotatorV1,authority:'core',execution_trust:'trusted_signed_publisher',input_schema:{$id:PROJECT_VIEW_CONTRACT,properties:{kind:{enum:['init','projection']}}},size:Buffer.byteLength(fragment),content_digest:createHash('sha256').update(fragment).digest('hex')} as unknown as ApplicationRendererDescriptor
 const listeners=new Set<(event:any)=>void>(),messages:any[]=[],opened:string[]=[]
 Object.assign(globalThis,{addEventListener:(_:string,fn:(event:any)=>void)=>listeners.add(fn),removeEventListener:(_:string,fn:(event:any)=>void)=>listeners.delete(fn)})
 const source={postMessage:(message:any)=>messages.push(message)},node={contentWindow:source,dataset:{}}
 let enabled=true,reads=0,checks=0
 const client={applicationRenderers:async()=>{checks++;return enabled?[renderer]:[]},applicationRendererContent:async()=>{reads++;return new Response(fragment,{headers:{'Content-Type':renderer.media_type}})}} as unknown as MalleableShellClient
 const initial={projectId:'P',tasks:[{id:'R',title:'Task',status:'queued',verified:false,source:'active_run' as const}]}
 const render=(model:typeof initial)=><InstalledProjectView client={client} renderer={renderer} model={model} connectionKey="C" onOpenTask={id=>opened.push(id)} onNewTask={()=>{}}/>
 let view!:ReactTestRenderer
 t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(render(initial),{createNodeMock:()=>node});await new Promise(resolve=>setTimeout(resolve,20))})
 for(let i=0;i<50&&!view.root.findAllByType('iframe').length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 const init=messages[0],html=view.root.findByType('iframe').props.srcDoc
 const send=(message:any)=>{for(const listener of listeners)listener({source,data:{...init,...message}})}
 await act(async()=>send({kind:'ready'}))
 const next={...initial,tasks:[{...initial.tasks[0],id:'S',status:'running'}]}
 await act(async()=>view.update(render(next)))
 assert.equal(reads,1,'live update must not reload renderer bytes')
 assert.equal(messages.length,2)
 assert.equal(messages[1].kind,'projection')
 assert.equal(messages[1].nonce,init.nonce)
 assert.equal(messages[1].generation,init.generation)
 assert.equal(messages[1].projection_revision,1)
 assert.equal(messages[1].projection.model.tasks[0].id,'S')
 assert.equal(view.root.findByType('iframe').props.srcDoc,html)
 assert.equal(checks,2,'projection update must reauthorize the exact renderer')
 await act(async()=>{send({kind:'request',action:'open_task',task_id:'R'});send({kind:'request',action:'open_task',task_id:'S'})})
 assert.deepEqual(opened,['S'])
 enabled=false
 await act(async()=>view.update(render({...next,tasks:[]})))
 assert.equal(messages.length,2,'revoked frame must not receive a new projection')
 assert.equal(view.root.findAllByType('iframe').length,0)
})

test('incompatible UI contract prevents discovery and renderer byte loading',async t=>{
 const fragment='<p>Unsupported view</p>'
 const renderer={...reportAnnotatorV1,authority:'core',execution_trust:'trusted_signed_publisher',input_schema:{$id:PROJECT_VIEW_CONTRACT},size:Buffer.byteLength(fragment),content_digest:createHash('sha256').update(fragment).digest('hex'),descriptor:{ui_contract:{schema_version:'opensaddle.ui-contract.v1',mount_kind:'perspective',scope:'project',host_api_min:2,host_api_max:2,required_capabilities:[]}}} as unknown as ApplicationRendererDescriptor
 let reads=0,view:ReactTestRenderer|undefined
 Object.assign(globalThis,{addEventListener:()=>{},removeEventListener:()=>{}})
 const client={applicationRenderers:async()=>[renderer],applicationRendererContent:async()=>{reads++;return new Response(fragment)}} as unknown as MalleableShellClient
 t.after(async()=>{if(view)await act(async()=>view!.unmount())})
 await act(async()=>{view=create(<InstalledProjectView client={client} renderer={renderer} model={{projectId:'P',tasks:[]}} connectionKey="C" onOpenTask={()=>{}} onNewTask={()=>{}}/>);await new Promise(resolve=>setImmediate(resolve))})
 assert.equal(reads,0,'unsupported UI must not load executable bytes')
 assert.equal(installedProjectViews([renderer]).length,0)
 assert.match(JSON.stringify(view!.toJSON()),/different host API/)
 const supported={...renderer,descriptor:{ui_contract:{...renderer.descriptor!.ui_contract as Record<string,unknown>,host_api_min:1,host_api_max:1,required_capabilities:['projection.project-runs.v1']}}}
 assert.equal(installedProjectViews([supported]).length,1)
 const widget={...supported,descriptor:{ui_contract:{...supported.descriptor.ui_contract,mount_kind:'widget'}}}
 await act(async()=>view!.update(<InstalledProjectView client={client} renderer={widget} model={{projectId:'P',tasks:[]}} connectionKey="C" onOpenTask={()=>{}} onNewTask={()=>{}}/>))
 assert.equal(reads,0,'a widget package must not execute in the Perspective mount')
 assert.equal(installedProjectViews([widget]).length,0)
 assert.equal(view!.root.findAllByType('iframe').length,0)
 assert.match(JSON.stringify(view!.toJSON()),/does not provide a Project Perspective/)

 assert.equal(installedProjectViews([{...supported,descriptor:{ui_contract:{...supported.descriptor.ui_contract,required_capabilities:['future.feature.v1']}}}]).length,0)
 assert.equal(installedProjectViews([{...supported,descriptor:{ui_contract:{...supported.descriptor.ui_contract,scope:'user'}}}]).length,0)
})

test('resolved plugin settings initialize, update without reload and revoke with account access',async t=>{
 const {RendererSettingsClient}=await import('../../services/rendererSettings')
 const contract={schema_version:'opensaddle.ui-settings.v1',purpose:'presentation',settings_version:1,scopes:['project','user_project'],values_schema:{type:'object',additionalProperties:false,maxProperties:1,properties:{card_limit:{type:'number',minimum:1,maximum:100}}},defaults:{card_limit:20},labels:{card_limit:'Maximum cards'}}
 const fragment='<p>Settings aware</p>',renderer={...reportAnnotatorV1,authority:'core',execution_trust:'trusted_signed_publisher',descriptor:{settings_contract:contract},input_schema:{$id:PROJECT_VIEW_CONTRACT,properties:{kind:{enum:['init','projection','settings']}}},size:Buffer.byteLength(fragment),content_digest:createHash('sha256').update(fragment).digest('hex')} as unknown as ApplicationRendererDescriptor
 let limit=35,allowed=true,contentReads=0
 t.mock.method(globalThis,'fetch',async(input:unknown)=>{assert.match(String(input),/projects\/P\/application-renderers/);return allowed?Response.json({schema_version:'opensaddle.renderer-settings.v1',project_id:'P',application_id:renderer.application_id,instance_id:renderer.instance_id,package_ref:renderer.package_ref,settings_version:1,contract,layers:[{scope:'project',revision:0,can_write:false,values:{}},{scope:'user_project',revision:1,can_write:true,values:{card_limit:limit}}],effective:{values:{card_limit:limit},provenance:{card_limit:'user_project'}}}):Response.json({}, {status:403})})
 const settingsClient=new RendererSettingsClient('http://core',()=> 'member')
 const listeners=new Set<(event:any)=>void>(),messages:any[]=[]
 Object.assign(globalThis,{addEventListener:(_:string,fn:(event:any)=>void)=>listeners.add(fn),removeEventListener:(_:string,fn:(event:any)=>void)=>listeners.delete(fn)})
 const source={postMessage:(message:any)=>messages.push(message)},node={contentWindow:source,dataset:{}}
 const client={applicationRenderers:async()=>[renderer],applicationRendererContent:async()=>{contentReads++;return new Response(fragment,{headers:{'Content-Type':renderer.media_type}})}} as unknown as MalleableShellClient
 const render=(tasks:any[]=[]) => <InstalledProjectView client={client} settingsClient={settingsClient} renderer={renderer} model={{projectId:'P',tasks}} connectionKey="C" onOpenTask={()=>{}} onNewTask={()=>{}}/>
 let view!:ReactTestRenderer;t.after(async()=>{if(view)await act(async()=>view.unmount())})
 await act(async()=>{view=create(render(),{createNodeMock:()=>node})})
 for(let i=0;i<50&&!view.root.findAllByType('iframe').length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 assert.deepEqual(messages[0].settings,{schema_version:'opensaddle.resolved-ui-settings.v1',settings_version:1,values:{card_limit:35}},'init must contain current resolved plugin preferences')
 const init=messages[0]
 await act(async()=>{for(const listener of listeners)listener({source,data:{...init,kind:'ready'}})})
 limit=10
 await act(async()=>view.update(render()))
 const settings=messages.filter(message=>message.kind==='settings').at(-1)
 assert.equal(settings.settings.values.card_limit,10)
 assert.equal(settings.nonce,init.nonce);assert.ok(settings.settings_revision>0)
 assert.deepEqual(Object.keys(settings.settings).sort(),['schema_version','settings_version','values'])
 assert.equal(contentReads,1,'changing settings must preserve the frame')
 allowed=false
 await act(async()=>view.update(render()))
 assert.equal(view.root.findAllByType('iframe').length,0,'settings revocation removes protected frame')
 assert.equal(messages.filter(message=>message.kind==='settings').at(-1),settings)
})
