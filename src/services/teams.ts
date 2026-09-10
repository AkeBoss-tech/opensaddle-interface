export interface TeamSummary {team_id:string;display_name:string;revision:number;viewer_role?:string;role?:string}
export interface TeamDetail extends TeamSummary {members:{subject:string;role:string;state:string}[]}
export class TeamsClient {
 private base:string;private user:()=>string;private token?:string
 constructor(base:string,user:()=>string,token?:string){this.base=base.replace(/\/$/,'');this.user=user;this.token=token}
 identity(){return this.user()}
 private async request(path:string,body?:unknown){const identity=this.identity();const response=await fetch(this.base+path,{method:body?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':identity,...(this.token?{Authorization:`Bearer ${this.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(!response.ok)throw Error('Team request failed. Refresh before trying again.');const value=await response.json();if(identity!==this.identity())throw Error('Team account changed');return value}
 async list(){return this.items(await this.request('/api/v2/teams'))}
 async invitations(){return this.items(await this.request('/api/v2/team-invitations'))}
 private items(value:any):TeamSummary[]{if(!Array.isArray(value.items)||value.items.length>100)throw Error('Invalid Team list');return value.items.map(summary)}
 async create(name:string){return summary(await this.request('/api/v2/teams',{display_name:name}))}
 async read(id:string):Promise<TeamDetail>{const value=await this.request(`/api/v2/teams/${encodeURIComponent(id)}`);if(summary(value).team_id!==id||!Array.isArray(value.members)||value.members.some((member:any)=>typeof member.subject!=='string'||!['owner','admin','member'].includes(member.role)||!['invited','active'].includes(member.state)))throw Error('Invalid Team roster');return value}
 async invite(id:string,revision:number,subject:string,role:string){return this.request(`/api/v2/teams/${encodeURIComponent(id)}/invitations`,{expected_revision:revision,subject,role})}
 async accept(id:string,revision:number){return this.request(`/api/v2/teams/${encodeURIComponent(id)}/accept`,{expected_revision:revision})}
 async remove(id:string,revision:number,subject:string){return this.request(`/api/v2/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(subject)}/remove`,{expected_revision:revision})}
}
function summary(value:any):TeamSummary{if(!value||typeof value.team_id!=='string'||typeof value.display_name!=='string'||!Number.isSafeInteger(value.revision)||value.revision<1)throw Error('Invalid Team');return value}
