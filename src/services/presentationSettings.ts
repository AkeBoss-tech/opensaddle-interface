export type PresentationScope='user'|'project'|'user_project'|'team'
export type PresentationValues={theme?:'system'|'light'|'dark';density?:'comfortable'|'compact';perspective?:string}
export interface PresentationLayer {scope:PresentationScope;project_id:string|null;owner_subject:string|null;revision:number;can_write:boolean;values:PresentationValues}
export class PresentationSettingsClient {
  private listeners=new Set<()=>void>()
  constructor(privateBase:string,user:()=>string,token?:string){this.base=privateBase.replace(/\/$/,'');this.user=user;this.token=token}
  private base:string;private user:()=>string;private token?:string
  identity(){return this.user()}
  notifyChanged(){this.listeners.forEach(listener=>listener())}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  private path(scope:PresentationScope,projectId?:string){if(scope==='user')return '/api/v2/settings/presentation';if(!projectId)throw Error('Scope required');if(scope==='team')return `/api/v2/teams/${encodeURIComponent(projectId)}/settings/presentation`;return `/api/v2/projects/${encodeURIComponent(projectId)}/settings/presentation/${scope}`}
  private async request(path:string,body?:unknown){const identity=this.identity();const response=await fetch(this.base+path,{method:body?'PUT':'GET',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':identity,...(this.token?{Authorization:`Bearer ${this.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(!response.ok)throw Error(response.status===409?'Settings changed elsewhere. Reload before saving.':'Settings are unavailable for this account or project.');const value=await response.json();if(identity!==this.identity())throw Error('Settings account changed');return value}
  async read(scope:PresentationScope,projectId?:string):Promise<PresentationLayer>{return layer(await this.request(this.path(scope,projectId)),scope,projectId)}
  async replace(scope:PresentationScope,projectId:string|undefined,revision:number,values:PresentationValues){const result=layer(await this.request(this.path(scope,projectId),{expected_revision:revision,values}),scope,projectId);this.listeners.forEach(listener=>listener());return result}
  async effective(projectId?:string):Promise<{values:PresentationValues;provenance:Record<string,string>}>{
    if(!projectId){const value=await this.read('user');return {values:{theme:'system',density:'comfortable',...value.values},provenance:Object.fromEntries(Object.keys(value.values).map(key=>[key,'user']))}}
    const value=await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/settings/presentation/effective`)
    if(value.project_id!==projectId || !value.provenance || typeof value.provenance!=='object')throw Error('Invalid settings resolution')
    return {values:validateValues(value.values),provenance:value.provenance}
  }
}
function validateValues(value:unknown):PresentationValues {if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Invalid preferences');const row=value as Record<string,unknown>;if(Object.keys(row).some(key=>!['theme','density','perspective'].includes(key)) || (row.theme!==undefined&&!['system','light','dark'].includes(String(row.theme))) || (row.density!==undefined&&!['comfortable','compact'].includes(String(row.density))) || (row.perspective!==undefined&&(typeof row.perspective!=='string'||!/^[a-z][a-z0-9._-]{0,99}$/.test(row.perspective))))throw Error('Invalid preferences');return row as PresentationValues}
function layer(value:any,scope:PresentationScope,projectId?:string):PresentationLayer {if(typeof value.can_write!=='boolean'||value.scope!==scope||(scope==='team'?value.team_id!==projectId:value.project_id!==(scope==='user'?null:projectId))||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('Invalid settings scope');return {...value,values:validateValues(value.values)}}
