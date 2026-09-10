/** SCOPED-HOST-LIVENESS-1: real Core; simulated responsive/silent renderer peer. */
import assert from 'node:assert/strict'
import React from 'react'
import {act,create} from 'react-test-renderer'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {ScopedViewCatalog} from '../src/features/settings/ScopedViewCatalog'
import {ScopedRendererClient} from '../src/services/scopedRenderers'
const [state,receipt]=process.argv.slice(2),fixture=JSON.parse(readFileSync(join(state,'fixture.json'),'utf8'))
const client=new ScopedRendererClient(fixture.base_url,()=> 'owner',readFileSync(join(state,'owner.token'),'utf8'))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const listeners=new Set<(event:any)=>void>()
Object.assign(globalThis,{addEventListener:(name:string,listener:any)=>{if(name==='message')listeners.add(listener)},removeEventListener:(_name:string,listener:any)=>listeners.delete(listener)})
const nativeFetch=globalThis.fetch,errorReceipts:any[]=[]
globalThis.fetch=async(input,options)=>{const response=await nativeFetch(input,options);if(String(input).endsWith('/observations')&&String(options?.body).includes('\"error\"')&&response.ok)errorReceipts.push(await response.clone().json());return response}
let init:any,pings=0,respond=true
const peer={postMessage:(message:any)=>{if(message.kind==='init')init=message;if(message.kind==='ping'){pings++;if(respond)for(const listener of listeners)listener({source:peer,data:{...message,kind:'pong'}})}}}
let view:any
await act(async()=>{view=create(<ScopedViewCatalog client={client}/>,{createNodeMock:element=>element.type==='iframe'?{contentWindow:peer}:null})})
const pause=async(ms:number)=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms))})}
const until=async(check:()=>boolean)=>{for(let i=0;i<80&&!check();i++)await pause(100);assert.ok(check(),'scoped liveness setup completed')}
const button=(name:string)=>view.root.findAllByType('button').find((node:any)=>node.children.includes(name))
await until(()=>Boolean(button('Use view')))
await act(async()=>button('Use view').props.onClick())
await until(()=>view.root.findAllByType('iframe').length===1)
await act(async()=>view.root.findByType('iframe').props.onLoad())
await act(async()=>{for(const listener of listeners)listener({source:peer,data:{...init,kind:'ready'}})})
await pause(6500)
assert.equal(view.root.findAllByType('iframe').length,1,'responsive renderer must remain mounted')
respond=false
// Mismatched request IDs cannot satisfy the outstanding probe.
const stale=setInterval(()=>{for(const listener of listeners)listener({source:peer,data:{...init,kind:'pong',request_id:'stale'}})},200)
try{await pause(9500)}finally{clearInterval(stale)}
assert.equal(view.root.findAllByType('iframe').length,0,'silent renderer must be removed despite stale pong messages')
assert.equal(errorReceipts.at(-1)?.state,'error','Core must retain the host failure receipt')
assert.ok(pings>=2,'host must probe renderer responsiveness')
assert.ok(button('Restore default workspace'),'recovery remains outside renderer')
await act(async()=>view.unmount())
assert.equal(listeners.size,0)
writeFileSync(receipt,JSON.stringify({invariant:'SCOPED-HOST-LIVENESS-1',passed:true,checks:['responsive peer remains mounted','silent peer removed','stale pong cannot satisfy probe','host recovery retained','Core error receipt retained','listener cleanup'],boundary:'production component and real Core; simulated iframe peer; real timers',limits:['does not prove recovery from a blocked parent/browser event loop']},null,2)+'\n')
console.log('Scoped renderer liveness and fallback passed.')
