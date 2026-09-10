import { useProjectDirectory } from './useProjectDirectory'
import { useEffect } from 'react'
import { Folder, Home, Plus, Settings, ListTodo, Activity, Users, ArrowUpRight, Laptop } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import './connected-workspace.css'

export function ConnectedWorkspaceSidebar({ onAddProject }: { onAddProject: () => void }) {
  const { services } = useStore()
  const location = useLocation()
  const {projects,error,loading}=useProjectDirectory(location.pathname)
  useEffect(() => { document.getElementById('sidebar')?.classList.remove('mobile-open') }, [location.pathname])
  const selectedId = location.pathname.split('/')[1] === 'project' ? decodeURIComponent(location.pathname.split('/')[2] ?? '') : undefined
  const selected = projects.find(project => project.id === selectedId)
  return <aside className="sidebar connected-sidebar" id="sidebar">
    <div className="connected-workspace-rail" aria-label="Workspace rail"><Link to="/home" aria-label="OpenSaddle home" className="connected-rail-home"><Icon name="saddle" className="icon sm" /></Link>{projects.map(project => <Link key={project.id} to={`/project/${project.id}`} aria-label={project.name} title={project.name} className={project.id === selectedId ? 'selected' : ''}>{project.name.slice(0,2).toUpperCase()}</Link>)}{services?.localProjects && <button onClick={onAddProject} aria-label="Add project to workspace"><Plus size={18}/></button>}</div><div className="connected-brand">{selected?.name ?? 'OpenSaddle'}<span>{selected ? 'Project workspace' : 'Local workspace'}</span></div>
    <nav aria-label="Connected workflow" className="connected-navigation">
      <NavLink to="/home"><Home size={17}/>Home</NavLink>
      <NavLink to="/start"><Plus size={17}/>New task</NavLink>
      <NavLink to="/work"><ListTodo size={17}/>Work</NavLink>
    </nav>
    {selected && <nav aria-label="Project views" className="connected-navigation connected-project-views"><span>Views</span><NavLink end to={`/project/${selected.id}`}>Workspace</NavLink><NavLink to={`/project/${selected.id}/overview`}>Overview</NavLink><NavLink to={`/project/${selected.id}/collaboration`}>Tasks</NavLink><NavLink to={`/project/${selected.id}/knowledge`}>Knowledge</NavLink><NavLink to={`/project/${selected.id}/onboarding`}>Onboarding</NavLink><NavLink to={`/project/${selected.id}/plugins`}>Plugins</NavLink><NavLink to={`/project/${selected.id}/devices`}>Devices</NavLink><NavLink to={`/project/${selected.id}/appearance`}>Appearance</NavLink></nav>}
    {!selectedId && <><div className="connected-project-heading"><span>Projects</span>{services?.localProjects && <button aria-label="Add project" onClick={onAddProject}><Plus size={16}/></button>}</div>
    <nav aria-label="Projects" className="connected-project-list">
      {projects.map(project => <NavLink key={project.id} to={`/project/${project.id}`}><Folder size={17}/><span>{project.name}</span></NavLink>)}
      {!projects.length && <p>{loading?'Loading projects…':error||'Your projects will appear here.'}</p>}
      {services?.localProjects && <button className="connected-add-project" onClick={onAddProject}><Plus size={16}/>Add project</button>}
    </nav></>}
    <nav aria-label="Workspace tools" className="connected-navigation connected-bottom">
      <NavLink to="/operations"><Activity size={17}/>Operations</NavLink>
      <NavLink to="/collaboration"><Users size={17}/>People &amp; machines</NavLink>
      <NavLink to="/devices"><Laptop size={17}/>Devices</NavLink>
      <NavLink to="/settings"><Settings size={17}/>Settings</NavLink>
    </nav>
  </aside>
}

export function ConnectedWorkspaceHome({ onAddProject }: { onAddProject: () => void }) {
  const { data, services } = useStore()
  return <section className="connected-home">
    <header><span className="connected-kicker">YOUR WORKSPACE</span><h1>What would you like to work on?</h1><p>Choose a project to start a task, explore its knowledge, or review recent work.</p></header>
    <div className="connected-home-actions">
      {services?.localProjects && <button onClick={onAddProject}><Plus size={20}/><span>Add a project<small>Open a folder on this Mac</small></span><ArrowUpRight size={16}/></button>}
      <Link to="/work"><ListTodo size={20}/><span>Review your work<small>Tasks, progress, and results</small></span><ArrowUpRight size={16}/></Link>
    </div>
    <section className="connected-home-projects"><h2>Projects</h2>
      {data.projects.length ? data.projects.map(project => <Link key={project.id} to={`/project/${project.id}`}><Folder size={20}/><span>{project.name}<small>Open project</small></span><ArrowUpRight size={16}/></Link>) : <div className="connected-project-empty"><Folder size={24}/><h3>A place for your next idea</h3><p>Add a project folder to get started. Your files stay on this Mac.</p></div>}
    </section>
    {!services?.personalRuntime && <p className="connected-home-setup">After adding a project, <Link to="/settings">set up your local runtime</Link> to run tasks with your installed coding agent.</p>}
  </section>
}
