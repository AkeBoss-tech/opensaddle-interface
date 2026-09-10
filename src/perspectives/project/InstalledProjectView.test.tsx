import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {createHash} from 'node:crypto'
import {InstalledProjectView} from './InstalledProjectView'
import {installedProjectViews,PROJECT_VIEW_CONTRACT} from './installed'
import {reportAnnotatorV1} from '../../applications/fixturePackages'
import type {ApplicationRendererDescriptor,MalleableShellClient} from '../../services/contracts'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
// INSTALLED-PROJECT-VIEW-1: exact bytes and framed messages, host-owned task navigation.
test('installed view opens only projected tasks from its exact initialized frame',async t=>{
 const fragment='<p>Tasks</p>',renderer={...reportAnnotatorV1,authority:'core',execution_trust:'trusted_signed_publisher',input_schema:{$id:PROJECT_VIEW_CONTRACT},size:Buffer.byteLength(fragment),content_digest:createHash('sha256').update(fragment).digest('hex')} as unknown as ApplicationRendererDescriptor
 assert.equal(installedProjectViews([renderer]).length,1)
 assert.equal(installedProjectViews([{...renderer,input_schema:{}}]).length,0)
 const listeners=new Set<(event:any)=>void>();Object.assign(globalThis,{addEventListener:(_:string,fn:(event:any)=>void)=>listeners.add(fn),removeEventListener:(_:string,fn:(event:any)=>void)=>listeners.delete(fn)})
 let init:any;const source={postMessage:(message:any)=>{init=message}},node={contentWindow:source,dataset:{}}
 const opened:string[]=[];const client={applicationRendererContent:async()=>new Response(fragment,{headers:{'Content-Type':renderer.media_type}})} as unknown as MalleableShellClient
 const model={projectId:'P',tasks:[{id:'R',title:'Task',status:'queued',verified:false,source:'active_run' as const}]}
 let view!:ReactTestRenderer
 await act(async()=>{view=create(<InstalledProjectView client={client} renderer={renderer} model={model} connectionKey="C" onOpenTask={id=>opened.push(id)} onNewTask={()=>opened.push('new')}/>,{createNodeMock:()=>node});await new Promise(resolve=>setTimeout(resolve,20))})
 for(let i=0;i<50&&!view.root.findAllByType('iframe').length;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10))})
 assert.equal(view.root.findAllByType('iframe').length,1,JSON.stringify(view.toJSON()))
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 assert.deepEqual(init.projection.model.tasks.map((task:any)=>task.id),['R'])
 const send=(data:any,from:any=source)=>{for(const listener of listeners)listener({source:from,data:{...init,...data}})}
 await act(async()=>{send({kind:'request',action:'open_task',task_id:'R'});send({kind:'ready'});send({kind:'request',action:'open_task',task_id:'outside'});send({kind:'request',action:'open_task',task_id:'R'},{});send({kind:'request',action:'open_task',task_id:'R',nonce:'stale'});send({kind:'request',action:'open_task',task_id:'R'})})
 assert.deepEqual(opened,['R'])
 await act(async()=>view.update(<InstalledProjectView client={client} renderer={renderer} model={model} connectionKey="C" onOpenTask={id=>opened.push('updated:'+id)} onNewTask={()=>{}}/>))
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5100));send({kind:'request',action:'open_task',task_id:'R'})})
 assert.deepEqual(opened,['R','updated:R'])
 assert.equal(view.root.findAllByType('iframe').length,1)

 await act(async()=>view.unmount())
 assert.equal(listeners.size,0)
})
