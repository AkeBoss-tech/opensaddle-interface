import { Link, Navigate } from 'react-router-dom'
import { useStore } from '../../data/store'
import { useProjectDirectory } from '../shell/useProjectDirectory'

export function ConnectedTaskStartPage() {
  const { services } = useStore()
  const { projects, loading, error } = useProjectDirectory('/start')
  if (!services?.projectDirectory) return <main className="content-page"><h1>New task</h1><p role="alert">The connected Project directory is unavailable.</p></main>
  if (loading) return <main className="content-page"><h1>New task</h1><p role="status">Loading your Projects…</p></main>
  if (!error && projects.length === 1) return <Navigate replace to={`/project/${encodeURIComponent(projects[0].id)}/new-task`} />
  return <main className="content-page"><h1>New task</h1>
    {error ? <p role="alert">{error}</p> : projects.length ? <><p>Choose the Project for this task.</p><nav aria-label="Task Project">{projects.map(project => <Link className="list-row" key={project.id} to={`/project/${encodeURIComponent(project.id)}/new-task`}>{project.name}</Link>)}</nav></> : <p>No authorized Projects are available. <Link to="/settings">Open connection settings</Link></p>}
  </main>
}
