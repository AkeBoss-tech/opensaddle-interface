export interface DirectoryProject {id:string;name:string;role:string}
export class ProjectDirectoryClient {
  private baseUrl:string
  private user:()=>string
  private token?:string
  constructor(baseUrl:string,user:()=>string,token?:string){this.baseUrl=baseUrl.replace(/\/$/,'');this.user=user;this.token=token}
  identity(){return this.user()}
  async list():Promise<DirectoryProject[]> {
    const identity=this.identity(), projects:DirectoryProject[]=[],seen=new Set<string>()
    let after='',viewer:string|undefined
    do {
      const response=await fetch(`${this.baseUrl}/api/v2/projects?limit=100&after=${encodeURIComponent(after)}`,{cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':identity,...(this.token?{Authorization:`Bearer ${this.token}`}:{})}})
      if(!response.ok)throw Error('Project directory unavailable')
      const value=await response.json()
      if(identity!==this.identity())throw Error('Project account changed')
      if(value.schema_version!=='opensaddle.project-directory.v1' || typeof value.viewer_subject!=='string' || (viewer!==undefined && viewer!==value.viewer_subject) || !Array.isArray(value.items) || value.items.length>100 || (value.next_cursor!==null && typeof value.next_cursor!=='string'))throw Error('Invalid project directory')
      viewer=value.viewer_subject
      for(const item of value.items){
        if(typeof item.project_id!=='string' || !item.project_id || item.project_id<=after || seen.has(item.project_id) || typeof item.display_name!=='string' || typeof item.membership_role!=='string')throw Error('Invalid project entry')
        seen.add(item.project_id);projects.push({id:item.project_id,name:item.display_name,role:item.membership_role})
      }
      if(value.next_cursor!==null && (value.next_cursor<=after || value.next_cursor!==projects.at(-1)?.id))throw Error('Invalid project cursor')
      after=value.next_cursor??''
      if(after && projects.length>=10000)throw Error('Project directory exceeds supported size')
    } while(after)
    return projects
  }
}
