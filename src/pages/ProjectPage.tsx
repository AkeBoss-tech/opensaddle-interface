import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import { evaluatePermissions } from '../services/permissions'
import type { CodingProvider, ModelKey, RuntimeKind, Visibility } from '../types'

const TABS = ['chats', 'library', 'sites', 'context', 'access'] as const
const TAB_LABEL: Record<(typeof TABS)[number], string> = {
  chats: 'Chats',
  library: 'Library',
  sites: 'Sites',
  context: 'Knowledge & services',
  access: 'Access',
}

function dayLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const diffDays = Math.floor((today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ProjectPage() {
  const { projectId } = useParams()
  const { data, createChat, createAgent, createSite, createApi, createDashboard, createInterface, publishSiteVersion, toast, setActiveProject, updateProject, services: serviceBundle } = useStore()
  const nav = useNavigate()
  const project = data.projects.find((p) => p.id === projectId) ?? data.projects[0]!
  const [tab, setTab] = useState<(typeof TABS)[number]>('chats')
  const [createKind, setCreateKind] = useState<'agent' | 'api' | 'dashboard' | 'interface' | null>(null)
  const [draft, setDraft] = useState('')
  const [sitePrompt, setSitePrompt] = useState('')
  const [buildingSite, setBuildingSite] = useState(false)
  const [publishGeneratedSite, setPublishGeneratedSite] = useState(false)

  useEffect(() => {
    if (project) setActiveProject(project.id)
  }, [project, setActiveProject])

  const agents = data.agents.filter((a) => a.projectId === project.id)
  const sites = data.sites.filter((s) => s.projectId === project.id)
  const apis = data.apis.filter((a) => a.projectId === project.id)
  const dashes = data.dashboards.filter((d) => d.projectId === project.id)
  const ifaces = data.interfaces.filter((i) => i.projectId === project.id)
  const chats = useMemo(
    () => data.chats.filter((c) => c.projectId === project.id && !c.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [data.chats, project.id],
  )
  const children = data.projects.filter((p) => p.parentId === project.id)
  const caps = data.capabilities[project.id] ?? data.capabilities['proj-coding'] ?? []
  const knowledge = data.knowledge.filter((k) => k.projectId === project.id || !k.projectId)
  const services = data.services.filter((s) => s.projectId === project.id || s.projectId === 'proj-corp')

  const canWrite = evaluatePermissions(data.permissionGrants, {
    userId: data.currentUserId,
    resourceKind: 'project',
    resourceId: project.id,
    action: 'write',
  })

  const startChat = () => {
    const title = draft.trim() ? draft.trim().slice(0, 48) : undefined
    const agent = agents[0]
    const c = createChat(project.id, title, agent?.id)
    setDraft('')
    nav(`/chat/${c.id}`)
  }

  const requestCreate = (kind: 'agent' | 'api' | 'dashboard' | 'interface') => {
    if (!canWrite.allowed) {
      toast('Blocked', canWrite.reason)
      return
    }
    setCreateKind(kind)
  }

  const chatSnippet = (chatId: string) => {
    const first = data.messages.find((m) => m.chatId === chatId && m.role === 'user')
    return first?.text ?? 'No messages yet'
  }

  return (
    <div className="content-page project-page">
      <div className="proj-topline">
        <div className="eyebrow">{project.lineage.join(' / ')}</div>
        <div className="proj-topline-actions">
          <button className="secondary-btn" onClick={() => toast('Share', `Invite link for ${project.name} copied (mock).`)}><Icon name="globe" className="icon sm" />Share</button>
          <button className="icon-btn" title="Project settings" onClick={() => setTab('access')}><Icon name="settings" /></button>
        </div>
      </div>

      <div className="proj-hero">
        <div className="proj-hero-icon" style={{ color: project.iconColor, borderColor: `${project.iconColor}44`, background: `${project.iconColor}14` }}>
          <Icon name="folder" className="icon xl" />
        </div>
        <h1>{project.name}</h1>
        <p>{project.description}</p>
      </div>

      <div className="proj-composer">
        <button className="proj-composer-plus" title="Attach" onClick={() => toast('Attach', 'Add files or sources to this chat (mock).')}><Icon name="plus" className="icon sm" /></button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') startChat() }}
          placeholder={`New chat in ${project.name}`}
        />
        {agents.length > 0 && <span className="proj-composer-agent"><Icon name="spark" className="icon sm" />{agents[0]!.name}</span>}
        <button className="send-btn" onClick={startChat}><Icon name="arrow" className="icon sm" /></button>
      </div>

      <div className="tabs proj-tabs">
        {TABS.map((t) => <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>)}
      </div>

      {tab === 'chats' && (
        <div className="chat-list">
          {chats.map((c) => (
            <button key={c.id} className="chat-list-row" onClick={() => nav(`/chat/${c.id}`)}>
              <div className="chat-list-copy">
                <strong>{c.title}</strong>
                <span>{chatSnippet(c.id)}</span>
              </div>
              <span className="chat-list-date">{dayLabel(c.updatedAt)}</span>
            </button>
          ))}
          {!chats.length && (
            <div className="empty-state"><h3>No chats yet</h3><p>Start one above — it stays scoped to this project.</p></div>
          )}
          {children.length > 0 && (
            <>
              <h3 className="proj-section-title">Nested projects</h3>
              {children.map((c) => (
                <button key={c.id} className="chat-list-row" onClick={() => nav(`/project/${c.id}`)}>
                  <div className="chat-list-icon"><Icon name="folder" className="icon sm" /></div>
                  <div className="chat-list-copy">
                    <strong>{c.name}</strong>
                    <span>{c.description}</span>
                  </div>
                  <span className="chat-list-date">{c.childCount ? `${c.childCount} children` : ''}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'library' && (
        <>
          <div className="resource-tabs">
            {([['agent', 'Agent'], ['api', 'Quick API'], ['dashboard', 'Dashboard'], ['interface', 'Interface']] as const).map(([k, label]) => (
              <button key={k} className="secondary-btn" onClick={() => requestCreate(k)}><Icon name="plus" className="icon sm" />{label}</button>
            ))}
          </div>
          <h3 className="proj-section-title">Agents</h3>
          <div className="builder-grid" style={{ marginBottom: 20 }}>
            {agents.map((a) => (
              <button key={a.id} className="builder-card" onClick={() => nav(`/agent/${a.id}`)}>
                <div className="builder-card-head">
                  <span className="builder-card-ico agent"><Icon name="spark" className="icon sm" /></span>
                  <h3>{a.name}</h3>
                </div>
                <p>{a.description}</p>
                <div className="meta"><span className="vis-badge">{a.visibility}</span><span>{a.harness} · {a.modelPolicy}</span></div>
              </button>
            ))}
            {!agents.length && <div className="empty-state"><h3>No agents yet</h3><p>Create a custom agent for this project.</p></div>}
          </div>
          <h3 className="proj-section-title">Quick APIs</h3>
          <div className="builder-grid" style={{ marginBottom: 20 }}>
            {apis.map((a) => (
              <Link key={a.id} to={`/api/${a.id}`} className="builder-card">
                <div className="builder-card-head"><span className="builder-card-ico api"><Icon name="api" className="icon sm" /></span><h3>{a.name}</h3></div>
                <p>{a.path}</p><div className="meta"><span>{a.records.length} records</span></div>
              </Link>
            ))}
            {!apis.length && <p className="proj-empty-line">No quick APIs.</p>}
          </div>
          <h3 className="proj-section-title">Dashboards</h3>
          <div className="builder-grid" style={{ marginBottom: 20 }}>
            {dashes.map((d) => (
              <Link key={d.id} to={`/dashboard/${d.id}`} className="builder-card">
                <div className="builder-card-head"><span className="builder-card-ico dash"><Icon name="chart" className="icon sm" /></span><h3>{d.name}</h3></div>
                <p>{d.description}</p>
              </Link>
            ))}
            {!dashes.length && <p className="proj-empty-line">No dashboards.</p>}
          </div>
          <h3 className="proj-section-title">Interfaces</h3>
          <div className="builder-grid">
            {ifaces.map((i) => (
              <Link key={i.id} to={`/interface/${i.id}`} className="builder-card">
                <div className="builder-card-head"><span className="builder-card-ico iface"><Icon name="layout" className="icon sm" /></span><h3>{i.name}</h3></div>
                <p>{i.description}</p><div className="meta"><span className="vis-badge">{i.kind}</span></div>
              </Link>
            ))}
            {!ifaces.length && <p className="proj-empty-line">No interfaces.</p>}
          </div>
        </>
      )}

      {tab === 'sites' && (
        <>
          <div className="resource-tabs">
            <button className="secondary-btn" onClick={() => {
              if (!canWrite.allowed) { toast('Blocked', canWrite.reason); return }
              const s = createSite({
                projectId: project.id, name: `${project.name} site`, description: 'New agent-powered site.',
                pages: [{ id: 'p1', title: 'Home', body: 'Welcome. Edit this page and publish v1 when ready.', agentRail: true }],
                agentId: agents[0]?.id, visibility: 'project',
              })
              toast('Site created', `${s.name} · v1 draft`)
              nav(`/site/${s.id}`)
            }}><Icon name="plus" className="icon sm" />New site</button>
            <Link className="secondary-btn" to="/sites"><Icon name="globe" className="icon sm" />All sites</Link>
          </div>
          <div className="proj-composer" style={{ marginBottom: 20 }}>
            <Icon name="saddle" className="icon sm" />
            <input value={sitePrompt} onChange={(event) => setSitePrompt(event.target.value)} placeholder="Ask the site builder agent, e.g. Create a customer onboarding portal…" />
            <button className={`context-chip ${publishGeneratedSite ? 'active' : ''}`} onClick={() => setPublishGeneratedSite((value) => !value)} title="Publish immediately after generation">
              {publishGeneratedSite ? 'Publish on' : 'Draft only'}
            </button>
            <button className="send-btn" disabled={buildingSite || !sitePrompt.trim()} onClick={() => {
              if (!canWrite.allowed) { toast('Blocked', canWrite.reason); return }
              if (!serviceBundle?.runtime.generateSite) {
                toast('Site builder unavailable', 'Connect the OpenSaddle control plane and configure a model provider.')
                return
              }
              setBuildingSite(true)
              void serviceBundle.runtime.generateSite({ projectId: project.id, prompt: sitePrompt.trim() })
                .then((generated) => {
                  const site = createSite({
                    projectId: project.id,
                    name: generated.name,
                    description: generated.description,
                    slug: generated.slug,
                    accent: generated.accent,
                    pages: generated.pages,
                    agentId: agents[0]?.id,
                    visibility: 'project',
                  })
                  if (publishGeneratedSite && site.versions[0]) publishSiteVersion(site.id, site.versions[0].id)
                  setSitePrompt('')
                  toast(publishGeneratedSite ? 'Site generated and published' : 'Site draft created', publishGeneratedSite ? site.name : `${site.name} is ready to review and publish.`)
                  nav(`/site/${site.id}`)
                })
                .catch((error: unknown) => toast('Site generation failed', error instanceof Error ? error.message : String(error)))
                .finally(() => setBuildingSite(false))
            }}><Icon name={buildingSite ? 'clock' : 'arrow'} className="icon sm" /></button>
          </div>
          <div className="builder-grid">
            {sites.map((s) => {
              const pub = s.versions.find((v) => v.id === s.publishedVersionId)
              const embedded = data.agents.find((a) => a.id === s.agentId)
              return (
                <Link key={s.id} to={`/site/${s.id}`} className="builder-card">
                  <div className="builder-card-head"><span className="builder-card-ico site" style={{ color: s.accent }}><Icon name="globe" className="icon sm" /></span><h3>{s.name}</h3></div>
                  <p>{s.description}</p>
                  <div className="meta">
                    <span className={`status-pill ${pub ? 'green' : 'yellow'}`}>{pub ? `Live · ${pub.label}` : 'Draft'}</span>
                    <span>{s.versions.length} versions</span>
                    {embedded && <span className="vis-badge">{embedded.name}</span>}
                  </div>
                </Link>
              )
            })}
            {!sites.length && <div className="empty-state"><h3>No sites yet</h3><p>Publish an agent-powered page from this project.</p></div>}
          </div>
        </>
      )}

      {tab === 'context' && (
        <>
          <h3 className="proj-section-title">Knowledge sources</h3>
          <div className="knowledge-card-grid" style={{ marginBottom: 20 }}>
            {knowledge.map((k) => (
              <div key={k.id} className="knowledge-card">
                <div className="knowledge-card-top"><h4>{k.name}</h4></div>
                <p>{k.kind} · {k.items} items · Owner {k.owner}</p>
                <div className="knowledge-card-footer"><span className={`status-pill ${k.status === 'Error' ? 'red' : k.status === 'Partial' ? 'yellow' : 'green'}`}>{k.status}</span><span>{k.lastSync}</span><span className="vis-badge">{k.sensitivity}</span></div>
              </div>
            ))}
          </div>
          <h3 className="proj-section-title">Internal services</h3>
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
                <div key={m.id} className="row-item"><div className="avatar">{m.initials}</div><div className="row-copy"><div className="row-title">{m.name}{m.id === data.currentUserId ? ' (you)' : ''}</div><div className="row-sub">{m.email}</div></div><span className="status-pill">{m.role}</span></div>
              ))}
            </div>
          </div>
          <div className="card"><div className="card-header"><div><h3>Routing defaults</h3><p>Applied when this project leaves routing on Auto</p></div></div>
            <div className="card-body">
              <div className="form-row"><label>Coding provider</label>
                <select value={project.routingDefaults?.providerKey ?? 'auto'} onChange={(event) => updateProject(project.id, {
                  routingDefaults: {
                    modelKey: project.routingDefaults?.modelKey ?? 'auto',
                    runtimeKey: project.routingDefaults?.runtimeKey ?? 'local',
                    reviewProviderKey: project.routingDefaults?.reviewProviderKey ?? 'auto',
                    providerKey: event.target.value as CodingProvider,
                  },
                })}>
                  <option value="auto">Auto</option><option value="opensaddle">OpenSaddle</option><option value="codex">Codex CLI</option><option value="claude">Claude Code</option><option value="cursor">Cursor Agent</option><option value="gemini">Gemini CLI</option><option value="opencode">OpenCode</option>
                </select>
              </div>
              <div className="form-row"><label>Model policy</label>
                <select value={project.routingDefaults?.modelKey ?? 'auto'} onChange={(event) => updateProject(project.id, {
                  routingDefaults: {
                    providerKey: project.routingDefaults?.providerKey ?? 'auto',
                    runtimeKey: project.routingDefaults?.runtimeKey ?? 'local',
                    reviewProviderKey: project.routingDefaults?.reviewProviderKey ?? 'auto',
                    modelKey: event.target.value as ModelKey,
                  },
                })}>
                  <option value="auto">Optimize per task</option><option value="gpt">Balanced GPT</option><option value="claude">Highest quality</option><option value="sonnet">Fast coding</option><option value="gemini">Gemini</option><option value="llama">Local / economical</option>
                </select>
              </div>
              <div className="form-row"><label>Runtime</label>
                <select value={project.routingDefaults?.runtimeKey ?? 'local'} onChange={(event) => updateProject(project.id, {
                  routingDefaults: {
                    providerKey: project.routingDefaults?.providerKey ?? 'auto',
                    modelKey: project.routingDefaults?.modelKey ?? 'auto',
                    reviewProviderKey: project.routingDefaults?.reviewProviderKey ?? 'auto',
                    runtimeKey: event.target.value as RuntimeKind,
                  },
                })}>
                  <option value="local">Local</option><option value="sandbox">Cloud sandbox</option><option value="restricted">Restricted</option><option value="gpu">GPU</option>
                </select>
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}><label>Review provider</label>
                <select value={project.routingDefaults?.reviewProviderKey ?? 'auto'} onChange={(event) => updateProject(project.id, {
                  routingDefaults: {
                    providerKey: project.routingDefaults?.providerKey ?? 'auto',
                    modelKey: project.routingDefaults?.modelKey ?? 'auto',
                    runtimeKey: project.routingDefaults?.runtimeKey ?? 'local',
                    reviewProviderKey: event.target.value as CodingProvider,
                  },
                })}>
                  <option value="auto">No automatic second review</option><option value="codex">Codex CLI</option><option value="claude">Claude Code</option><option value="cursor">Cursor Agent</option><option value="gemini">Gemini CLI</option><option value="opencode">OpenCode</option>
                </select>
              </div>
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
              toast('Agent created', a.name); nav(`/agent/${a.id}`)
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
