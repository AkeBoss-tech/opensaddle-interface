import {validateApplicationState,type ApplicationState} from '../../applications/applicationState'
import type {ApplicationRendererCandidate} from '../../services/contracts'
import type {ViewScope} from '../../services/scopedRenderers'

// Local presentation state only; never an authority or automatic task context.
function key(serverAccount:string,scope:ViewScope,item:ApplicationRendererCandidate,instance:string){return JSON.stringify(['opensaddle.scoped-view-state.v1',serverAccount,scope.kind,scope.id,item.package_id,item.package_version,item.manifest_digest,item.application_id,instance,item.state_schema_version])}
function validated(value:unknown,item:ApplicationRendererCandidate):ApplicationState|undefined{
 const state=validateApplicationState(value,item.state_schema)
 if(!state||!Number.isSafeInteger(item.state_max_bytes)||item.state_max_bytes<0||new TextEncoder().encode(JSON.stringify(state)).byteLength>Math.min(8192,item.state_max_bytes))return
 return state
}
export function readScopedViewState(serverAccount:string,scope:ViewScope,item:ApplicationRendererCandidate,instance:string){
 try{const raw=localStorage.getItem(key(serverAccount,scope,item,instance));return raw&&raw.length<=8192?validated(JSON.parse(raw),item):undefined}catch{return}
}
export function writeScopedViewState(serverAccount:string,scope:ViewScope,item:ApplicationRendererCandidate,instance:string,value:unknown):boolean{
 const state=validated(value,item);if(!state)return false
 try{localStorage.setItem(key(serverAccount,scope,item,instance),JSON.stringify(state));return true}catch{return false}
}
