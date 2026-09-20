import { RemoteMalleableShellClient } from './remoteMalleableShell'

type Json = Record<string, unknown>
const object = (value: unknown): Json => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Agent result review response is invalid')
  return value as Json
}
const identity = (value: unknown): string => {
  if (typeof value !== 'string' || !value || value.length > 512 || [...value].some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127)) throw Error('Agent result identity is invalid')
  return value
}
const digest = (value: unknown): string => {
  const result = identity(value)
  if (!/^[a-f0-9]{64}$/.test(result)) throw Error('Agent result digest is invalid')
  return result
}

export type AgentResultDecision = 'accepted' | 'rejected'
export type AgentResultReview = {reviewId:string;artifactId:string;artifactDigest:string;revision:number;decision:AgentResultDecision;note:string;reviewedBy:string;reviewedAt:string;isCurrent:boolean}
export type AgentResult = {projectId:string;runId:string;artifactId:string;artifactDigest:string;reviewRevision:number;canReview:boolean;review:AgentResultReview|null;text:string}

/** Reads Core's exact final native-agent artifact, then rechecks authority after its bytes arrive. */
export class AgentResultReviewClient {
  private readonly baseUrl:string
  private readonly user:()=>string
  private readonly token?:string
  constructor(baseUrl:string,user:()=>string,token?:string){this.baseUrl=baseUrl;this.user=user;this.token=token}
  private async envelope(projectId:string,runId:string,body?:unknown) {
    const subject=this.user()
    const response=await fetch(`${this.baseUrl.replace(/\/$/,'')}/api/v2/runs/${encodeURIComponent(runId)}/agent-result/review`,{
      method:body===undefined?'GET':'POST',
      headers:{'X-OpenSaddle-User':subject,...(this.token?{Authorization:`Bearer ${this.token}`}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    })
    if(subject!==this.user())throw Error('Agent result review account changed')
    if(!response.ok)throw Error(`Agent result review unavailable (${response.status}). Refresh to check current access and result state.`)
    const value=object(await response.json())
    if(subject!==this.user())throw Error('Agent result review account changed')
    if(value.schema_version!=='opensaddle.agent-result-review.v1'||value.project_id!==projectId||value.run_id!==runId||value.scope!=='historical_run_result_only'||typeof value.can_review!=='boolean'||!Number.isSafeInteger(value.review_revision)||(value.review_revision as number)<0)throw Error('Agent result review identity is invalid')
    const artifactId=identity(value.artifact_id),artifactDigest=digest(value.artifact_digest)
    let review:AgentResultReview|null=null
    if(value.review!==null){
      const row=object(value.review)
      if(row.artifact_id!==artifactId||row.artifact_digest!==artifactDigest||(row.decision!=='accepted'&&row.decision!=='rejected')||typeof row.note!=='string'||row.note.length>1000||!Number.isSafeInteger(row.revision)||(row.revision as number)<1||(row.revision as number)>(value.review_revision as number)||typeof row.is_current!=='boolean'||row.is_current!==((row.revision as number)===value.review_revision))throw Error('Agent result decision binding is invalid')
      review={reviewId:identity(row.review_id),artifactId,artifactDigest,revision:row.revision as number,decision:row.decision,note:row.note,reviewedBy:identity(row.reviewed_by),reviewedAt:identity(row.reviewed_at),isCurrent:row.is_current}
    }
    return {projectId,runId,artifactId,artifactDigest,reviewRevision:value.review_revision as number,canReview:value.can_review as boolean,review}
  }
  async read(projectId:string,runId:string):Promise<AgentResult>{
    const subject=this.user(),before=await this.envelope(projectId,runId)
    const content=await new RemoteMalleableShellClient(this.baseUrl,this.user,this.token).content({project_id:projectId,run_id:runId,artifact_id:before.artifactId,digest:before.artifactDigest})
    if(subject!==this.user())throw Error('Agent result review account changed')
    const after=await this.envelope(projectId,runId)
    if(subject!==this.user()||after.artifactId!==before.artifactId||after.artifactDigest!==before.artifactDigest||after.reviewRevision!==before.reviewRevision)throw Error('Agent result review changed during read')
    return {...after,text:content.text}
  }
  async decide(result:AgentResult,decision:AgentResultDecision,intentId:string):Promise<void>{
    if(!result.canReview||!['accepted','rejected'].includes(decision)||!/^[-A-Za-z0-9._~]{1,200}$/.test(intentId))throw Error('Agent result decision is unavailable')
    const response=await this.envelope(result.projectId,result.runId,{artifact_id:result.artifactId,expected_artifact_digest:result.artifactDigest,decision,expected_review_revision:result.reviewRevision,idempotency_key:intentId})
    if(response.artifactId!==result.artifactId||response.artifactDigest!==result.artifactDigest||response.review?.decision!==decision)throw Error('Agent result decision receipt changed identity')
  }
}
