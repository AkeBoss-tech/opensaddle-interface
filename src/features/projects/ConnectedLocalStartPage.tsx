import { useNavigate } from 'react-router-dom'
import { useStore } from '../../data/store'
import { Button } from '../../ui'

export function ConnectedLocalStartPage() {
  const { data, services, harnessCapabilities } = useStore()
  const navigate = useNavigate()
  const readyRunners = harnessCapabilities.filter((item) =>
    ['codex', 'claude'].includes(item.id) && item.availability === 'available' && item.readiness === 'ready')
  const reportedRunners = harnessCapabilities.filter((item) => ['codex', 'claude'].includes(item.id))
  const runnerStatus = readyRunners.length
    ? `${readyRunners.map((runner) => runner.label).join(' and ')} ready`
    : reportedRunners.length
      ? reportedRunners.map((runner) => `${runner.label}: ${runner.readiness}`).join(' · ')
      : 'No Codex or Claude runner reported by the control plane'
  return <div className="content-page connected-local-page">
    <header className="page-header"><div><span className="eyebrow">Trusted local workflow</span><h1>Start with a local project</h1><p>OpenSaddle is connected to the loopback control plane. Project discovery and governed execution remain server-authoritative.</p></div></header>
    <section className="settings-card" aria-live="polite">
      <h2>Connection</h2>
      <p><strong>{services?.controlPlane.connected ? 'Connected' : 'Not connected'}</strong> · {services?.controlPlane.storage ?? 'local storage'}</p>
      <p>{runnerStatus}</p>
    </section>
    <section className="settings-card">
      <div className="section-heading"><div><h2>Registered projects</h2><p>Names and roots are projected from the OpenSaddle project registry.</p></div><Button onClick={() => window.dispatchEvent(new Event('opensaddle:add-project'))}>Add local project</Button></div>
      {data.projects.filter((project) => project.workspaceKind === 'local').length ? (
        <div className="list-stack">{data.projects.filter((project) => project.workspaceKind === 'local').map((project) =>
          <button className="list-row" type="button" key={project.id} onClick={() => navigate(`/project/${project.id}`)}>
            <span><strong>{project.name}</strong><small>{project.local?.rootPath}</small></span><span>Open →</span>
          </button>)}</div>
      ) : <div className="empty-state"><p>No local projects are registered yet.</p><Button onClick={() => window.dispatchEvent(new Event('opensaddle:add-project'))}>Choose a folder</Button></div>}
    </section>
  </div>
}
