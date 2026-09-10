/** Bundle into a signed renderer fragment; never load remotely at runtime. */
export function connectScopedView({onInit, scope, timeoutMs=10000}) {
 if(!['user','team'].includes(scope)||typeof onInit!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Invalid scoped view configuration')
 let envelope,capabilities=[],pending,disposed=false
 const fields=['protocol','nonce','generation','instance_id','connection_key']
 const packageFields=['package_id','version','manifest_digest']
 const valid=value=>value&&value.protocol==='opensaddle.application.v1'&&typeof value.nonce==='string'&&value.nonce.length>0&&Number.isSafeInteger(value.generation)&&value.generation>0&&typeof value.instance_id==='string'&&typeof value.connection_key==='string'&&packageFields.every(key=>typeof value.package_ref?.[key]==='string')
 const matches=value=>valid(value)&&fields.every(key=>value[key]===envelope[key])&&packageFields.every(key=>value.package_ref[key]===envelope.package_ref[key])
 const send=value=>window.parent.postMessage({...envelope,...value},'*')
 const settle=(error,value)=>{if(!pending)return;const task=pending;pending=undefined;clearTimeout(task.timer);error?task.reject(error):task.resolve(value)}
 const listener=event=>{
  if(disposed||event.source!==window.parent)return
  const message=event.data
  if(!envelope){
   if(!valid(message)||message.kind!=='init'||message.model?.schema_version!=='opensaddle.scoped-view.v1'||message.model.scope?.kind!==scope||typeof message.model.scope.id!=='string'||!Array.isArray(message.model.capabilities)||!message.model.capabilities.every(value=>typeof value==='string'))return
   envelope=Object.fromEntries(fields.map(key=>[key,message[key]]));envelope.package_ref=Object.fromEntries(packageFields.map(key=>[key,message.package_ref[key]]))
   capabilities=[...message.model.capabilities]
   try{onInit({scope:{...message.model.scope},capabilities:[...capabilities],state:message.state});send({kind:'ready'})}catch{send({kind:'failure'});dispose()}
   return
  }
  if(!matches(message))return
  if(message.kind==='ping'&&typeof message.request_id==='string'){send({kind:'pong',request_id:message.request_id});return}
  if(!pending||message.request_id!==pending.id)return
  if(message.kind==='resource_error')settle(Error('Resource unavailable'))
  else if(message.kind==='resources'&&message.resource===pending.resource)settle(null,message.value)
 }
 function request(action,resource,capability,extra){
  if(disposed||!envelope)return Promise.reject(Error('View is not connected'))
  if((scope!=='user'&&capability!=='view.settings.read')||!capabilities.includes(capability))return Promise.reject(Error('Capability unavailable'))
  if(pending)return Promise.reject(Error('A resource request is already pending'))
  return new Promise((resolve,reject)=>{
   const id=crypto.randomUUID()
   pending={id,resource,resolve,reject,timer:setTimeout(()=>settle(Error('Resource request timed out')),timeoutMs)}
   try{send({kind:'request',action,request_id:id,...extra})}catch(error){settle(error)}
  })
 }
 function dispose(){if(disposed)return;disposed=true;window.removeEventListener('message',listener);settle(Error('View disconnected'))}
 window.addEventListener('message',listener)
 return {
  saveState(state){if(disposed||!envelope)throw Error('View is not connected');send({kind:'state',state})},
  readSettings(){return request('read_settings','view_settings','view.settings.read',{})},
  readDevices(after=''){if(typeof after!=='string'||after.length>512)return Promise.reject(Error('Invalid cursor'));return request('read_devices','owner_devices','owner.devices.read',{after})},
  readDeviceActivity(deviceId){if(typeof deviceId!=='string'||!deviceId)return Promise.reject(Error('Invalid device'));return request('read_device_activity','owner_device_activity','owner.device-activity.read',{device_id:deviceId})},
  dispose,
 }
}
