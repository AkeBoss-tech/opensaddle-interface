/** DESKTOP-SCOPED-VIEWS-1: real Core plus production client/transport/main proxy.
 * Disposable fixture only. IPC invocation is an in-process adapter; no UI claim.
 */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
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
for(const scope of [{kind:'user',id:'owner'},{kind:'team',id:fixture.team_id}] as const){
 const original=await client.environment(scope), candidate=(await client.candidates(scope)).items[0]
 const ref={package_id:candidate.package_id,version:candidate.package_version,manifest_digest:candidate.manifest_digest,application_id:candidate.application_id}
 const enablement=await client.enable(scope,ref)
 const environment=await client.select(scope,original.revision,ref,'Desktop transport verification')
 const content={...ref,environment_revision:environment.revision,environment_digest:environment.definition_digest,content_digest:candidate.content_digest}
 assert.match(await (await client.content(scope,content)).text(),/Scoped transport fixture/)
 const session=await client.createHost(scope,{...content,host_id:'desktop:proof',instance_id:'main',generation:1})
 assert.equal((await client.report(scope,session,{sequence:1,state:'loading'})).state,'loading')
 assert.equal((await client.report(scope,session,{sequence:2,state:'ready'})).semantic_correctness,'not_verified')
 await assert.rejects(client.report(scope,session,{sequence:2,state:'ready'}),/stale/)
 await client.disable(scope,ref.package_id,enablement.revision)
 await assert.rejects(client.content(scope,content))
 await assert.rejects(client.report(scope,session,{sequence:3,state:'ready'}))
}
writeFileSync(receipt,JSON.stringify({invariant:'DESKTOP-SCOPED-VIEWS-1',passed:true,scopes:['user','team'],checks:['environment and signed candidates','enable and select','content delivery','host sessions and scoped report token','stale sequence denied','disable rejects content and reports'],boundary:'real Core HTTP with production client, fetch transport and main proxy; in-process IPC adapter',visual_or_plugin_execution:false},null,2)+'\n')
console.log('User and Team desktop transport lifecycle passed against real Core.')
