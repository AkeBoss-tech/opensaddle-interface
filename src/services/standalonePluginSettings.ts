import {rendererSettingsContract,type RendererSettingsContract,type RendererSettingsAuthority,type RendererSettingsSnapshot} from './rendererSettings'
import {validateApplicationState,type ApplicationState} from '../applications/applicationState'
import type {ApplicationRendererDescriptor} from './contracts'
export type StandalonePluginEnrollment={package_id:string;version:string;manifest_digest:string;application_id:string}
export interface StandalonePluginPreference {
 settings_key:string
 package_ref:ApplicationRendererDescriptor['package_ref']
 application_id:string
 contract:RendererSettingsContract
 layer:{scope:'user'|'team';revision:number;can_write:boolean;values:ApplicationState}
}
const canonical=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,JSON.parse(canonical(item))])):value)
export class StandalonePluginSettingsClient {
 private base:string;private user:()=>string;private token?:string
 constructor(base:string,user:()=>string,token?:string){this.base=base.replace(/\/$/,'');this.user=user;this.token=token}
 identity(){return this.user()}
 private async request(teamId?:string,key?:string,revision?:number,values?:ApplicationState,enrollment?:StandalonePluginEnrollment):Promise<StandalonePluginPreference[]> {
  const actor=this.identity(),scope=teamId===undefined?'user':'team'
  if(teamId!==undefined&&!teamId)throw Error('A team is required.')
  const path=teamId===undefined?'/api/v2/settings/plugins':`/api/v2/teams/${encodeURIComponent(teamId)}/settings/plugins`
  const response=await fetch(this.base+path+(key?'/'+encodeURIComponent(key):''),{method:enrollment?'POST':key?'PUT':'GET',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':actor,...(this.token?{Authorization:'Bearer '+this.token}:{}),...((key||enrollment)?{'Content-Type':'application/json'}:{})},body:enrollment?JSON.stringify({...enrollment,values:{}}):key?JSON.stringify({expected_revision:revision,values}):undefined})
  if(!response.ok)throw Error(response.status===409?'Preferences changed. Discard your draft and reload before saving.':'Plugin preferences are unavailable for this account or team.')
  const result=await response.json()
  if(actor!==this.identity()||result.schema_version!=='opensaddle.standalone-plugin-settings.v1'||result.viewer_subject!==actor||result.scope!==scope||result.team_id!==(teamId??null)||!Array.isArray(result.items)||result.items.length>1000)throw Error('Plugin preference identity changed.')
  const keys=new Set<string>()
  for(const item of result.items){
   const contract=rendererSettingsContract(item.contract),ref=item.package_ref,layer=item.layer
   if(!contract||!contract.scopes.includes(scope)||typeof item.settings_key!=='string'||!/^[a-f0-9]{64}$/.test(item.settings_key)||keys.has(item.settings_key)||typeof item.application_id!=='string'||!item.application_id||!ref||typeof ref.package_id!=='string'||!ref.package_id||typeof ref.version!=='string'||!ref.version||typeof ref.manifest_digest!=='string'||!/^[a-f0-9]{64}$/.test(ref.manifest_digest)||!layer||layer.scope!==scope||!Number.isSafeInteger(layer.revision)||layer.revision<0||typeof layer.can_write!=='boolean'||!validateApplicationState(layer.values,{...contract.values_schema,required:[]}))throw Error('Invalid plugin preference directory.')
   keys.add(item.settings_key)
  }
  return result.items
 }
 async enroll(value:StandalonePluginEnrollment,teamId?:string){
  if(Object.keys(value).sort().join(',')!=='application_id,manifest_digest,package_id,version'||!value.package_id||value.package_id.length>200||!value.version||value.version.length>100||!value.application_id||value.application_id.length>200||!/^[a-f0-9]{64}$/.test(value.manifest_digest))throw Error('Enter an exact package reference and application ID.')
  const rows=await this.request(teamId,undefined,undefined,undefined,value)
  const created=rows.find(item=>item.application_id===value.application_id&&item.package_ref.package_id===value.package_id&&item.package_ref.version===value.version&&item.package_ref.manifest_digest===value.manifest_digest)
  if(!created||created.layer.revision!==1||Object.keys(created.layer.values).length!==0)throw Error('Setup could not be confirmed. Reload plugin preferences before retrying.')
  return rows
 }
 list(teamId?:string){return this.request(teamId)}
 // Adapts scoped preferences to the shared host form, without executable renderer fields.
 editor(item:StandalonePluginPreference,teamId?:string):RendererSettingsAuthority {
  const scope=teamId===undefined?'user':'team'
  const snapshot=(rows:StandalonePluginPreference[]):RendererSettingsSnapshot=>{
   const current=rows.find(row=>row.settings_key===item.settings_key)
   if(!current||canonical(current.package_ref)!==canonical(item.package_ref)||current.application_id!==item.application_id||canonical(current.contract)!==canonical(item.contract))throw Error('Plugin package changed. Reload the directory.')
   return {contract:current.contract,layers:[current.layer],effective:{values:{...current.contract.defaults,...current.layer.values},provenance:Object.fromEntries(Object.keys(current.contract.defaults).map(key=>[key,Object.hasOwn(current.layer.values,key)?scope:'default']))}}
  }
  return {identity:()=>this.identity(),read:async()=>snapshot(await this.list(teamId)),replace:async(_project,_renderer,selected,revision,values)=>{
   if(selected!==scope||!Number.isSafeInteger(revision)||revision<0||!validateApplicationState(values,{...item.contract.values_schema,required:[]}))throw Error('Invalid plugin preferences.')
   const result=snapshot(await this.request(teamId,item.settings_key,revision,values))
   if(result.layers[0].revision!==revision+1||canonical(result.layers[0].values)!==canonical(values))throw Error('Preference save could not be confirmed.')
   return result
  }}
 }
}
