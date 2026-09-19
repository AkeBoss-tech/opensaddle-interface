/** Real disposable Core plus production dashboard client, renderer transport and
 * main proxy. IPC is an in-process adapter here; this script makes no UI claim. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {DashboardSettingsClient} from '../src/services/dashboardSettings'
import {installPersonalRuntimeTransport} from '../src/services/personalRuntimeTransport'
import {proxyPersonalRuntimeRequest} from '../electron/personalRuntimeProxy'
const [state,receipt]=process.argv.slice(2)
const fixture=JSON.parse(readFileSync(join(state,'fixture.json'),'utf8'))
assert.equal(fixture.projects_created,false)
assert.equal(fixture.pending_install,true)
assert.equal(fixture.desktop_adoption,true)
const nativeFetch=globalThis.fetch
const handoff={baseUrl:fixture.base_url,installationId:'fixture-installation',projectId:'fixture',ownerSubject:'owner',bearerToken:readFileSync(join(state,'owner.token'),'utf8'),adoptionSocket:join(state,'ipc/adopt.sock'),ipcDir:join(state,'ipc')}
;(globalThis as any).window={opensaddle:{personalRuntimeRequest:(request:unknown)=>proxyPersonalRuntimeRequest(handoff,request,nativeFetch)}}
installPersonalRuntimeTransport(handoff)
const client=new DashboardSettingsClient(fixture.base_url,()=> 'owner')
const before=await client.read()
const saved=await client.replace(before.revision,['projects','outcomes'])
assert.deepEqual(saved.widgets,['projects','outcomes'])
assert.equal(saved.owner_subject,'owner')
assert.deepEqual(await client.read(),saved)
await assert.rejects(client.replace(before.revision,['runs']),/changed elsewhere/)
const restored=await client.replace(saved.revision,before.widgets)
assert.deepEqual((await client.read()).widgets,before.widgets)
writeFileSync(receipt,JSON.stringify({boundary:'real Core and production client/transport/main proxy; IPC adapter in process',before,saved,restored,stale_revision_rejected:true,personal_state_changed:false},null,2)+'\n')
console.log('Dashboard read, save, reread, conflict and restore cross adopted desktop transport')
