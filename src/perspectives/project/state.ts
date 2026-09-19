import {migrateApplicationState,validateApplicationState,validateApplicationStateSchema,type ApplicationState} from '../../applications/applicationState'
import type {ApplicationRendererDescriptor} from '../../services/contracts'

// Presentation convenience only. Restored state never grants authority.
const key=(scope:string,projectId:string,renderer:ApplicationRendererDescriptor)=>JSON.stringify(['opensaddle.project-view-state.v1',scope,projectId,renderer.application_id,renderer.instance_id,renderer.package_ref.package_id,renderer.package_ref.version,renderer.package_ref.manifest_digest,renderer.state_schema_version])
const priorKey=(scope:string,projectId:string,renderer:ApplicationRendererDescriptor)=>JSON.stringify(['opensaddle.project-view-prior.v1',scope,projectId,renderer.application_id,renderer.instance_id,renderer.package_ref.package_id])
function schemaIdentity(value:unknown){
 const schema=validateApplicationStateSchema(value)
 if(!schema)return
 return JSON.stringify([schema.maxProperties,[...(schema.required??[])].sort(),Object.entries(schema.properties).sort(([a],[b])=>a.localeCompare(b)).map(([name,p])=>[name,p.type,p.maxLength,p.minimum,p.maximum])])
}
export function projectViewState(value:unknown,renderer:ApplicationRendererDescriptor):ApplicationState|undefined{
 const state=validateApplicationState(value,renderer.state_schema)
 if(!state||!Number.isSafeInteger(renderer.state_max_bytes)||renderer.state_max_bytes<0)return
 return new TextEncoder().encode(JSON.stringify(state)).byteLength<=Math.min(renderer.state_max_bytes,8192)?state:undefined
}
export function readProjectViewState(scope:string|undefined,projectId:string,renderer:ApplicationRendererDescriptor,onMigration?:()=>void){
 if(!scope)return
 try{
  const raw=sessionStorage.getItem(key(scope,projectId,renderer))
  if(raw!==null)return raw.length<=8192?projectViewState(JSON.parse(raw),renderer):undefined
  const previous=sessionStorage.getItem(priorKey(scope,projectId,renderer))
  if(!previous||previous.length>32768)return
  const prior=JSON.parse(previous)
  if(!prior||!Number.isSafeInteger(prior.version)||prior.version<1||!validateApplicationStateSchema(prior.schema))return
  if(prior.version===renderer.state_schema_version){
   const targetSchema=schemaIdentity(renderer.state_schema)
   if(!targetSchema||schemaIdentity(prior.schema)!==targetSchema)return
   return projectViewState(prior.state,renderer)
  }
  const migrations=renderer.state_migrations.filter(item=>item.from_version===prior.version&&item.to_version===renderer.state_schema_version)
  if(migrations.length!==1)return
  const migrated=migrateApplicationState(prior.state,prior.schema,renderer.state_schema,migrations[0])
  const result=migrated?projectViewState(migrated,renderer):undefined
  if(result)onMigration?.()
  return result
 }catch{return}
}
export function writeProjectViewState(scope:string|undefined,projectId:string,renderer:ApplicationRendererDescriptor,value:unknown):boolean{
 if(!scope)return false
 const state=projectViewState(value,renderer);if(!state)return false
 try{sessionStorage.setItem(key(scope,projectId,renderer),JSON.stringify(state));sessionStorage.setItem(priorKey(scope,projectId,renderer),JSON.stringify({version:renderer.state_schema_version,schema:renderer.state_schema,state}));return true}catch{return false}
}
