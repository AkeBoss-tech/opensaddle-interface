import React,{useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import type {TeamsClient,TeamDetail} from '../../services/teams'
import type {ProjectDirectoryClient,DirectoryProject} from '../../services/projectDirectory'
void React

export function TeamWorkspaceOverview({teamId,client,directory}:{teamId:string;client:TeamsClient;directory?:ProjectDirectoryClient}) {
 const identity=client.identity()
 const [loaded,setLoaded]=useState<{client:TeamsClient;identity:string;id:string;team:TeamDetail;projects:DirectoryProject[];projectsUnavailable:boolean}>()
 const [error,setError]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>{
  let live=true;setLoaded(undefined);setError('')
  void client.read(teamId).then(async team=>{
   let projects:DirectoryProject[]=[],projectsUnavailable=!directory||!client.associationsAvailable
   if(directory&&client.associationsAvailable){
    try {
     const [associations,visible]=await Promise.all([client.projects(teamId),directory.list()])
     const linked=new Set(associations.filter(row=>row.state==='accepted'&&row.effective===true).map(row=>row.project_id))
     projects=visible.filter(project=>linked.has(project.id))
    } catch {projectsUnavailable=true}
   }
   if(live)setLoaded({client,identity,id:teamId,team,projects,projectsUnavailable})
  }).catch(()=>{if(live)setError('This Team could not be loaded. Check your connection and access, then retry.')})
  return()=>{live=false}
 },[client,directory,identity,teamId,revision])
 const current=loaded?.client===client&&loaded.identity===identity&&loaded.id===teamId?loaded:undefined
 return <div className="content-page connected-local-page team-workspace-page">
  <header className="page-header"><div><h1>{current?.team.display_name??'Team workspace'}</h1><p>Shared Projects and workspace preferences.</p></div></header>
  <nav aria-label="Team workspace"><Link className="secondary-btn" to={`/teams/${encodeURIComponent(teamId)}/settings`}>Team settings and views</Link>
  <button className="secondary-btn" onClick={()=>setRevision(value=>value+1)}>Refresh Team</button></nav>
  {error?<p role="alert">{error}</p>:!current?<p role="status">Loading Team…</p>:<>
   <section className="settings-card presentation-editor"><h2>Members</h2><p>{current.team.members.filter(member=>member.state==='active').length} active members</p><Link to="/teams">Manage membership</Link></section>
   <section className="settings-card presentation-editor"><h2>Projects sharing Team settings</h2>
    {current.projectsUnavailable?<p>Project associations are unavailable for this account or server.</p>:current.projects.length?<ul>{current.projects.map(project=><li key={project.id}><Link to={`/project/${encodeURIComponent(project.id)}`}>{project.name}</Link></li>)}</ul>:<p>No accessible Projects currently share this Team’s settings.</p>}
   </section>
  </>}
 </div>
}
