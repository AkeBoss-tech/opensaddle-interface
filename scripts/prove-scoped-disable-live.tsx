/** SCOPED-DISABLE-1: production catalog UI/client against real disposable Core. */
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
const results=[]
for(const teamId of [undefined,fixture.team_id]){
 const scope=teamId?{kind:'team' as const,id:teamId}:{kind:'user' as const,id:'owner'}
 const candidate=(await client.candidates(scope)).items[0]
 await client.enable(scope,{package_id:candidate.package_id,version:candidate.package_version,manifest_digest:candidate.manifest_digest,application_id:candidate.application_id},candidate.enablement?.revision)
 let view:any
 await act(async()=>{view=create(<ScopedViewCatalog client={client} teamId={teamId}/> )})
 const button=()=>view.root.findAllByType('button').find((node:any)=>node.children.includes('Disable package'))
 for(let i=0;i<100&&!button();i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,50))})
 assert.ok(button(),'enabled package exposes disable control')
 await act(async()=>{await button().props.onClick()})
 const after=(await client.candidates(scope)).items[0]
 assert.equal(after.enablement.status,'disabled')
 assert.equal(after.enablement.revision,2)
 results.push({scope,status:after.enablement.status,revision:after.enablement.revision})
 await act(async()=>view.unmount())
}
writeFileSync(receipt,JSON.stringify({boundary:'React catalog UI and production HTTP client against disposable Core',results,limits:['no actual browser frame mounted','active workspace recovery covered separately by host lifecycle evidence']},null,2)+'\n')
console.log('User and Team package disablement verified')
