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
 const opened:string[]=[];const client={applicationRenderers:async()=>enabled?[authorizedRenderer]:[],applicationRendererContent:async()=>new Response(fragment,{headers:{'Content-Type':renderer.media_type}})} as unknown as MalleableShellClient
 const model={projectId:'P',tasks:[{id:'R',title:'Task',status:'queued',verified:false,source:'active_run' as const}]}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<InstalledProjectView client={client} renderer={renderer} model={model} connectionKey="C" stateScope="server/user" onOpenTask={id=>opened.push(id)} onNewTask={()=>opened.push('new')}/>,{createNodeMock:()=>node});await new Promise(resolve=>setTimeout(resolve,20))})
 for(let i=0;i<50&&!view.root.findAllByType('iframe').length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
 assert.equal(view.root.findAllByType('iframe').length,1,JSON.stringify(view.toJSON()))
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 assert.deepEqual(init.projection.model.tasks.map((task:any)=>task.id),['R'])
 const send=(data:any,from:any=source)=>{for(const listener of listeners)listener({source:from,data:{...init,...data}})}
 await act(async()=>{send({kind:'request',action:'open_task',task_id:'R'});send({kind:'ready'});send({kind:'request',action:'open_task',task_id:'outside'});send({kind:'request',action:'open_task',task_id:'R'},{});send({kind:'request',action:'open_task',task_id:'R',nonce:'stale'});send({kind:'request',action:'open_task',task_id:'R'})})
 assert.deepEqual(opened,['R'])
 await act(async()=>view.update(<InstalledProjectView client={client} renderer={renderer} model={model} connectionKey="C" stateScope="server/user" onOpenTask={id=>opened.push('updated:'+id)} onNewTask={()=>{}}/>))
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5100));send({kind:'request',action:'open_task',task_id:'R'})})
 assert.deepEqual(opened,['R','updated:R'])
 assert.equal(view.root.findAllByType('iframe').length,1)
 await act(async()=>send({kind:'state',state:{query:'retained'}}))
 assert.equal(storage.size,2)
 assert.equal(readProjectViewState('other-server/user','P',renderer),undefined)
 assert.equal(readProjectViewState('server/other-user','P',renderer),undefined)
 assert.equal(readProjectViewState('server/user','Other',renderer),undefined)
 assert.equal(readProjectViewState('server/user','P',{...renderer,package_ref:{...renderer.package_ref,manifest_digest:'f'.repeat(64)}}),undefined)
 await act(async()=>send({kind:'state',state:{query:'invalid',unexpected:true}}))
 assert.match([...storage.values()][0]!,/retained/)
 await act(async()=>view.unmount())
 node.dataset={}
 await act(async()=>{view=create(<InstalledProjectView client={client} renderer={renderer} model={model} connectionKey="C" stateScope="server/user" onOpenTask={()=>{}} onNewTask={()=>{}}/>,{createNodeMock:()=>node});await new Promise(resolve=>setTimeout(resolve,20))})
 for(let i=0;i<50&&!view.root.findAllByType('iframe').length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 assert.deepEqual(init.state,{query:'retained'})
 const upgraded={...renderer,state_schema_version:2,state_schema:reportAnnotatorV2.state_schema,state_migrations:reportAnnotatorV2.state_migrations,package_ref:{...renderer.package_ref,version:'2.0.0',manifest_digest:'2'.repeat(64)}}
 assert.deepEqual(readProjectViewState('server/user','P',upgraded),{search:'retained',layout:'compact'})
 assert.equal(readProjectViewState('server/user','P',{...upgraded,state_migrations:[]}),undefined)
 assert.equal(readProjectViewState('server/user','P',{...upgraded,package_ref:{...upgraded.package_ref,package_id:'other-package'}}),undefined)
 assert.deepEqual(readProjectViewState('server/user','P',renderer),{query:'retained'})
 authorizedRenderer=upgraded
 await act(async()=>view.unmount());node.dataset={}
 await act(async()=>{view=create(<InstalledProjectView client={client} renderer={upgraded} model={model} connectionKey="C" stateScope="server/user" onOpenTask={()=>{}} onNewTask={()=>{}}/>,{createNodeMock:()=>node});await new Promise(resolve=>setTimeout(resolve,20))})
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

 await act(async()=>view.unmount())
 assert.equal(listeners.size,0)
})
