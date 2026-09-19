export interface DashboardLayout {schema_version:'opensaddle.dashboard-layout.v1';owner_subject:string;revision:number;widgets:string[]}
export interface DashboardSettings {read():Promise<DashboardLayout>;replace(revision:number,widgets:string[]):Promise<DashboardLayout>}
export const DEFAULT_DASHBOARD_WIDGETS=['objective','attention','runs','projects','outcomes']
export class DashboardSettingsClient implements DashboardSettings {
 private base:string;private user:()=>string;private token?:string
 constructor(base:string,user:()=>string,token?:string){this.base=base;this.user=user;this.token=token}
 identity(){return this.user()}
 private async request(body?:unknown):Promise<DashboardLayout>{
  const identity=this.user()
  const response=await fetch(this.base.replace(/\/$/,'')+'/api/v2/settings/dashboard',{method:body?'PUT':'GET',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':identity,...(this.token?{Authorization:`Bearer ${this.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
  if(!response.ok)throw Error(response.status===409?'Dashboard changed elsewhere. Your draft is preserved; reload the saved layout before trying again.':'Dashboard settings could not be loaded or saved.')
  const value=await response.json()
  if(identity!==this.user())throw Error('Dashboard account changed')
  if(value.schema_version!=='opensaddle.dashboard-layout.v1'||typeof value.owner_subject!=='string'||!value.owner_subject||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.widgets)||value.widgets.length>32||value.widgets.some((id:unknown)=>typeof id!=='string'||!/^[a-z][a-z0-9._-]{0,99}$/.test(id))||new Set(value.widgets).size!==value.widgets.length)throw Error('Invalid dashboard layout')
  return value
 }
 read(){return this.request()}
 replace(revision:number,widgets:string[]){return this.request({expected_revision:revision,widgets})}
}
