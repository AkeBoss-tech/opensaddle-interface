export interface TeamSummary {team_id:string;display_name:string;revision:number;viewer_role?:string;role?:string}
export interface TeamDetail extends TeamSummary {members:{subject:string;role:string;state:string}[]}
export class TeamsClient {
 readonly associationsAvailable:boolean
 private base:string;private user:()=>string;private token?:string
 constructor(base:string,user:()=>string,token?:string,associationsAvailable=false){this.associationsAvailable=associationsAvailable;this.base=base.replace(/\/$/,'');this.user=user;this.token=token}
 identity(){return this.user()}
 private async request(path:string,body?:unknown){const identity=this.identity();const response=await fetch(this.base+path,{method:body?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':identity,...(this.token?{Authorization:`Bearer ${this.token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(!response.ok)throw Error('Team request failed. Refresh before trying again.');const value=await response.json();if(identity!==this.identity())throw Error('Team account changed');return value}
 async association(project:string){return association(await this.request(`/api/v2/projects/${encodeURIComponent(project)}/presentation-team`),project)}
 async projects(team:string){const value=await this.request(`/api/v2/teams/${encodeURIComponent(team)}/presentation-projects`);if(!Array.isArray(value.items)||value.items.length>100)throw Error('Invalid associations');return value.items.map((row:any)=>{const result=association(row,row.project_id);if(result.team_id!==team)throw Error('Association Team mismatch');return result}) as ProjectTeamAssociation[]}
 async changeAssociation(project:string,revision:number,action:'propose'|'accept'|'detach',team?:string){return association(await this.request(`/api/v2/projects/${encodeURIComponent(project)}/presentation-team`,{expected_revision:revision,action,...(action==='propose'?{team_id:team}:{})}),project)}
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

export interface ProjectTeamAssociation {project_id:string;team_id:string|null;revision:number;state:'unassigned'|'proposed'|'accepted'|'detached';effective?:boolean}
function association(value:any,project:string):ProjectTeamAssociation{if(!value||typeof project!=='string'||value.project_id!==project||!Number.isSafeInteger(value.revision)||value.revision<0||!['unassigned','proposed','accepted','detached'].includes(value.state)||(value.team_id!==null&&typeof value.team_id!=='string'))throw Error('Invalid association');return value}
