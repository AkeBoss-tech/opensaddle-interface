/** DESKTOP-PERSONAL-LAUNCH-1: real Core and native worker, isolated runtime state. */
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createServer} from 'node:net'
import {once} from 'node:events'
import {commissionPersonalRuntimeProcess,adoptPersonalRuntime,preparePersonalRuntimeStateDir} from '../electron/personalRuntimeCommissioning'
import {PersonalRuntimeClient} from '../src/services/personalRuntime'
const [coreRoot,workspace,executable,receiptPath]=process.argv.slice(2)
assert.ok(coreRoot&&workspace&&executable&&receiptPath,'core, workspace, executable, receipt required')
const root=realpathSync(mkdtempSync(path.join(tmpdir(),'os-launch-')))
const state=preparePersonalRuntimeStateDir(path.join(root,'state'))
// macOS UNIX socket paths are limited; use a short, private temporary directory.
const ipc=realpathSync(mkdtempSync('/tmp/os-ipc-'))
preparePersonalRuntimeStateDir(ipc)
const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening')
const port=(server.address() as {port:number}).port
await new Promise<void>(resolve=>server.close(()=>resolve()))
const baseUrl=`http://127.0.0.1:${port}`,projectId='desktop-launch-check'
const started=Date.now()
const launched=await commissionPersonalRuntimeProcess({command:path.join(coreRoot,'.venv/bin/python'),commandPrefix:['-m','opensaddle.cli.main'],request:{projectId,workspace,adapter:'codex',executable,cpuMillicores:2000,memoryMiB:4096,maxConcurrency:1},config:{projectDatabase:path.join(root,'projects.db'),stateDir:state,ipcDir:ipc,port,handoffFd:3},expected:{baseUrl,projectId,ipcDir:ipc},timeoutMs:30000})
let receipt:Record<string,unknown>={schema:'opensaddle.desktop-launch-proof.v1',runtimeState:root,ipcDir:ipc,launchMilliseconds:Date.now()-started,projectId}
try {
 const h=launched.handoff,client=new PersonalRuntimeClient(baseUrl,()=>h.ownerSubject,h.bearerToken)
 const request=async(route:string)=>{const response=await fetch(baseUrl+route,{headers:{Authorization:`Bearer ${h.bearerToken}`},signal:AbortSignal.timeout(5000)});assert.equal(response.status,200,route);return response.json()}
 const capabilities=await request('/api/v2/capabilities')
 assert.equal(capabilities.command_center?.available,true)
 await request('/api/v2/command-center')
 const adopted=await adoptPersonalRuntime({stateDir:state,ipcDir:ipc,socketPath:h.adoptionSocket,baseUrl,installationId:h.installationId,projectId})
 assert.equal(adopted.bearerToken,h.bearerToken)
 const denied=await fetch(baseUrl+'/api/v2/command-center',{signal:AbortSignal.timeout(5000)})
 assert.ok([401,403].includes(denied.status))
 let status=await client.status()
 for(let attempt=0;attempt<30&&!status.workers.some(w=>w.readiness.ready);attempt++){
  await new Promise(resolve=>setTimeout(resolve,1000));status=await client.status()
 }
 receipt={...receipt,authenticatedDashboard:true,unauthenticatedStatus:denied.status,adoption:true,status,taskSubmitted:false}
 assert.ok(status.workers.some(w=>w.readiness.ready),'native worker must become ready')
} finally {
 const exited=once(launched.process,'exit')
 process.kill(-launched.process.pid!,'SIGTERM')
 const outcome=await Promise.race([exited,new Promise<null>(resolve=>setTimeout(()=>resolve(null),5000))])
 if(outcome===null){process.kill(-launched.process.pid!,'SIGKILL');await exited}
 receipt.cleanup={exitCode:launched.process.exitCode,signal:launched.process.signalCode}
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n')
}
console.log('Personal runtime launch, authenticated dashboard, adoption, native readiness and shutdown verified.')
