import test from 'node:test'
import assert from 'node:assert/strict'
import {connectScopedView} from './index.js'
// SCOPED-SDK-1: SDK wire boundary; the embedding browser/parent is external.
test('SDK fences parent messages, bounds reads, handles liveness and cleans up',async()=>{
 const prior=globalThis.window,listeners=new Set(),sent=[],parent={postMessage:message=>sent.push(message)}
 globalThis.window={parent,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)}
 const emit=(data,source=parent)=>{for(const fn of listeners)fn({source,data})}
 const init={protocol:'opensaddle.application.v1',kind:'init',nonce:'nonce',generation:1,instance_id:'main',connection_key:'connection',package_ref:{package_id:'view',version:'1',manifest_digest:'a'.repeat(64)},model:{schema_version:'opensaddle.scoped-view.v1',scope:{kind:'user',id:'owner'},capabilities:['owner.devices.read']},state:{filter:'saved'}}
 let initialized
 const sdk=connectScopedView({scope:'user',onInit:value=>initialized=value,timeoutMs:20})
 try{
  emit(init,{});assert.equal(initialized,undefined)
  emit(init);assert.deepEqual(initialized.state,{filter:'saved'});assert.equal(sent.at(-1).kind,'ready');assert.equal(sent.at(-1).model,undefined)
  const read=sdk.readDevices(),id=sent.at(-1).request_id
  await assert.rejects(sdk.readDevices(),/already pending/)
  emit({...init,kind:'resources',nonce:'stale',request_id:id,resource:'owner_devices',value:'wrong'})
  emit({...init,kind:'resources',request_id:id,resource:'owner_devices',value:{items:[]}})
  assert.deepEqual(await read,{items:[]})
  emit({...init,kind:'ping',request_id:'probe'});assert.equal(sent.at(-1).kind,'pong')
  await assert.rejects(sdk.readDeviceActivity('device'),/Capability unavailable/)
  await assert.rejects(sdk.readDevices(),/timed out/)
  const outstanding=sdk.readDevices();sdk.dispose();await assert.rejects(outstanding,/disconnected/);assert.equal(listeners.size,0)
 }finally{sdk.dispose();globalThis.window=prior}
})
