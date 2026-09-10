/** SCOPED-HOST-1: real authority, React lifecycle, simulated browser frame boundary. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import React from 'react'
import {act,create} from 'react-test-renderer'
import {ScopedViewCatalog} from '../src/features/settings/ScopedViewCatalog'
import {ScopedRendererClient} from '../src/services/scopedRenderers'
const [state,receipt]=process.argv.slice(2),fixture=JSON.parse(readFileSync(join(state,'fixture.json'),'utf8'))
const client=new ScopedRendererClient(fixture.base_url,()=> 'owner',readFileSync(join(state,'owner.token'),'utf8'))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
const listeners=new Set<(event:any)=>void>()
Object.assign(globalThis,{addEventListener:(name:string,listener:any)=>{if(name==='message')listeners.add(listener)},removeEventListener:(name:string,listener:any)=>{listeners.delete(listener)}})
for(const teamId of [undefined,fixture.team_id]) {
 let init:any
 const peer={postMessage:(message:any)=>{init=message}}
 let view:any
 await act(async()=>{view=create(<ScopedViewCatalog client={client} teamId={teamId}/>,{createNodeMock:element=>element.type==='iframe'?{contentWindow:peer}:null})})
 const until=async(check:()=>boolean)=>{for(let i=0;i<120&&!check();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,100))});assert.ok(check(),'scoped host lifecycle reached expected state')}
 const button=(name:string)=>view.root.findAllByType('button').find((node:any)=>node.children.includes(name))
 await until(()=>Boolean(button('Use view')))
 assert.equal(view.root.findAllByType('iframe').length,0)
 await act(async()=>{button('Use view').props.onClick()})
 await until(()=>view.root.findAllByType('iframe').length===1)
 const frame=view.root.findByType('iframe')
 assert.equal(frame.props.sandbox,'allow-scripts')
 assert.match(frame.props.srcDoc,/Scoped transport fixture/)
 await act(async()=>frame.props.onLoad())
 assert.equal(JSON.stringify(init).includes('report_token'),false)
 assert.equal(JSON.stringify(init).includes('project_id'),false)
 await act(async()=>{for(const listener of listeners)listener({source:peer,data:{...init,kind:'ready'}})})
 await until(()=>JSON.stringify(view.toJSON()).includes('View ready.'))
 const scope=teamId?{kind:'team' as const,id:teamId}:{kind:'user' as const,id:'owner'}
 const candidate=(await client.candidates(scope)).items[0]
 await client.disable(scope,candidate.package_id,candidate.enablement!.revision)
 await until(()=>view.root.findAllByType('iframe').length===0)
 assert.match(JSON.stringify(view.toJSON()),/workspace controls remain available/)
 await act(async()=>{await button('Restore default workspace').props.onClick();await new Promise(resolve=>setTimeout(resolve,100))})
 await until(()=>!button('Restore default workspace'))
 assert.equal((await client.environment(scope)).definition.applications?.length,0)
 await act(async()=>view.unmount())
 assert.equal(listeners.size,0)
}
writeFileSync(receipt,JSON.stringify({invariant:'SCOPED-HOST-1',passed:true,scopes:['user','team'],checks:['explicit selection enables exact package','exact fragment in scripts-only sandbox','credential-free scoped initialization','host ready receipt','disablement removes frame','restore default clears selection','listeners removed on unmount'],boundary:'React component and production scoped client against real Core; simulated iframe postMessage boundary',visual_verified:false},null,2)+'\n')
console.log('Scoped host selection, readiness, revocation and recovery passed for user and Team.')
