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
  const projects = data.projects.filter((project) => project.workspaceKind === 'local')
  const latestProject = projects[0]
  return <div className="content-page connected-local-page">
    <header className="page-header"><div><span className="eyebrow">Trusted local workflow</span><h1>Start governed work</h1><p>Bring in a repository, inspect the proposed onboarding change, and approve only the exact diff you intend to keep.</p></div><Button onClick={() => window.dispatchEvent(new Event('opensaddle:add-project'))}>Add project</Button></header>
    <section className="settings-card" aria-live="polite">
      <h2>Ready check</h2>
      <p><strong>{services?.controlPlane.connected ? 'Connected' : 'Not connected'}</strong> · {services?.controlPlane.storage ?? 'local storage'}</p>
      <p>{runnerStatus}</p>
    </section>
    <section className="settings-card">
      <div className="section-heading"><div><h2>{latestProject ? 'Continue' : 'Your first run'}</h2><p>{latestProject ? 'Return to the most recently available governed workspace.' : 'Add a Git repository to begin discovery and onboarding.'}</p></div></div>
      {latestProject ? (
        <button className="list-row" type="button" onClick={() => navigate(`/project/${latestProject.id}`)}>
          <span><strong>{latestProject.name}</strong><small>Open project workspace</small></span><span>Continue →</span>
        </button>
      ) : <div className="empty-state"><p>No workspace is ready yet.</p><Button onClick={() => window.dispatchEvent(new Event('opensaddle:add-project'))}>Choose a folder</Button></div>}
    </section>
  </div>
}
