import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../../data/store'
import { ProjectKnowledgePanel } from './ProjectKnowledgePanel'
import { ExtensionCatalogPanel } from './ExtensionCatalogPanel'

export function ConnectedProjectKnowledgePage() {
  const { projectId = '' } = useParams()
  const { data, services } = useStore()
  const project = data.projects.find(item => item.id === projectId)
  const reviewed = useCallback(() => {}, [])
  return <section className="content-page connected-project-view" key={projectId}><header><span>{project?.name ?? projectId}</span><h1>Knowledge</h1><p>Inspect and manage the source documents available to this project.</p></header>{services?.projectKnowledge ? <ProjectKnowledgePanel authority={services.projectKnowledge} projectId={projectId} onReviewed={reviewed}/> : <div className="settings-card"><h2>Set up project knowledge</h2><p>Connect this project to a personal runtime to capture and review its sources.</p><Link to="/settings">Open runtime settings</Link></div>}</section>
}

export function ConnectedProjectPluginsPage() {
  const { projectId = '' } = useParams()
  return <ProjectPlugins key={projectId} projectId={projectId}/>
}
function ProjectPlugins({ projectId }: { projectId: string }) {
  const { data, services } = useStore()
  const project = data.projects.find(item => item.id === projectId)
  const [error, setError] = useState('')
  const onError = useCallback((message: string) => setError(message), [])
  return <section className="content-page connected-project-view"><header><span>{project?.name ?? projectId}</span><h1>Plugins &amp; views</h1><p>Extensions add tools, workflows, and specialized views to this project.</p></header>{error && <p role="alert">{error}</p>}{services?.extensions ? <ExtensionCatalogPanel projectId={projectId} client={services.extensions} onError={onError}/> : <div className="settings-card"><h2>Project extensions are not available on this runtime</h2><p>Your built-in project views are ready to use. Installed extension details require a server that supports the project extension catalog.</p><Link to="/settings">View connection settings</Link></div>}<section className="settings-card"><h2>Built-in project views</h2><div className="connected-view-grid"><Link to={`/project/${projectId}`}>Overview<small>Repository and project profile</small></Link><Link to={`/project/${projectId}/collaboration`}>Tasks<small>Run work and inspect results</small></Link><Link to={`/project/${projectId}/knowledge`}>Knowledge<small>Sources and review history</small></Link><Link to={`/project/${projectId}/onboarding`}>Onboarding<small>Review proposed setup changes</small></Link></div></section></section>
}
