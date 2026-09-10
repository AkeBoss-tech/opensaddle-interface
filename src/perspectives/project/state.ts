import {validateApplicationState,type ApplicationState} from '../../applications/applicationState'
import type {ApplicationRendererDescriptor} from '../../services/contracts'

// Presentation convenience only. Restored state never grants authority.
const key=(scope:string,projectId:string,renderer:ApplicationRendererDescriptor)=>JSON.stringify(['opensaddle.project-view-state.v1',scope,projectId,renderer.application_id,renderer.instance_id,renderer.package_ref.package_id,renderer.package_ref.version,renderer.package_ref.manifest_digest,renderer.state_schema_version])
export function projectViewState(value:unknown,renderer:ApplicationRendererDescriptor):ApplicationState|undefined{
 const state=validateApplicationState(value,renderer.state_schema)
 if(!state||!Number.isSafeInteger(renderer.state_max_bytes)||renderer.state_max_bytes<0)return
 return new TextEncoder().encode(JSON.stringify(state)).byteLength<=Math.min(renderer.state_max_bytes,8192)?state:undefined
}
export function readProjectViewState(scope:string|undefined,projectId:string,renderer:ApplicationRendererDescriptor){
 if(!scope)return
 try{const raw=sessionStorage.getItem(key(scope,projectId,renderer));return raw&&raw.length<=8192?projectViewState(JSON.parse(raw),renderer):undefined}catch{return}
}
export function writeProjectViewState(scope:string|undefined,projectId:string,renderer:ApplicationRendererDescriptor,value:unknown):boolean{
 if(!scope)return false
 const state=projectViewState(value,renderer);if(!state)return false
 try{sessionStorage.setItem(key(scope,projectId,renderer),JSON.stringify(state));return true}catch{return false}
}
