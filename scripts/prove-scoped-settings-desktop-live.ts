/** DESKTOP-SCOPED-VIEWS-1: real Core plus production client/transport/main proxy.
 * Disposable fixture only. IPC invocation is an in-process adapter; no UI claim.
 */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {StandalonePluginSettingsClient} from '../src/services/standalonePluginSettings'
import {ScopedRendererClient} from '../src/services/scopedRenderers'
import {proxyPersonalRuntimeRequest} from '../electron/personalRuntimeProxy'
import {installPersonalRuntimeTransport} from '../src/services/personalRuntimeTransport'
const [state,receipt]=process.argv.slice(2), fixture=JSON.parse(readFileSync(join(state,'fixture.json'),'utf8'))
assert.equal(fixture.projects_created,false)
const nativeFetch=globalThis.fetch
const identity={baseUrl:fixture.base_url+'/',installationId:'disposable-proof',projectId:'desktop-identity',ownerSubject:'owner'}
const handoff={...identity,bearerToken:readFileSync(join(state,'owner.token'),'utf8'),adoptionSocket:'/unused',ipcDir:'/unused'}
;(globalThis as any).window={opensaddle:{personalRuntimeRequest:(request:unknown)=>proxyPersonalRuntimeRequest(handoff,request,nativeFetch)}}
installPersonalRuntimeTransport(identity)
const client=new ScopedRendererClient(fixture.base_url,()=> 'owner')
const preferences=new StandalonePluginSettingsClient(fixture.base_url,()=> 'owner'),results=[]
for(const scope of [{kind:'user',id:'owner'},{kind:'team',id:fixture.team_id}] as const){
 const candidate=(await client.candidates(scope)).items[0],teamId=scope.kind==='team'?scope.id:undefined
 const ref={package_id:candidate.package_id,version:candidate.package_version,manifest_digest:candidate.manifest_digest,application_id:candidate.application_id}
 const [row]=await preferences.enroll(ref,teamId)
 const edited=await preferences.editor(row,teamId).replace('',{} as any,scope.kind,row.layer.revision,{density:scope.kind+'-desktop'})
 assert.equal(edited.layers[0].revision,2)
 const declaration=(candidate as any).descriptor.settings_contract
 const value=await client.viewSettings(scope,ref,declaration)
 assert.deepEqual(value.values,{density:scope.kind+'-desktop'})
 assert.equal(JSON.stringify(value).includes(handoff.bearerToken),false)
 results.push(value)
}
writeFileSync(receipt,JSON.stringify({boundary:'real Core, production client, renderer transport and main proxy; in-process IPC adapter',results,limits:['not actual Electron process or visual settings editor']},null,2)+'\n')
console.log('Standalone preference enroll, update and scoped reads cross desktop transport')
