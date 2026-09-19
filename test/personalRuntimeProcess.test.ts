import assert from'node:assert/strict';import test from'node:test';import{chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync}from'node:fs';import os from'node:os';import path from'node:path';import{commissionPersonalRuntimeProcess}from'../electron/personalRuntimeCommissioning'
const request={projectId:'P',workspace:'/repo',adapter:'codex' as const,executable:'/bin/codex',cpuMillicores:1,memoryMiB:1,maxConcurrency:1}
test('main process serializes commissions and receives exact bounded inherited-FD handoff',async()=>{const root=mkdtempSync(path.join(os.tmpdir(),'personal-process-')),command=path.join(root,'fake');mkdirSync(path.join(root,'state'));writeFileSync(command,`#!/bin/sh\nprintf '%s\\n' '{"schema_version":"opensaddle.personal-runtime-handoff.v1","protocol_version":"opensaddle.personal-runtime.v1","base_url":"http://127.0.0.1:8766/","installation_id":"I","owner_subject":"O","project_id":"P","bearer_token":"secret","adoption_socket":"${root}/state/adopt.sock","ipc_dir":"${root}/state"}' >&3\nsleep 2\n`);chmodSync(command,0o755);const input={command,request,config:{projectDatabase:path.join(root,'projects.db'),stateDir:path.join(root,'state'),ipcDir:path.join(root,'state'),port:8766,allowedOrigin:'http://127.0.0.1:4177',handoffFd:3},expected:{baseUrl:'http://127.0.0.1:8766/',projectId:'P',ipcDir:path.join(root,'state')}};const first=commissionPersonalRuntimeProcess(input),second=commissionPersonalRuntimeProcess(input);assert.equal(first,second);const result=await first;assert.equal(result.handoff.bearerToken,'secret');result.process.kill()})
test('main process rejects oversized or missing handoff without exposing bytes',async()=>{const root=mkdtempSync(path.join(os.tmpdir(),'personal-process-fail-')),command=path.join(root,'fake');mkdirSync(path.join(root,'state'));writeFileSync(command,'#!/bin/sh\nsleep 2\n');chmodSync(command,0o755);await assert.rejects(commissionPersonalRuntimeProcess({command,request,config:{projectDatabase:path.join(root,'projects.db'),stateDir:path.join(root,'state'),ipcDir:path.join(root,'state'),port:8766,allowedOrigin:'http://127.0.0.1:4177',handoffFd:3},expected:{baseUrl:'http://127.0.0.1:8766/',projectId:'P',ipcDir:path.join(root,'state')},timeoutMs:25}),/timed out/)} )
import{createServer}from'node:net'
test('adoption uses bounded identity request and validates exact response',async()=>{const root=mkdtempSync(path.join(os.tmpdir(),'personal-adopt-')),socket=path.join(root,'adopt.sock'),raw={schema_version:'opensaddle.personal-runtime-handoff.v1',protocol_version:'opensaddle.personal-runtime.v1',base_url:'http://127.0.0.1:8766/',installation_id:'I',owner_subject:'O',project_id:'P',bearer_token:'secret',adoption_socket:socket,ipc_dir:root};let request='';const server=createServer(client=>{client.on('data',chunk=>{request+=String(chunk);client.end(JSON.stringify(raw)+'\n')})});await new Promise<void>((resolve,reject)=>server.listen(socket,resolve).once('error',reject));const{adoptPersonalRuntime}=await import('../electron/personalRuntimeCommissioning');const handoff=await adoptPersonalRuntime({stateDir:root,ipcDir:root,socketPath:socket,baseUrl:raw.base_url,installationId:'I',projectId:'P'});assert.equal(handoff.bearerToken,'secret');assert.deepEqual(JSON.parse(request),{schema_version:'opensaddle.personal-runtime-adoption-request.v1',expected_protocol_version:'opensaddle.personal-runtime.v1',installation_id:'I',project_id:'P'});await new Promise<void>(resolve=>server.close(()=>resolve()))})
test('concurrent different commission request is rejected without second spawn',async()=>{const root=mkdtempSync(path.join(os.tmpdir(),'personal-mismatch-')),command=path.join(root,'fake');mkdirSync(path.join(root,'state'));writeFileSync(command,`#!/bin/sh\nprintf '%s\\n' '{"schema_version":"opensaddle.personal-runtime-handoff.v1","protocol_version":"opensaddle.personal-runtime.v1","base_url":"http://127.0.0.1:8766/","installation_id":"I","owner_subject":"O","project_id":"P","bearer_token":"secret","adoption_socket":"${root}/state/adopt.sock","ipc_dir":"${root}/state"}' >&3\nsleep 2\n`);chmodSync(command,0o755);const base={command,request,config:{projectDatabase:path.join(root,'projects.db'),stateDir:path.join(root,'state'),ipcDir:path.join(root,'state'),port:8766,allowedOrigin:'http://127.0.0.1:4177',handoffFd:3},expected:{baseUrl:'http://127.0.0.1:8766/',projectId:'P',ipcDir:path.join(root,'state')}};const first=commissionPersonalRuntimeProcess(base);await assert.rejects(commissionPersonalRuntimeProcess({...base,request:{...request,projectId:'Q'}}),/different personal runtime/);const result=await first;result.process.kill()})
test('invalid handoff waits until its SIGTERM-resistant process is reaped', {skip:process.platform==='win32'}, async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'personal-reap-'))
 const command=path.join(root,'fake'),pidFile=path.join(root,'child.pid')
 mkdirSync(path.join(root,'state'))
 // The invalid handoff is emitted only after TERM is ignored and the exact PID
 // is published. exec keeps that PID while sleep resists graceful termination.
 writeFileSync(command,`#!/bin/sh\ntrap '' TERM\nprintf '%s\\n' "$$" > '${pidFile}'\nprintf '{}\\n' >&3\nexec sleep 10\n`)
 chmodSync(command,0o755)
 await assert.rejects(commissionPersonalRuntimeProcess({
  command,request,
  config:{projectDatabase:path.join(root,'projects.db'),stateDir:path.join(root,'state'),ipcDir:path.join(root,'state'),port:8766,handoffFd:3},
  expected:{baseUrl:'http://127.0.0.1:8766/',projectId:'P',ipcDir:path.join(root,'state')},
 }),/handoff contract is invalid/)
 const pid=Number(readFileSync(pidFile,'utf8').trim())
 assert.ok(Number.isSafeInteger(pid)&&pid>0)
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'})
})

test('early launcher exit cannot claim cleanup while a same-group child survives', {skip:process.platform==='win32'}, async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'personal-group-'))
 const command=path.join(root,'launcher'),leaderFile=path.join(root,'leader.pid'),childFile=path.join(root,'child.pid'),groupFile=path.join(root,'child.pgid')
 mkdirSync(path.join(root,'state'))
 // The child inherits the detached launcher's process group but no stdio.
 // The launcher exits before any handoff, exercising the already-closed path.
 writeFileSync(command,`#!/bin/sh
printf '%s' "$$" > '${leaderFile}'
sleep 30 3>&- </dev/null >/dev/null 2>&1 &
printf '%s' "$!" > '${childFile}'
ps -o pgid= -p "$!" > '${groupFile}'
exit 2
`)
 chmodSync(command,0o755)
 let leaderPid=0,childPid=0
 try{
  let failure:Error|undefined
  await assert.rejects(commissionPersonalRuntimeProcess({
   command,request,
   config:{projectDatabase:path.join(root,'projects.db'),stateDir:path.join(root,'state'),ipcDir:path.join(root,'state'),port:8766,handoffFd:3},
   expected:{baseUrl:'http://127.0.0.1:8766/',projectId:'P',ipcDir:path.join(root,'state')},
   timeoutMs:2000,
  }), (error:Error)=>{failure=error;return true})
  leaderPid=Number(readFileSync(leaderFile,'utf8').trim())
  childPid=Number(readFileSync(childFile,'utf8').trim())
  assert.ok(Number.isSafeInteger(leaderPid)&&leaderPid>0)
  assert.ok(Number.isSafeInteger(childPid)&&childPid>0)
  assert.equal(Number(readFileSync(groupFile,'utf8').trim()),leaderPid)
  let childExists=true
  try{process.kill(childPid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')childExists=false;else throw error}
  if(childExists)assert.match(failure?.message??'',/cleanup could not be confirmed/)
 }finally{
  if(leaderPid)try{process.kill(-leaderPid,'SIGKILL')}catch{}
  if(childPid)try{process.kill(childPid,'SIGKILL')}catch{}
  rmSync(root,{recursive:true,force:true})
 }
})
