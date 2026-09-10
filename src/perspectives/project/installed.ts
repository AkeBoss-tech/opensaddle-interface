import type {ApplicationRendererDescriptor} from '../../services/contracts'
export const PROJECT_VIEW_CONTRACT='opensaddle.project-tasks.v1'
export function installedProjectViews(renderers:ApplicationRendererDescriptor[]){
 const seen=new Set<string>()
 return renderers.filter(renderer=>renderer.authority==='core'&&renderer.execution_trust==='trusted_signed_publisher'&&renderer.input_schema?.$id===PROJECT_VIEW_CONTRACT&&projectViewCompatibility(renderer)===undefined).map(renderer=>{
  const id=`plugin.${renderer.application_id}`
  if(!/^[a-z][a-z0-9._-]{0,99}$/.test(id)||seen.has(id))throw Error('Invalid or duplicate project Perspective')
  seen.add(id);return {id,title:renderer.application_id,renderer}
 })
}

const HOST_API=1
const HOST_CAPABILITIES=new Set(['projection.project-runs.v1','projection.live.v1','navigation.task.open.v1','navigation.task.create.v1','read.project-sources.v1','read.project-devices.v1','read.project-approvals.v1','subscription.resources.v1'])
/** Undefined means compatible. Older signed packages keep the v1 schema contract. */
export function projectViewCompatibility(renderer:ApplicationRendererDescriptor,mount:'perspective'|'widget'='perspective'):string|undefined{
 const contract=renderer.descriptor?.ui_contract
 if(contract===undefined)return mount==='perspective'?undefined:'Widgets require a signed UI contract.'
 if(!contract||typeof contract!=='object'||Array.isArray(contract))return 'Invalid UI contract.'
 const value=contract as Record<string,unknown>,keys=['schema_version','mount_kind','scope','host_api_min','host_api_max','required_capabilities']
 if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||value.schema_version!=='opensaddle.ui-contract.v1')return 'Unsupported UI contract.'
 if(value.mount_kind!==mount||value.scope!=='project')return `This package does not provide a Project ${mount==='perspective'?'Perspective':'widget'}.`
 if(!Number.isSafeInteger(value.host_api_min)||!Number.isSafeInteger(value.host_api_max)||Number(value.host_api_min)<1||Number(value.host_api_max)>65535||Number(value.host_api_min)>HOST_API||Number(value.host_api_max)<HOST_API)return 'This view requires a different host API version.'
 const required=value.required_capabilities
 if(!Array.isArray(required)||required.length>32||new Set(required).size!==required.length||required.some(item=>typeof item!=='string'||!HOST_CAPABILITIES.has(item)))return 'This view requires UI capabilities unavailable in this host.'
 return undefined
}
