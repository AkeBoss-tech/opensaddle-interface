export interface HistoryMessage {ordinal:number;role:'user'|'assistant';text:string}
export interface HistoryItem {
  session_id:string;project_id:string;owner_subject:string;device_id:string
  provider:'codex'|'claude'|'cursor';source_session_id:string;title:string
  source_updated_at:number;message_count:number;truncated:boolean
  visibility:'private'|'project';revision:number;updated_at:string;read_only:true
}
export interface HistoryDetail extends HistoryItem {messages:HistoryMessage[]}
export interface HistoryHit {session_id:string;provider:HistoryItem['provider'];title:string;owner_subject:string;visibility:HistoryItem['visibility'];updated_at:string;ordinal:number;role:HistoryMessage['role'];snippet:string}

export class HistorySyncClient {
  private base:string
  private user:()=>string
  private token?:string
  constructor(base:string,user:()=>string,token?:string){this.base=base;this.user=user;this.token=token}
  isMine(item:HistoryItem){return item.owner_subject===this.user()}
  private async request(projectId:string,path:string,method='GET',body?:unknown):Promise<any>{
    const identity=this.user()
    const response=await fetch(`${this.base.replace(/\/$/,'')}/api/v2/projects/${encodeURIComponent(projectId)}/history${path}`,{
      method,cache:'no-store',signal:AbortSignal.timeout(30000),
      headers:{'X-OpenSaddle-User':identity,...(this.token?{Authorization:`Bearer ${this.token}`}:{}),...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,
    })
    if(!response.ok)throw Error(response.status===403||response.status===404?'Project history is unavailable to this account.':response.status===409?'History changed. Reload and try again.':'Project history request failed.')
    const value=await response.json()
    if(identity!==this.user())throw Error('Account changed while loading history.')
    return value
  }
  private item(value:any,projectId:string):HistoryItem{
    if(!value||value.project_id!==projectId||typeof value.session_id!=='string'||!/^his_[a-f0-9]{32}$/.test(value.session_id)
      ||!['codex','claude','cursor'].includes(value.provider)||typeof value.title!=='string'||typeof value.owner_subject!=='string'
      ||!['private','project'].includes(value.visibility)||!Number.isSafeInteger(value.revision)||value.revision<1
      ||!Number.isSafeInteger(value.message_count)||typeof value.updated_at!=='string'||value.read_only!==true)throw Error('Invalid Project history response.')
    return value as HistoryItem
  }
  async list(projectId:string):Promise<HistoryItem[]>{
    const items:HistoryItem[]=[],seen=new Set<string>()
    for(let offset=0;offset<1000;offset+=100){
      const result=await this.request(projectId,`/sessions?offset=${offset}&limit=100`)
      if(!Array.isArray(result.items)||result.items.length>100)throw Error('Invalid Project history page.')
      for(const raw of result.items){const item=this.item(raw,projectId);if(seen.has(item.session_id))throw Error('Project history changed during listing.');seen.add(item.session_id);items.push(item)}
      if(result.items.length<100)return items
    }
    throw Error('Project history exceeds the display limit.')
  }
  async open(projectId:string,id:string):Promise<HistoryDetail>{
    const result=await this.request(projectId,`/sessions/${encodeURIComponent(id)}`)
    this.item(result,projectId)
    if(result.session_id!==id||!Array.isArray(result.messages)||result.messages.length>500
      ||result.messages.some((message:any,index:number)=>message.ordinal!==index||!['user','assistant'].includes(message.role)||typeof message.text!=='string'))throw Error('Invalid Project history transcript.')
    return result as HistoryDetail
  }
  async search(projectId:string,query:string):Promise<HistoryHit[]>{
    const result=await this.request(projectId,`/search?${new URLSearchParams({q:query,limit:'50'})}`)
    if(!Array.isArray(result.items)||result.items.length>50||result.items.some((hit:any)=>!hit||typeof hit.session_id!=='string'||typeof hit.snippet!=='string'||!['codex','claude','cursor'].includes(hit.provider)))throw Error('Invalid Project history search.')
    return result.items as HistoryHit[]
  }
  async visibility(projectId:string,item:HistoryItem,value:'private'|'project'):Promise<HistoryItem>{
    const result=await this.request(projectId,`/sessions/${encodeURIComponent(item.session_id)}/visibility`,'PUT',{visibility:value,expected_revision:item.revision})
    const updated=this.item(result,projectId)
    if(updated.session_id!==item.session_id||updated.visibility!==value||updated.revision!==item.revision+1)throw Error('History sharing receipt mismatch.')
    return updated
  }
}
