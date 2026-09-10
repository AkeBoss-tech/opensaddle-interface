import {validateApplicationState,validateApplicationStateSchema,type ApplicationState,type ApplicationStateSchema} from '../applications/applicationState'
import type {ApplicationRendererDescriptor} from './contracts'
export type RendererSettingsScope='user'|'team'|'project'|'user_project'
export interface RendererSettingsContract {schema_version:'opensaddle.ui-settings.v1';purpose:'presentation';settings_version:number;scopes:string[];values_schema:ApplicationStateSchema;defaults:ApplicationState;labels:Record<string,string>}
export interface RendererSettingsSnapshot {team_context?:{team_id:string;association_revision:number}|null;contract:RendererSettingsContract;layers:Array<{scope:RendererSettingsScope;revision:number;can_write:boolean;values:ApplicationState}>;effective:{values:ApplicationState;provenance:Record<string,string>}}
export interface RendererSettingsAuthority {identity():string;read(project:string,renderer:ApplicationRendererDescriptor):Promise<RendererSettingsSnapshot>;replace(project:string,renderer:ApplicationRendererDescriptor,scope:RendererSettingsScope,revision:number,values:ApplicationState,teamContext?:RendererSettingsSnapshot['team_context']):Promise<RendererSettingsSnapshot>}
const canonical=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,JSON.parse(canonical(item))])):value)
export function rendererSettingsContract(value:unknown):RendererSettingsContract|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return
 const row=value as RendererSettingsContract
 if(Object.keys(row).sort().join(',')!=='defaults,labels,purpose,schema_version,scopes,settings_version,values_schema'||row.schema_version!=='opensaddle.ui-settings.v1'||row.purpose!=='presentation'||!Number.isSafeInteger(row.settings_version)||row.settings_version<1||row.settings_version>65535||!Array.isArray(row.scopes)||!row.scopes.length||row.scopes.length>4||new Set(row.scopes).size!==row.scopes.length||row.scopes.some(scope=>!['user','team','project','user_project'].includes(scope)))return
 const schema=validateApplicationStateSchema(row.values_schema),defaults=schema&&validateApplicationState(row.defaults,schema)
 if(!schema||!defaults||Object.keys(defaults).length!==Object.keys(schema.properties).length||!row.labels||typeof row.labels!=='object'||Array.isArray(row.labels)||Object.keys(row.labels).sort().join(',')!==Object.keys(schema.properties).sort().join(',')||Object.values(row.labels).some(label=>typeof label!=='string'||!label.length||Array.from(label).length>80||/[\x00-\x1f]/.test(label)))return
 return row
}
export class RendererSettingsClient implements RendererSettingsAuthority{
 private base:string;private user:()=>string;private token?:string
 constructor(base:string,user:()=>string,token?:string){this.base=base.replace(/\/$/,'');this.user=user;this.token=token}
 identity(){return this.user()}
 private async request(project:string,renderer:ApplicationRendererDescriptor,scope?:RendererSettingsScope,revision?:number,values?:ApplicationState,teamContext?:RendererSettingsSnapshot['team_context']){
  const subject=this.user(),contract=rendererSettingsContract(renderer.descriptor?.settings_contract)
  if(!contract)throw Error('This package has no supported settings declaration.')
  if(scope&&(!contract.scopes.includes(scope)||!Number.isSafeInteger(revision)||revision!<0||!validateApplicationState(values,{...contract.values_schema,required:[]})))throw Error('Invalid settings override.')
  if(scope==='team'&&(!teamContext||typeof teamContext.team_id!=='string'||!teamContext.team_id||!Number.isSafeInteger(teamContext.association_revision)||teamContext.association_revision<0))throw Error('Reload the accepted team association before saving.')
  const query=new URLSearchParams({instance_id:renderer.instance_id,package_id:renderer.package_ref.package_id,version:renderer.package_ref.version,manifest_digest:renderer.package_ref.manifest_digest})
  const response=await fetch(`${this.base}/api/v2/projects/${encodeURIComponent(project)}/application-renderers/${encodeURIComponent(renderer.application_id)}/settings${scope?'/'+scope:''}?${query}`,{method:scope?'PUT':'GET',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':subject,...(this.token?{Authorization:'Bearer '+this.token}:{}),...(scope?{'Content-Type':'application/json'}:{})},body:scope?JSON.stringify({expected_revision:revision,values,...(scope==='team'?teamContext:{})}):undefined})
  if(!response.ok)throw Error(response.status===409?'Settings or package changed. Your draft is retained; discard changes and reload before saving.':'Settings are unavailable for this account or package.')
  const result=await response.json(),team=result.team_context
  if(team!=null&&(!contract.scopes.includes('team')||typeof team!=='object'||Object.keys(team).sort().join(',')!=='association_revision,team_id'||typeof team.team_id!=='string'||!team.team_id||!Number.isSafeInteger(team.association_revision)||team.association_revision<0))throw Error('Invalid settings team association.')
  const scopes=['user','team','project','user_project'].filter(item=>contract.scopes.includes(item)&&(item!=='team'||team!=null))
  if(subject!==this.user()||result.schema_version!=='opensaddle.renderer-settings.v1'||result.project_id!==project||result.application_id!==renderer.application_id||result.instance_id!==renderer.instance_id||canonical(result.package_ref)!==canonical(renderer.package_ref)||result.settings_version!==contract.settings_version||canonical(result.contract)!==canonical(contract)||!Array.isArray(result.layers)||result.layers.length!==scopes.length)throw Error('Settings identity or declaration changed.')
  const effective={...contract.defaults},provenance:Record<string,string>=Object.fromEntries(Object.keys(effective).map(key=>[key,'default']))
  for(let index=0;index<scopes.length;index++){const layer=result.layers[index];if(!layer||layer.scope!==scopes[index]||!Number.isSafeInteger(layer.revision)||layer.revision<0||typeof layer.can_write!=='boolean'||!validateApplicationState(layer.values,{...contract.values_schema,required:[]}))throw Error('Invalid settings layer.');Object.assign(effective,layer.values);for(const key of Object.keys(layer.values))provenance[key]=layer.scope}
  if(!result.effective||canonical(result.effective.values)!==canonical(effective)||canonical(result.effective.provenance)!==canonical(provenance))throw Error('Invalid settings resolution.')
  if(scope==='team'&&canonical(team)!==canonical(teamContext))throw Error('Settings team association changed.')
  if(scope){const saved=result.layers.find((layer:any)=>layer.scope===scope);if(saved?.revision!==revision!+1||canonical(saved.values)!==canonical(values))throw Error('Settings save could not be confirmed.')}
  return result as RendererSettingsSnapshot
 }
 read(project:string,renderer:ApplicationRendererDescriptor){return this.request(project,renderer)}
 replace(project:string,renderer:ApplicationRendererDescriptor,scope:RendererSettingsScope,revision:number,values:ApplicationState,teamContext?:RendererSettingsSnapshot['team_context']){return this.request(project,renderer,scope,revision,values,teamContext)}
}
