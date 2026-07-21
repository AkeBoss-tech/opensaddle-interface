import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import type { Visibility } from '../types'

const TABS = ['overview', 'library', 'context', 'access'] as const
const TAB_LABEL: Record<(typeof TABS)[number], string> = {
  overview: 'Overview',
  library: 'Library',
  context: 'Knowledge & services',
  access: 'Access',
}

export function ProjectPage() {
  const { projectId } = useParams()
  const { data, createChat, createAgent, createSite, createApi, createDashboard, createInterface, toast, setActiveProject } = useStore()
  const nav = useNavigate()
  const project = data.projects.find((p) => p.id === projectId) ?? data.projects[0]!
  const [tab, setTab] = useState<(typeof TABS)[number]>('overview')
  const [createKind, setCreateKind] = useState<'agent' | 'site' | 'api' | 'dashboard' | 'interface' | null>(null)

  useEffect(() => {
    if (project) setActiveProject(project.id)
  }, [project, setActiveProject])

  const agents = data.agents.filter((a) => a.projectId === project.id)
  const sites = data.sites.filter((s) => s.projectId === project.id)
  const apis = data.apis.filter((a) => a.projectId === project.id)
  const dashes = data.dashboards.filter((d) => d.projectId === project.id)
  const ifaces = data.interfaces.filter((i) => i.projectId === project.id)
  const chats = data.chats.filter((c) => c.projectId === project.id && !c.archived)
  const caps = data.capabilities[project.id] ?? data.capabilities['proj-coding'] ?? []
  const knowledge = data.knowledge.filter((k) => k.projectId === project.id || !k.projectId)
  const services = data.services.filter((s) => s.projectId === project.id || s.projectId === 'proj-corp')

  const openChat = () => {
    const c = createChat(project.id)
    nav(`/chat/${c.id}`)
  }

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">{project.lineage.join(' / ')}</div>
          <h1>{project.name}</h1>
          <p>{project.description}</p>
        </div>
        <div className="page-header-actions">
          <button className="secondary-btn" onClick={() => setCreateKind('agent')}><Icon name="plus" className="icon sm" />New agent</button>
          <button className="primary-btn" onClick={openChat}><Icon name="message" className="icon sm" />Open chat</button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>)}
      </div>

      {tab === 'overview' && (
        <>
          <div className="task-summary">
            <div className="summary-card"><span className="label">Chats</span><strong>{chats.length}</strong></div>
            <div className="summary-card"><span className="label">Agents</span><strong>{agents.length}</strong></div>
            <div className="summary-card"><span className="label">Knowledge sources</span><strong>{project.knowledgeCount}</strong></div>
            <div className="summary-card"><span className="label">Auto-route confidence</span><strong>{project.autoConfidence}%</strong></div>
          </div>
          <div className="grid-2">
            <div className="card"><div className="card-header"><div><h3>Agent definition</h3><p>Inherited by chats in this project</p></div></div>
              <div className="card-body">
                <div className="setting-row"><div className="setting-copy"><strong>System prompt</strong><span>Corporate-safe behavior and escalation</span></div><span className="status-pill green">Active</span></div>
                <div className="setting-row"><div className="setting-copy"><strong>Custom agents</strong><span>{agents.length} defined</span></div><button className="tiny-btn" onClick={() => setTab('library')}>Open</button></div>
                <div className="setting-row"><div className="setting-copy"><strong>Interfaces</strong><span>{ifaces.length} layouts</span></div><button className="tiny-btn" onClick={() => setCreateKind('interface')}>New</button></div>
              </div>
            </div>
            <div className="card"><div className="card-header"><div><h3>Child projects</h3><p>Nested scopes inherit and narrow access</p></div></div>
              <div className="card-body row-list">
                {data.projects.filter((p) => p.parentId === project.id).map((c) => (
                  <div key={c.id} className="row-item" style={{ cursor: 'pointer' }} onClick={() => nav(`/project/${c.id}`)}>
                    <div className="row-icon"><Icon name="folder" /></div>
                    <div className="row-copy"><div className="row-title">{c.name}</div><div className="row-sub">{c.description}</div></div>
                    <span className="status-pill">{c.childCount} children</span>
                  </div>
                ))}
                {!data.projects.some((p) => p.parentId === project.id) && <p style={{ color: 'var(--muted)', fontSize: 12 }}>No child projects.</p>}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'library' && (
        <>
          <div className="resource-tabs">
            {([['agent', 'Agent'], ['site', 'Site'], ['api', 'Quick API'], ['dashboard', 'Dashboard'], ['interface', 'Interface']] as const).map(([k, label]) => (
              <button key={k} className="secondary-btn" onClick={() => setCreateKind(k)}><Icon name="plus" className="icon sm" />{label}</button>
            ))}
          </div>
          <h3 style={{ fontSize: 14, margin: '8px 0' }}>Chats</h3>
          <div className="builder-grid" style={{ marginBottom: 20 }}>
            {chats.map((c) => (
              <button key={c.id} className="builder-card" onClick={() => nav(`/chat/${c.id}`)}>
                <h3>{c.title}</h3>
                <p>Updated {new Date(c.updatedAt).toLocaleString()}</p>
                <div className="meta"><span className="vis-badge">{c.visibility}</span>{c.sharedWith.length ? <span>Shared with {c.sharedWith.length}</span> : null}</div>
              </button>
            ))}
          </div>
          <h3 style={{ fontSize: 14, margin: '8px 0' }}>Agents</h3>
          <div className="builder-grid" style={{ marginBottom: 20 }}>
            {agents.map((a) => (
              <button key={a.id} className="builder-card" onClick={() => { const c = createChat(project.id, `Chat with ${a.name}`, a.id); nav(`/chat/${c.id}`) }}>
                <h3>{a.name}</h3><p>{a.description}</p>
                <div className="meta"><span className="vis-badge">{a.visibility}</span><span>{a.harness} · {a.modelPolicy}</span></div>
              </button>
            ))}
            {!agents.length && <div className="empty-state"><h3>No agents yet</h3><p>Create a custom agent for this project.</p></div>}
          </div>
          <h3 style={{ fontSize: 14, margin: '8px 0' }}>Sites</h3>
          <div className="builder-grid" style={{ marginBottom: 20 }}>
            {sites.map((s) => (
              <Link key={s.id} to={`/site/${s.id}`} className="builder-card"><h3>{s.name}</h3><p>{s.description}</p><div className="meta"><span className="vis-badge">{s.visibility}</span></div></Link>
            ))}
          </div>
          <h3 style={{ fontSize: 14, margin: '8px 0' }}>Quick APIs</h3>
          <div className="builder-grid" style={{ marginBottom: 20 }}>
            {apis.map((a) => (
              <Link key={a.id} to={`/api/${a.id}`} className="builder-card"><h3>{a.name}</h3><p>{a.path}</p><div className="meta"><span>{a.records.length} records</span></div></Link>
            ))}
          </div>
          <h3 style={{ fontSize: 14, margin: '8px 0' }}>Dashboards</h3>
          <div className="builder-grid" style={{ marginBottom: 20 }}>
            {dashes.map((d) => (
              <Link key={d.id} to={`/dashboard/${d.id}`} className="builder-card"><h3>{d.name}</h3><p>{d.description}</p></Link>
            ))}
          </div>
          <h3 style={{ fontSize: 14, margin: '8px 0' }}>Interfaces</h3>
          <div className="builder-grid">
            {ifaces.map((i) => (
              <Link key={i.id} to={`/interface/${i.id}`} className="builder-card"><h3>{i.name}</h3><p>{i.description}</p><div className="meta"><span className="vis-badge">{i.kind}</span></div></Link>
            ))}
          </div>
        </>
      )}

      {tab === 'context' && (
        <>
          <h3 style={{ fontSize: 14, margin: '8px 0' }}>Knowledge sources</h3>
          <div className="knowledge-card-grid" style={{ marginBottom: 20 }}>
            {knowledge.map((k) => (
              <div key={k.id} className="knowledge-card">
                <div className="knowledge-card-top"><h4>{k.name}</h4></div>
                <p>{k.kind} · {k.items} items · Owner {k.owner}</p>
                <div className="knowledge-card-footer"><span className={`status-pill ${k.status === 'Error' ? 'red' : k.status === 'Partial' ? 'yellow' : 'green'}`}>{k.status}</span><span>{k.lastSync}</span><span className="vis-badge">{k.sensitivity}</span></div>
              </div>
            ))}
          </div>
          <h3 style={{ fontSize: 14, margin: '8px 0' }}>Internal services</h3>
          <div className="card"><div className="card-body row-list">
            {services.map((s) => (
              <div key={s.id} className="row-item">
                <div className="plugin-logo" style={{ width: 32, height: 32, padding: 6 }}><img src={`${import.meta.env.BASE_URL}assets/${s.logo}`} alt="" /></div>
                <div className="row-copy"><div className="row-title">{s.name}</div><div className="row-sub">{s.subtitle}</div></div>
                <span className="status-pill">{s.status}</span>
              </div>
            ))}
          </div></div>
        </>
      )}

      {tab === 'access' && (
        <div className="grid-2">
          <div className="card"><div className="card-header"><div><h3>Scope inheritance</h3><p>Shared resources are visible to members; private ones stay with the owner</p></div></div>
            <div className="card-body">
              <div className="lineage" style={{ marginBottom: 14 }}>
                {project.lineage.map((n, i) => (
                  <span key={n} style={{ display: 'contents' }}>
                    {i > 0 && <Icon name="chevron" className="icon sm" />}
                    <span className={`node ${i === project.lineage.length - 1 ? 'current' : ''}`}>{n}</span>
                  </span>
                ))}
              </div>
              <table className="permission-matrix"><thead><tr><th>Capability</th><th>Effective</th><th>Source</th></tr></thead>
                <tbody>{caps.map((c) => (
                  <tr key={c.capability}><td>{c.capability}</td><td><span className={`status-pill ${c.source === 'denied' ? 'red' : c.source === 'override' ? 'yellow' : 'green'}`}>{c.value}</span></td><td><span className={`inh ${c.source}`}>{c.sourceLabel}</span></td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          <div className="card"><div className="card-header"><div><h3>Members</h3><p>{data.members.length} people with access</p></div></div>
            <div className="card-body row-list">
              {data.members.map((m) => (
                <div key={m.id} className="row-item"><div className="avatar">{m.initials}</div><div className="row-copy"><div className="row-title">{m.name}</div><div className="row-sub">{m.email}</div></div><span className="status-pill">{m.role}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {createKind && (
        <CreateModal
          kind={createKind}
          onClose={() => setCreateKind(null)}
          onCreate={(payload) => {
            if (createKind === 'agent') {
              const a = createAgent({ projectId: project.id, name: payload.name, description: payload.description, systemPrompt: payload.extra || 'You are a helpful project agent.', modelPolicy: 'sonnet', harness: 'chat', runtime: 'local', tools: ['Files'], knowledgeSourceIds: [], visibility: payload.visibility })
              toast('Agent created', a.name); setTab('library')
            } else if (createKind === 'site') {
              const s = createSite({ projectId: project.id, name: payload.name, description: payload.description, pages: [{ id: 'p1', title: 'Home', body: payload.extra || 'Welcome.', agentRail: true }], visibility: payload.visibility })
              toast('Site created', s.name); nav(`/site/${s.id}`)
            } else if (createKind === 'api') {
              const a = createApi({ projectId: project.id, name: payload.name, description: payload.description, path: payload.extra || '/api/custom', fields: [{ name: 'name', type: 'string' }, { name: 'value', type: 'string' }], visibility: payload.visibility, transformScript: 'return records;' })
              toast('API created', a.name); nav(`/api/${a.id}`)
            } else if (createKind === 'dashboard') {
              const d = createDashboard({ projectId: project.id, name: payload.name, description: payload.description, visibility: payload.visibility, widgets: [{ id: 'w1', type: 'kpi', title: 'Metric', value: '42', delta: '+3%' }, { id: 'w2', type: 'chart', title: 'Trend', chartBars: [20, 40, 35, 60, 50] }] })
              toast('Dashboard created', d.name); nav(`/dashboard/${d.id}`)
            } else {
              const i = createInterface({ projectId: project.id, name: payload.name, kind: 'custom', description: payload.description, layout: { showChat: true, showForm: true, showMetrics: true, showDocument: false, formFields: ['Input'], heroTitle: payload.name }, visibility: payload.visibility })
              toast('Interface created', i.name); nav(`/interface/${i.id}`)
            }
            setCreateKind(null)
          }}
        />
      )}
    </div>
  )
}

function CreateModal({ kind, onClose, onCreate }: {
  kind: string
  onClose: () => void
  onCreate: (p: { name: string; description: string; extra: string; visibility: Visibility }) => void
}) {
  const [name, setName] = useState(`New ${kind}`)
  const [description, setDescription] = useState('')
  const [extra, setExtra] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('project')
  return (
    <div className="modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head"><div className="modal-icon" style={{ color: 'var(--accent)', borderColor: 'rgba(128,169,255,.3)', background: 'rgba(128,169,255,.08)' }}><Icon name="plus" /></div><div><h3>Create {kind}</h3><p>Stored in this project. Choose visibility for sharing.</p></div></div>
        <div className="modal-body">
          <div className="form-row"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="form-row"><label>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="form-row"><label>{kind === 'api' ? 'Path' : kind === 'agent' ? 'System prompt' : 'Details'}</label><input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={kind === 'api' ? '/api/...' : ''} /></div>
          <div className="form-row" style={{ marginBottom: 0 }}><label>Visibility</label>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}><option value="private">Private</option><option value="shared">Shared</option><option value="project">Project</option></select>
          </div>
        </div>
        <div className="modal-actions"><button className="ghost-btn" onClick={onClose}>Cancel</button><button className="primary-btn" onClick={() => onCreate({ name, description, extra, visibility })}>Create</button></div>
      </div>
    </div>
  )
}
