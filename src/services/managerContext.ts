export interface ManagerContext {
 schema_version:'opensaddle.manager-context.v1';generated_at:string;project_ids:string[]
 projects:Array<{project_id:string;status:string|null;objective:string|null;next_action:string|null}>
 active_runs:Array<{project_id:string;run_id:string;task:string|null;status:string|null}>
 outcomes:Array<{project_id:string;run_id:string|null;title:string|null;verified:boolean}>
 attention_items:Array<{project_id:string;title:string|null;requested_action:string|null}>
 truncated:{active_runs:boolean;outcomes:boolean;attention_items:boolean};execution_authority:false
}
export interface ManagerContextAuthority {preview(projectIds:string[]):Promise<ManagerContext>}
function exact(value:any,keys:string[]){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))}
function text(value:unknown,max=1000){return value===null||(typeof value==='string'&&Array.from(value).length<=max)}
function id(value:unknown){return typeof value==='string'&&value.length>0&&value.length<=300}
export class ManagerContextClient implements ManagerContextAuthority {
 private base:string;private user:()=>string;private token?:string
 constructor(base:string,user:()=>string,token?:string){this.base=base.replace(/\/$/,'');this.user=user;this.token=token}
 async preview(projectIds:string[]):Promise<ManagerContext>{
  const selected=[...projectIds],identity=this.user()
  if(!selected.length||selected.length>32||new Set(selected).size!==selected.length||selected.some(value=>typeof value!=='string'||!value.trim()||Array.from(value).length>200))throw Error('Choose between one and 32 distinct Projects.')
  const response=await fetch(this.base+'/api/v2/manager/context',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-OpenSaddle-User':identity,...(this.token?{Authorization:`Bearer ${this.token}`}:{})},body:JSON.stringify({project_ids:selected})})
  if(!response.ok)throw Error(response.status===403?'One or more selected Projects are no longer available. Reload Projects and choose again.':'Manager context could not be loaded.')
  const value=await response.json()
  if(identity!==this.user())throw Error('Manager account changed')
  const row=(item:any)=>item&&selected.includes(item.project_id)
  const array=(items:any,check:(item:any)=>boolean)=>Array.isArray(items)&&items.length<=200&&items.every(check)
  if(!exact(value,['schema_version','generated_at','project_ids','projects','active_runs','outcomes','attention_items','truncated','execution_authority'])||value.schema_version!=='opensaddle.manager-context.v1'||value.execution_authority!==false||typeof value.generated_at!=='string'||!Number.isFinite(Date.parse(value.generated_at))||JSON.stringify(value.project_ids)!==JSON.stringify(selected)
   ||!Array.isArray(value.projects)||value.projects.length!==selected.length||!value.projects.every((item:any,index:number)=>exact(item,['project_id','status','objective','next_action'])&&item.project_id===selected[index]&&text(item.status,100)&&text(item.objective)&&text(item.next_action))
   ||!array(value.active_runs,item=>exact(item,['project_id','run_id','task','status'])&&row(item)&&id(item.run_id)&&text(item.task)&&text(item.status,100))
   ||!array(value.outcomes,item=>exact(item,['project_id','run_id','title','verified'])&&row(item)&&(item.run_id===null||id(item.run_id))&&text(item.title)&&typeof item.verified==='boolean')
   ||!array(value.attention_items,item=>exact(item,['project_id','title','requested_action'])&&row(item)&&text(item.title)&&text(item.requested_action))
   ||!exact(value.truncated,['active_runs','outcomes','attention_items'])||Object.values(value.truncated).some(flag=>typeof flag!=='boolean'))throw Error('Invalid or out-of-scope manager context')
  return value
 }
}
