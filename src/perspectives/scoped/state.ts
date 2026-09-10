import {migrateApplicationState,validateApplicationStateSchema,validateApplicationState,type ApplicationState} from '../../applications/applicationState'
import type {ApplicationRendererCandidate} from '../../services/contracts'
import type {ViewScope} from '../../services/scopedRenderers'

// Local presentation state only; never an authority or automatic task context.
function key(serverAccount:string,scope:ViewScope,item:ApplicationRendererCandidate,instance:string){return JSON.stringify(['opensaddle.scoped-view-state.v1',serverAccount,scope.kind,scope.id,item.package_id,item.package_version,item.manifest_digest,item.application_id,instance,item.state_schema_version])}
function priorKey(serverAccount:string,scope:ViewScope,item:ApplicationRendererCandidate,instance:string){return JSON.stringify(['opensaddle.scoped-view-prior.v1',serverAccount,scope.kind,scope.id,item.package_id,item.application_id,instance])}
function validated(value:unknown,item:ApplicationRendererCandidate):ApplicationState|undefined{
 const state=validateApplicationState(value,item.state_schema)
 if(!state||!Number.isSafeInteger(item.state_max_bytes)||item.state_max_bytes<0||new TextEncoder().encode(JSON.stringify(state)).byteLength>Math.min(8192,item.state_max_bytes))return
 return state
}
export function readScopedViewState(serverAccount:string,scope:ViewScope,item:ApplicationRendererCandidate,instance:string){
 try{
  const raw=localStorage.getItem(key(serverAccount,scope,item,instance))
  if(raw!==null)return raw.length<=8192?validated(JSON.parse(raw),item):undefined
  const previous=localStorage.getItem(priorKey(serverAccount,scope,item,instance))
  if(!previous||previous.length>32768)return
  const prior=JSON.parse(previous)
  if(!Number.isSafeInteger(prior?.version)||prior.version<1||!validateApplicationStateSchema(prior.schema)||!item.state_compatibility?.accepts_from_versions.includes(prior.version))return
  // Equal schema versions still require the same declared schema. A changed
  // schema must use an explicit versioned migration, never a lossy cast.
  if(prior.version===item.state_schema_version){
   if(JSON.stringify(prior.schema)!==JSON.stringify(item.state_schema))return
   return validated(prior.state,item)
  }
  const migrations=item.state_migrations.filter(migration=>migration.from_version===prior.version&&migration.to_version===item.state_schema_version)
  if(migrations.length!==1)return
  const migrated=migrateApplicationState(prior.state,prior.schema,item.state_schema,migrations[0])
  return migrated?validated(migrated,item):undefined
 }catch{return}
}
export function writeScopedViewState(serverAccount:string,scope:ViewScope,item:ApplicationRendererCandidate,instance:string,value:unknown):boolean{
 const state=validated(value,item);if(!state)return false
 try{localStorage.setItem(key(serverAccount,scope,item,instance),JSON.stringify(state));localStorage.setItem(priorKey(serverAccount,scope,item,instance),JSON.stringify({version:item.state_schema_version,schema:item.state_schema,state}));return true}catch{return false}
}
