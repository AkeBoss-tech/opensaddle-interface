import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'
import { evaluatePermissions } from '../services/permissions'

export function AgentsPage() {
  const { projectId } = useParams()
  const { data, createChat, toast } = useStore()
  const nav = useNavigate()
  const [filter, setFilter] = useState('')

  const agents = useMemo(() => {
    let list = data.agents
    if (projectId) list = list.filter((a) => a.projectId === projectId)
    if (filter.trim()) {
      const q = filter.toLowerCase()
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
    }
    return list
  }, [data.agents, projectId, filter])

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">Separate from chats</div>
          <h1>Agents</h1>
          <p>Harness definitions, live sessions, effective permissions, and assigned workflows — managed independently from conversations.</p>
        </div>
        <div className="page-header-actions">
          <input placeholder="Filter agents" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Link className="secondary-btn" to="/workflows">Workflows</Link>
          <Link className="secondary-btn" to="/permissions">Permissions</Link>
        </div>
      </div>

      <div className="task-summary">
        <div className="summary-card"><span className="label">Agents</span><strong>{agents.length}</strong></div>
        <div className="summary-card"><span className="label">Active sessions</span><strong>{data.agentSessions.filter((s) => s.status === 'running').length}</strong></div>
        <div className="summary-card"><span className="label">Waiting</span><strong>{data.agentSessions.filter((s) => s.status === 'waiting').length}</strong></div>
        <div className="summary-card"><span className="label">Workflows</span><strong>{data.workflows.length}</strong></div>
      </div>

      <div className="wiki-people-grid">
        {agents.map((agent) => {
          const project = data.projects.find((p) => p.id === agent.projectId)
          const sessions = data.agentSessions.filter((s) => s.agentId === agent.id)
          const wfs = data.workflows.filter((w) => w.agentIds.includes(agent.id))
          const exec = evaluatePermissions(data.permissionGrants, {
            userId: data.currentUserId,
            agentId: agent.id,
            resourceKind: 'project',
            resourceId: agent.projectId,
            action: 'execute',
          })
          return (
            <article className="card wiki-person" key={agent.id}>
              <div className="card-header">
                <div>
                  <h3>{agent.name}</h3>
                  <p>{project?.name} · {agent.harness} · {agent.modelPolicy}</p>
                </div>
                <span className={`status-pill ${exec.allowed ? 'green' : 'red'}`}>{exec.allowed ? 'Executable' : 'Blocked'}</span>
              </div>
              <div className="card-body">
                <p className="wiki-person-copy">{agent.description}</p>
                <div className="mini-tags">
                  {agent.tools.map((t) => <span className="mini-tag" key={t}>{t}</span>)}
                  <span className="mini-tag">{agent.visibility}</span>
                </div>
                <div className="wiki-section">
                  <h4>Sessions</h4>
                  {sessions.length ? sessions.map((s) => (
                    <div className="wiki-bullet" key={s.id}><Icon name="activity" className="icon sm" /><span>{s.title} · {s.status} · {s.model}</span></div>
                  )) : <div className="row-sub">No active sessions</div>}
                </div>
                <div className="wiki-section">
                  <h4>Workflows</h4>
                  {wfs.length ? wfs.map((w) => (
                    <div className="wiki-bullet" key={w.id}><Icon name="clock" className="icon sm" /><span>{w.name}</span></div>
                  )) : <div className="row-sub">Not assigned</div>}
                </div>
                <div className="scope-box" style={{ marginTop: 12 }}>
                  <strong>Effective access</strong>
                  <p>{exec.reason}{exec.approvalRequired ? ' · approval required for writes' : ''}</p>
                </div>
                <div className="row-actions" style={{ marginTop: 12 }}>
                  <button className="tiny-btn" onClick={() => {
                    const c = createChat(agent.projectId, `Chat with ${agent.name}`, agent.id)
                    nav(`/chat/${c.id}`)
                  }}>Open chat</button>
                  <Link className="tiny-btn" to={`/project/${agent.projectId}`}>Project</Link>
                  <button className="tiny-btn" onClick={() => toast('Test run', `Queued dry-run for ${agent.name}`)}>Test</button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
