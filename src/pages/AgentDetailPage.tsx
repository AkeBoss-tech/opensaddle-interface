import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import { evaluatePermissions } from '../services/permissions'

function relativeTime(ts: number) {
  const diff = Date.now() - ts
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const MODEL_NAME: Record<string, string> = {
  auto: 'Auto routing', gpt: 'GPT-5.6', claude: 'Claude Opus', sonnet: 'Claude Sonnet', gemini: 'Gemini', llama: 'Llama (local)',
}

export function AgentDetailPage() {
  const { agentId } = useParams()
  const { data, createChat, toast, services } = useStore()
  const nav = useNavigate()
  const [testing, setTesting] = useState(false)

  const agent = data.agents.find((a) => a.id === agentId)
  const project = data.projects.find((p) => p.id === agent?.projectId)
  if (!agent || !project) return <div className="content-page empty-state"><h3>Agent not found</h3></div>

  const sessions = data.agentSessions.filter((s) => s.agentId === agent.id)
  const workflows = data.workflows.filter((w) => w.agentIds.includes(agent.id))
  const sites = data.sites.filter((s) => s.agentId === agent.id)
  const chats = data.chats.filter((c) => c.agentId === agent.id && !c.archived).slice(0, 6)
  const knowledge = data.knowledge.filter((k) => agent.knowledgeSourceIds.includes(k.id))
  const running = sessions.some((s) => s.status === 'running')

  // Read/write reflect the viewer's own access; execute requires the
  // user ∩ agent grant intersection since the agent acts on their behalf.
  const evalFor = (action: string) => evaluatePermissions(data.permissionGrants, {
    userId: data.currentUserId,
    agentId: action === 'execute' ? agent.id : undefined,
    resourceKind: 'project',
    resourceId: agent.projectId,
    action,
  })
  const exec = evalFor('execute')

  const openChat = () => {
    const c = createChat(agent.projectId, `Chat with ${agent.name}`, agent.id)
    nav(`/chat/${c.id}`)
  }

  const testRun = async () => {
    if (!exec.allowed) { toast('Blocked', exec.reason); return }
    setTesting(true)
    try {
      if (!services?.runtime) {
        toast('Test run', `Queued dry-run for ${agent.name}`)
        return
      }
      const started = await services.runtime.startRun({
        projectId: agent.projectId,
        task: `Dry-run smoke test for ${agent.name}`,
        agentId: agent.id,
        modelKey: agent.modelPolicy,
        harnessKey: agent.harness,
        runtimeKey: agent.runtime,
      })
      toast('Test run', `${started.mode ?? 'started'} · ${started.runId}`)
    } catch (err) {
      toast('Test failed', String(err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="content-page" style={{ maxWidth: 1080 }}>
      <div className="agent-hero">
        <div className="agent-avatar-lg"><Icon name="spark" className="icon lg" /></div>
        <div className="agent-hero-copy">
          <div className="eyebrow">{project.lineage.join(' / ')}</div>
          <h1>{agent.name}</h1>
          <p>{agent.description}</p>
          <div className="agent-hero-tags">
            <span className={`status-pill ${running ? 'green' : ''}`}>{running ? 'Session running' : 'Idle'}</span>
            <span className={`status-pill ${exec.allowed ? 'green' : 'red'}`}>{exec.allowed ? (exec.approvalRequired ? 'Executable · approval on writes' : 'Executable') : 'Blocked for you'}</span>
            <span className="vis-badge">{agent.visibility}</span>
          </div>
        </div>
        <div className="agent-hero-actions">
          <button className="primary-btn" onClick={openChat}><Icon name="message" className="icon sm" />Open chat</button>
          <button className="secondary-btn" disabled={testing} onClick={() => void testRun()}>{testing ? 'Testing…' : 'Test run'}</button>
          <Link className="secondary-btn" to={`/project/${agent.projectId}`}><Icon name="folder" className="icon sm" />Project</Link>
        </div>
      </div>

      <div className="agent-detail-grid">
        <div className="agent-detail-main">
          <div className="card">
            <div className="card-header"><div><h3>System prompt</h3><p>Behavior contract inherited by every run</p></div></div>
            <div className="card-body">
              <div className="api-console" style={{ fontSize: 12, lineHeight: 1.6 }}>{agent.systemPrompt}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div><h3>Sessions</h3><p>Live and recent runs</p></div></div>
            <div className="card-body row-list">
              {sessions.length ? sessions.map((s) => (
                <div key={s.id} className="row-item">
                  <div className="row-icon"><Icon name="activity" /></div>
                  <div className="row-copy"><div className="row-title">{s.title}</div><div className="row-sub">{s.harness} · {s.model} · started {relativeTime(s.startedAt)}</div></div>
                  <span className={`status-pill ${s.status === 'running' ? 'green' : s.status === 'waiting' ? 'yellow' : ''}`}>{s.status}</span>
                </div>
              )) : <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>No active sessions.</p>}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div><h3>Recent chats</h3><p>Conversations with this agent</p></div></div>
            <div className="card-body row-list">
              {chats.length ? chats.map((c) => (
                <div key={c.id} className="row-item" style={{ cursor: 'pointer' }} onClick={() => nav(`/chat/${c.id}`)}>
                  <div className="row-icon"><Icon name="message" /></div>
                  <div className="row-copy"><div className="row-title">{c.title}</div><div className="row-sub">Updated {relativeTime(c.updatedAt)}</div></div>
                  <span className="vis-badge">{c.visibility}</span>
                </div>
              )) : <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>No chats yet — open one above.</p>}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div><h3>Workflows & sites</h3><p>Where this agent is deployed</p></div></div>
            <div className="card-body row-list">
              {workflows.map((w) => (
                <div key={w.id} className="row-item" style={{ cursor: 'pointer' }} onClick={() => nav(`/workflows/${w.projectId}`)}>
                  <div className="row-icon"><Icon name="clock" /></div>
                  <div className="row-copy"><div className="row-title">{w.name}</div><div className="row-sub">{w.trigger}{w.schedule ? ` · ${w.schedule}` : ''}</div></div>
                  <span className={`status-pill ${w.status === 'active' ? 'green' : 'yellow'}`}>{w.status}</span>
                </div>
              ))}
              {sites.map((s) => (
                <div key={s.id} className="row-item" style={{ cursor: 'pointer' }} onClick={() => nav(`/site/${s.id}`)}>
                  <div className="row-icon"><Icon name="globe" /></div>
                  <div className="row-copy"><div className="row-title">{s.name}</div><div className="row-sub">{s.slug}.opensaddle.site · embedded {s.agentPlacement}</div></div>
                  <span className={`status-pill ${s.publishedVersionId ? 'green' : 'yellow'}`}>{s.publishedVersionId ? 'live' : 'draft'}</span>
                </div>
              ))}
              {!workflows.length && !sites.length && <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Not deployed to any workflow or site yet.</p>}
            </div>
          </div>
        </div>

        <div className="agent-detail-side">
          <div className="card">
            <div className="card-header"><div><h3>Configuration</h3></div></div>
            <div className="card-body">
              <div className="kv"><span>Model policy</span><span>{MODEL_NAME[agent.modelPolicy] ?? agent.modelPolicy}</span></div>
              <div className="kv"><span>Harness</span><span>{agent.harness}</span></div>
              <div className="kv"><span>Runtime</span><span>{agent.runtime}</span></div>
              <div className="kv"><span>Created</span><span>{new Date(agent.createdAt).toLocaleDateString()}</span></div>
              <div className="divider" />
              <h4 style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '0 0 8px' }}>Tools</h4>
              <div className="mini-tags" style={{ marginTop: 0 }}>
                {agent.tools.map((t) => <span className="mini-tag" key={t}>{t}</span>)}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div><h3>Knowledge</h3></div></div>
            <div className="card-body row-list">
              {knowledge.length ? knowledge.map((k) => (
                <div key={k.id} className="row-item" style={{ minHeight: 44 }}>
                  <div className="row-copy"><div className="row-title">{k.name}</div><div className="row-sub">{k.kind} · {k.items} items</div></div>
                  <span className={`status-pill ${k.status === 'Error' ? 'red' : 'green'}`}>{k.status}</span>
                </div>
              )) : <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>No dedicated sources — inherits project knowledge.</p>}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div><h3>Your effective access</h3><p>Evaluated as {data.settings.displayName}</p></div></div>
            <div className="card-body">
              {(['read', 'write', 'execute'] as const).map((action) => {
                const r = evalFor(action)
                return (
                  <div key={action} className="kv">
                    <span style={{ textTransform: 'capitalize' }}>{action}</span>
                    <span className={`status-pill ${r.allowed ? (r.approvalRequired ? 'yellow' : 'green') : 'red'}`}>
                      {r.allowed ? (r.approvalRequired ? 'Approval required' : 'Allowed') : 'Denied'}
                    </span>
                  </div>
                )
              })}
              <div className="scope-box" style={{ marginTop: 10 }}>
                <strong>Why</strong>
                <p>{exec.reason}</p>
              </div>
              <Link className="secondary-btn" style={{ width: '100%', marginTop: 10 }} to={`/permissions/${agent.projectId}`}><Icon name="shield" className="icon sm" />Manage permissions</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
