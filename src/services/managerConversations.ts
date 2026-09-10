import type {TaskResult} from '../features/runs/TaskResultPanel'
import type {JourneyAuthority,JourneySnapshot,NativeAdapterId} from '../features/onboarding/ConnectedJourneySurface'
export interface ManagerScope {revision:number;project_ids:string[]}
export interface ManagerConversation {project_id?:string;conversation_id:string;title:string;version:number;scope:ManagerScope;created_at:string;updated_at:string;provider_execution:false}
export interface ManagerMessage {message_id:string;thread_id:string;sequence:number;role:'user';content:string;payload:{manager_scope:ManagerScope;provider_status:'not_started'}}
export interface ManagerConversationView {conversation:ManagerConversation;messages:ManagerMessage[]}
export interface ManagerChildTask {include_conversation_context?:boolean;project_id:string;run_id:string|null;status:string}
export interface ManagerConversationsAuthority {
 readonly conversationContext?:boolean
 readonly fixedProject?:string
 childTasks?:boolean
 childResults?:boolean
 childResult?(conversationId:string,messageId:string,projectId:string,runId:string):Promise<TaskResult>
 taskOptions?(projectId:string):Promise<JourneySnapshot>
 dispatch?(conversation:ManagerConversation,messageId:string,projectId:string,sourceId:string,adapter:NativeAdapterId,includeContext?:boolean):Promise<ManagerChildTask>
 dispatches?(conversationId:string,messageId:string):Promise<ManagerChildTask[]>

 list():Promise<ManagerConversation[]>
 open(id:string):Promise<ManagerConversationView>
 create(title:string,projects:string[]):Promise<ManagerConversation>
 append(conversation:ManagerConversation,content:string):Promise<void>
 scope(conversation:ManagerConversation,projects:string[]):Promise<void>
}
const integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0
function validScope(value:any):value is ManagerScope{return value&&integer(value.revision)&&Array.isArray(value.project_ids)&&value.project_ids.length>0&&value.project_ids.length<=32&&new Set(value.project_ids).size===value.project_ids.length&&value.project_ids.every((id:unknown)=>typeof id==='string'&&id.trim()&&Array.from(id).length<=200)}
function conversation(value:any):ManagerConversation{if(!value||typeof value.conversation_id!=='string'||!/^mgr_[a-f0-9]{64}$/.test(value.conversation_id)||typeof value.title!=='string'||Array.from(value.title).length>1000||!integer(value.version)||!validScope(value.scope)||value.provider_execution!==false||typeof value.created_at!=='string'||typeof value.updated_at!=='string')throw Error('Invalid manager conversation');return value}
const contextErrors:Record<string,string>={
 conversation_prior_task_still_active:'Wait for earlier tasks in this conversation to finish before including context.',
 conversation_prior_dispatch_unconfirmed:'Reload earlier task status before including conversation context.',
 conversation_context_exceeds_32_messages:'This history exceeds 32 messages. Send only this message or start a new conversation.',
 conversation_context_exceeds_task_limit:'This history exceeds the task size limit. Send only this message or start a new conversation.',
 manager_child_result_unavailable:'An earlier task result is unavailable for context. Send only this message or inspect that task.',
}
export class ManagerConversationsClient implements ManagerConversationsAuthority {
 private base:string;private user:()=>string;private token?:string;private intents=new Map<string,string>()
 private journey?:Pick<JourneyAuthority,'snapshot'>
 readonly fixedProject?:string
 readonly childTasks:boolean
 readonly conversationContext:boolean
 readonly childResults:boolean
 constructor(base:string,user:()=>string,token?:string,journey?:Pick<JourneyAuthority,'snapshot'>,childResults=false,projectId?:string,conversationContext=false){this.conversationContext=Boolean(projectId)&&conversationContext;this.fixedProject=projectId;this.journey=journey;this.childTasks=Boolean(journey);this.childResults=this.childTasks&&childResults;this.base=base.replace(/\/$/,'');this.user=user;this.token=token}
 private checked(value:any){const result=conversation(value);if(this.fixedProject&&(result.project_id!==this.fixedProject||JSON.stringify(result.scope.project_ids)!==JSON.stringify([this.fixedProject])))throw Error('Project conversation scope mismatch');return result}
 private project(id:string){if(this.fixedProject&&id!==this.fixedProject)throw Error('Project is outside this conversation')}
 private async request(path:string,method='GET',body?:unknown){const user=this.user();const response=await fetch(this.base+(this.fixedProject?'/api/v2/projects/'+encodeURIComponent(this.fixedProject)+'/conversations':'/api/v2/manager/conversations')+path,{method,cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':user,...(this.token?{Authorization:`Bearer ${this.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(!response.ok){const failure=await response.json().catch(()=>null);if(typeof failure?.detail==='string'&&Object.hasOwn(contextErrors,failure.detail))throw Error(contextErrors[failure.detail]);throw Error(response.status===409?'Conversation changed. Reload it; your draft is preserved.':response.status===403||response.status===404?'Conversation or Project access is unavailable.':'Manager conversation request failed. Your draft is preserved.')}const value=await response.json();if(user!==this.user())throw Error('Manager account changed');return value}
 private async intent(operation:string,payload:unknown){const user=this.user();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))).map(value=>value.toString(16).padStart(2,'0')).join('');if(user!==this.user())throw Error('Manager account changed');const key=JSON.stringify(this.fixedProject?['opensaddle.project-intent.v1',this.base,this.fixedProject,user,operation,digest]:['opensaddle.manager-intent.v1',this.base,user,operation,digest]);const storage=typeof sessionStorage==='undefined'?undefined:sessionStorage;let id=storage?storage.getItem(key):this.intents.get(key);if(!id){id=crypto.randomUUID();if(storage){storage.setItem(key,id);if(storage.getItem(key)!==id)throw Error('Conversation intent could not be saved')}else this.intents.set(key,id)}return {id,clear:()=>{if(storage)storage.removeItem(key);else this.intents.delete(key)}}}
 async childResult(conversationId:string,messageId:string,projectId:string,runId:string){
  if(!this.childResults)throw Error('Manager child results unavailable')
  this.project(projectId);const user=this.user(),result=await this.request('/'+encodeURIComponent(conversationId)+'/messages/'+encodeURIComponent(messageId)+(this.fixedProject?'/result':'/dispatches/'+encodeURIComponent(projectId)+'/result'))
  if(result.conversation_id!==conversationId||result.message_id!==messageId||result.project_id!==projectId||result.run_id!==runId||typeof result.artifact_id!=='string'||!result.artifact_id||typeof result.digest!=='string'||!(/^[a-f0-9]{64}$/).test(result.digest)||typeof result.text!=='string'||result.result_kind!=='native_task_output'||result.verification!=='not_assessed')throw Error('Manager task result mismatch')
  const bytes=new TextEncoder().encode(result.text)
  if(bytes.byteLength>262144)throw Error('Manager task result too large')
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(value=>value.toString(16).padStart(2,'0')).join('')
  if(user!==this.user()||digest!==result.digest)throw Error('Manager task result authority or integrity changed')
  return {runId,resource:{artifact_id:result.artifact_id,digest},text:result.text}
 }
 async taskOptions(projectId:string){this.project(projectId);if(!this.journey)throw Error('Manager task dispatch unavailable');const user=this.user(),value=await this.journey.snapshot(projectId);if(user!==this.user()||value.projectId!==projectId)throw Error('Manager task scope changed');return value}
 async dispatch(value:ManagerConversation,messageId:string,projectId:string,sourceId:string,adapter:NativeAdapterId,includeContext=false){
  if(includeContext&&!this.conversationContext)throw Error('Conversation context is unavailable on this connection')
  this.project(projectId);this.checked(value)
  if(!this.childTasks||!value.scope.project_ids.includes(projectId))throw Error('Project is outside this conversation')
  const result=await this.request('/'+encodeURIComponent(value.conversation_id)+'/messages/'+encodeURIComponent(messageId)+'/dispatch','POST',{expected_version:value.version,expected_scope_revision:value.scope.revision,project_id:projectId,source_id:sourceId,native_adapter_id:adapter,...(includeContext?{include_conversation_context:true}:{})})
  if(result.conversation_id!==value.conversation_id||result.message_id!==messageId||result.project_id!==projectId||typeof result.run_id!=='string'||!result.run_id||typeof result.status!=='string'||result.manager_reply_available!==false)throw Error('Manager task receipt mismatch')
  return {project_id:projectId,run_id:result.run_id,status:result.status,...(includeContext?{include_conversation_context:true}:{})}
 }
 async dispatches(conversationId:string,messageId:string){
  if(!this.childTasks)throw Error('Manager task dispatch unavailable')
  const result=await this.request('/'+encodeURIComponent(conversationId)+'/messages/'+encodeURIComponent(messageId)+'/dispatches')
  if(result.conversation_id!==conversationId||result.message_id!==messageId||!Array.isArray(result.items)||result.items.length>32||new Set(result.items.map((item:any)=>item.project_id)).size!==result.items.length||result.items.some((item:any)=>!item||typeof item.project_id!=='string'||!item.project_id||!(item.run_id===null||typeof item.run_id==='string'&&item.run_id)||typeof item.status!=='string'||(item.include_conversation_context!==undefined&&typeof item.include_conversation_context!=='boolean')))throw Error('Invalid manager task listing')
  if(this.fixedProject&&result.items.some((item:any)=>item.project_id!==this.fixedProject))throw Error('Project task listing mismatch')
  return result.items as ManagerChildTask[]
 }
 async list(){const items:ManagerConversation[]=[],seen=new Set<string>(),cursors=new Set<string>();let cursor='';do{const page=await this.request('?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(!Array.isArray(page.items)||page.items.length>100||(page.next_cursor!==null&&typeof page.next_cursor!=='string'))throw Error('Invalid manager conversation page');for(const item of page.items){const value=this.checked(item);if(seen.has(value.conversation_id))throw Error('Conversation list changed; reload it');seen.add(value.conversation_id);items.push(value)}if(page.next_cursor&&(cursors.has(page.next_cursor)||cursors.size>=20||items.length>=1000))throw Error('Conversation list exceeds supported page limits');cursor=page.next_cursor??'';cursors.add(cursor)}while(cursor);return items}
 async open(id:string){const value=this.checked(await this.request('/'+encodeURIComponent(id)));if(value.conversation_id!==id)throw Error('Conversation identity mismatch');const messages:ManagerMessage[]=[],cursors=new Set<string>();let cursor='',sequence=0;do{const page=await this.request('/'+encodeURIComponent(id)+'/messages?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(page.provider_execution!==false||page.conversation_version!==value.version||!Array.isArray(page.items)||page.items.length>100||(page.next_cursor!==null&&typeof page.next_cursor!=='string'))throw Error('Conversation changed; reload it');for(const message of page.items){if(message.thread_id!==id||typeof message.message_id!=='string'||!integer(message.sequence)||message.sequence<=sequence||message.role!=='user'||typeof message.content!=='string'||Array.from(message.content).length>20000||!validScope(message.payload?.manager_scope)||message.payload.provider_status!=='not_started')throw Error('Invalid manager message');if(this.fixedProject&&JSON.stringify(message.payload.manager_scope.project_ids)!==JSON.stringify([this.fixedProject]))throw Error('Project message scope mismatch');sequence=message.sequence;messages.push(message)}cursor=page.next_cursor??'';if(cursor&&(cursors.has(cursor)||messages.length>=1000))throw Error('Message history exceeds supported page limits');cursors.add(cursor)}while(cursor);const latest=this.checked(await this.request('/'+encodeURIComponent(id)));if(latest.conversation_id!==id||latest.version!==value.version||JSON.stringify(latest.scope)!==JSON.stringify(value.scope))throw Error('Conversation changed; reload it');return {conversation:value,messages}}
 async create(title:string,projects:string[]){if(this.fixedProject&&JSON.stringify(projects)!==JSON.stringify([this.fixedProject]))throw Error('Project conversation scope mismatch');const user=this.user();const intent=await this.intent('create',{title,projects});if(user!==this.user())throw Error('Manager account changed');const value=this.checked(await this.request('','POST',{request_id:intent.id,title,...(this.fixedProject?{}:{project_ids:projects})}));if(value.title!==title||JSON.stringify(value.scope.project_ids)!==JSON.stringify(projects))throw Error('Created conversation scope mismatch');intent.clear();return value}
 async append(value:ManagerConversation,content:string){this.checked(value);const user=this.user();const intent=await this.intent('message',{id:value.conversation_id,scope:value.scope,content});if(user!==this.user())throw Error('Manager account changed');const result=await this.request('/'+encodeURIComponent(value.conversation_id)+'/messages','POST',{request_id:intent.id,expected_version:value.version,expected_scope_revision:value.scope.revision,content});if(result.provider_execution!==false||result.message?.thread_id!==value.conversation_id||result.message?.content!==content||result.message?.role!=='user'||result.message?.client_message_id!==intent.id||result.message?.message_id!=='msg_'+intent.id||!integer(result.conversation_version)||result.message?.payload?.provider_status!=='not_started'||JSON.stringify(result.message?.payload?.manager_scope)!==JSON.stringify(value.scope))throw Error('Saved message receipt mismatch');intent.clear()}
 async scope(value:ManagerConversation,projects:string[]){if(this.fixedProject||value.project_id)throw Error('Project conversation scope is fixed');const result=this.checked(await this.request('/'+encodeURIComponent(value.conversation_id)+'/scope','PUT',{expected_version:value.version,expected_scope_revision:value.scope.revision,project_ids:projects}));if(result.conversation_id!==value.conversation_id||JSON.stringify(result.scope.project_ids)!==JSON.stringify(projects))throw Error('Saved scope mismatch')}
}
