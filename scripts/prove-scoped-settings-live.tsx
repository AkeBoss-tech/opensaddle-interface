/** SCOPED-SETTINGS-1: real Core and host; external frame messaging simulated. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import React from 'react'
import {act,create} from 'react-test-renderer'
import {ScopedViewHost} from '../src/perspectives/scoped/ScopedViewHost'
import {ScopedRendererClient} from '../src/services/scopedRenderers'
import {StandalonePluginSettingsClient} from '../src/services/standalonePluginSettings'
const [state,receipt]=process.argv.slice(2),fixture=JSON.parse(readFileSync(join(state,'fixture.json'),'utf8')),token=readFileSync(join(state,'owner.token'),'utf8')
const client=new ScopedRendererClient(fixture.base_url,()=> 'owner',token),preferences=new StandalonePluginSettingsClient(fixture.base_url,()=> 'owner',token)
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const listeners=new Set<(event:any)=>void>()
Object.assign(globalThis,{addEventListener:(_:string,fn:any)=>listeners.add(fn),removeEventListener:(_:string,fn:any)=>listeners.delete(fn)})
const results=[]
for(const teamId of [undefined,fixture.team_id]){
 const scope=teamId?{kind:'team' as const,id:teamId}:{kind:'user' as const,id:'owner'}
 const candidate=(await client.candidates(scope)).items[0],ref={package_id:candidate.package_id,version:candidate.package_version,manifest_digest:candidate.manifest_digest,application_id:candidate.application_id}
 await client.enable(scope,ref,candidate.enablement?.revision)
 const environment=await client.select(scope,(await client.environment(scope)).revision,ref,'Scoped settings proof')
 const rows=await preferences.enroll(ref,teamId),row=rows[0]
 await preferences.editor(row,teamId).replace('',{} as any,scope.kind,row.layer.revision,{density:teamId?'team-compact':'personal-compact'})
 const messages:any[]=[];const peer={postMessage:(value:any)=>messages.push(value)};let view:any
 const until=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50))});assert.ok(check())}
 await act(async()=>{view=create(<ScopedViewHost client={client} scope={scope} environment={environment} candidate={candidate}/>,{createNodeMock:element=>element.type==='iframe'?{contentWindow:peer}:null})})
 await until(()=>view.root.findAllByType('iframe').length===1)
 await act(async()=>view.root.findByType('iframe').props.onLoad())
 const init=messages.find(value=>value.kind==='init')
 await act(async()=>{for(const fn of listeners)fn({source:peer,data:{...init,kind:'ready'}})})
 await until(()=>JSON.stringify(view.toJSON()).includes('View ready.'))
 await act(async()=>{for(const fn of listeners)fn({source:peer,data:{...init,kind:'request',action:'read_settings',request_id:'settings-one'}})})
 await until(()=>messages.some(value=>value.kind==='resources'))
 const response=messages.find(value=>value.kind==='resources')
 assert.equal(response.resource,'view_settings');assert.deepEqual(response.value.scope,scope)
 assert.deepEqual(response.value.values,{density:teamId?'team-compact':'personal-compact'})
 assert.equal(response.value.revision,2);assert.equal(response.value.authority,'presentation_only');assert.equal(JSON.stringify(response).includes(token),false)
 results.push({scope,settings:response.value})
 await act(async()=>view.unmount())
}
writeFileSync(receipt,JSON.stringify({boundary:'production scoped host and preferences client against real Core; simulated external frame',results,limits:['not a browser walkthrough','no settings write exposed to plug-ins']},null,2)+'\n')
console.log('User and Team scoped settings delivered independently')
