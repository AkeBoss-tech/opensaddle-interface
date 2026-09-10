import type {ApplicationRendererDescriptor} from '../../services/contracts'
export const PROJECT_VIEW_CONTRACT='opensaddle.project-tasks.v1'
export function installedProjectViews(renderers:ApplicationRendererDescriptor[]){
 const seen=new Set<string>()
 return renderers.filter(renderer=>renderer.authority==='core'&&renderer.execution_trust==='trusted_signed_publisher'&&renderer.input_schema?.$id===PROJECT_VIEW_CONTRACT).map(renderer=>{
  const id=`plugin.${renderer.application_id}`
  if(!/^[a-z][a-z0-9._-]{0,99}$/.test(id)||seen.has(id))throw Error('Invalid or duplicate project Perspective')
  seen.add(id);return {id,title:renderer.application_id,renderer}
 })
}
