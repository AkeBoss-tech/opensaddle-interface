import type {ProjectTaskModel,ProjectTaskCard} from '../perspectives/project/model'
export interface ProjectTaskFeedAuthority {read(projectId:string,signal?:AbortSignal):Promise<ProjectTaskModel>}
export class ProjectTaskFeedClient implements ProjectTaskFeedAuthority {
 constructor(privateBase:string,user:()=>string,token?:string){this.base=privateBase.replace(/\/$/,'');this.user=user;this.token=token}
 private base:string;private user:()=>string;private token?:string
 async read(projectId:string,signal?:AbortSignal){
  const subject=this.user(),tasks:ProjectTaskCard[]=[],seen=new Set<string>();let after=''
  const page=async(cursor:string)=>{const response=await fetch(`${this.base}/api/v2/projects/${encodeURIComponent(projectId)}/task-feed?${new URLSearchParams({after:cursor,limit:'100'})}`,{cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':subject,...(this.token?{Authorization:`Bearer ${this.token}`}:{})}});if(!response.ok)throw Error('Project task feed unavailable');const value=await response.json();if(signal?.aborted||subject!==this.user()||value.schema_version!=='opensaddle.project-task-feed.v1'||value.project_id!==projectId||!Array.isArray(value.items)||value.items.length>100||(value.next_cursor!==null&&typeof value.next_cursor!=='string'))throw Error('Invalid Project task feed');return value}
  do{const value=await page(after)
   for(const item of value.items){if(!item||typeof item.id!=='string'||!item.id||item.id<=after||seen.has(item.id)||typeof item.title!=='string'||typeof item.status!=='string'||!item.status||item.verification!=='not_assessed')throw Error('Invalid Project task item');seen.add(item.id);tasks.push({id:item.id,title:item.title,status:item.status,verified:false,source:['completed','failed','cancelled'].includes(item.status)?'result':'active_run'});after=item.id}
   if(value.next_cursor!==null&&(value.items.length===0||value.next_cursor!==after||tasks.length>=1000))throw Error('Project task feed exceeds supported pagination')
   if(value.next_cursor===null)break
  }while(true)
  await page('') // Recheck current membership after collecting multiple pages.
  return {projectId,tasks}
 }
}
