export interface RunApprovalReview {
 schema_version:'opensaddle.run-approval-review.v1';run_id:string;project_id:string;task:string;source_ref:string;requested_by:string;
 policy:Record<string,unknown>;review_digest:string;status:string;can_approve:boolean;approval_scope:'run_admission';model_call_authorization:'not_granted'
}
export class RunApprovalReviewClient {
 private base:string;private user:()=>string;private token?:string
 constructor(base:string,user:()=>string,token?:string){this.base=base.replace(/\/$/,'');this.user=user;this.token=token}
 identity(){return this.user()}
 private async request(project:string,run:string,digest?:string){
  const user=this.user();const response=await fetch(`${this.base}/api/v2/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(run)}/approval-review`,{method:digest?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':user,...(this.token?{Authorization:`Bearer ${this.token}`}:{}) ,...(digest?{'Content-Type':'application/json'}:{})},body:digest?JSON.stringify({expected_review_digest:digest}):undefined})
  if(!response.ok)throw Error('Approval review unavailable or changed. Reload the review before trying again.')
  const value=await response.json()
  if(user!==this.user()||value?.run_id!==run||value.project_id!==project||value.approval_scope!=='run_admission'||value.model_call_authorization!=='not_granted'||typeof value.review_digest!=='string'||!/^[a-f0-9]{64}$/.test(value.review_digest))throw Error('Invalid approval review identity')
  return value
 }
 async read(project:string,run:string):Promise<RunApprovalReview>{
  const value=await this.request(project,run)
  if(value.schema_version!=='opensaddle.run-approval-review.v1'||typeof value.can_approve!=='boolean'||['task','source_ref','requested_by','status'].some(key=>typeof value[key]!=='string'||!value[key]||value[key].length>65536)||!value.policy||typeof value.policy!=='object'||Array.isArray(value.policy)||JSON.stringify(value.policy).length>131072||typeof value.policy.policy_hash!=='string'||!value.policy.policy_hash||(value.can_approve&&value.status!=='awaiting_approval'))throw Error('Invalid approval review')
  return {schema_version:value.schema_version,run_id:run,project_id:project,task:value.task,source_ref:value.source_ref,requested_by:value.requested_by,policy:value.policy,review_digest:value.review_digest,status:value.status,can_approve:value.can_approve,approval_scope:value.approval_scope,model_call_authorization:value.model_call_authorization}
 }
 async approve(project:string,run:string,digest:string){
  if(!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid approval review digest')
  const value=await this.request(project,run,digest)
  if(value.review_digest!==digest||value.status!=='queued')throw Error('Approval outcome could not be confirmed. Refresh task status.')
 }
}
