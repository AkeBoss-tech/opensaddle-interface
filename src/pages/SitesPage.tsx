import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import { safeHref } from '../lib/sanitizeHtml'
import { evaluatePermissions } from '../services/permissions'
import type { Site, SiteVersion } from '../types'

function relativeTime(ts: number) {
  const diff = Date.now() - ts
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function publishedVersion(site: Site): SiteVersion | undefined {
  return site.versions.find((v) => v.id === site.publishedVersionId)
}

/* ============ Sites gallery (workspace level) ============ */

export function SitesPage() {
  const { data, createSite, toast } = useStore()
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const scopedProjectId = searchParams.get('project')
  const scopedProject = data.projects.find((project) => project.id === scopedProjectId)
  const visibleSites = scopedProject ? data.sites.filter((site) => site.projectId === scopedProject.id) : data.sites
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('New site')
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState(data.activeProjectId)
  const [agentId, setAgentId] = useState('')

  const projectAgents = data.agents.filter((a) => a.projectId === projectId)

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">Agent-powered experiences</div>
          <h1>{scopedProject ? `${scopedProject.name} sites` : 'Sites'}</h1>
          <p>{scopedProject
            ? `Published experiences and drafts belonging to ${scopedProject.name}.`
            : 'Published pages that live inside a project, ship with an embedded project agent, and are versioned like any other artifact.'}</p>
        </div>
        <div className="page-header-actions">
          <button className="primary-btn" onClick={() => { setProjectId(data.activeProjectId); setCreateOpen(true) }}><Icon name="plus" className="icon sm" />Create site</button>
        </div>
      </div>

      <div className="sites-grid">
        {visibleSites.map((site) => {
          const project = data.projects.find((p) => p.id === site.projectId)
          const agent = data.agents.find((a) => a.id === site.agentId)
          const pub = publishedVersion(site)
          const drafts = site.versions.filter((v) => v.status === 'draft').length
          return (
            <button key={site.id} className="site-card" onClick={() => nav(`/site/${site.id}`)}>
              <div className="site-thumb" style={{ '--site-accent': site.accent } as React.CSSProperties}>
                <div className="site-thumb-bar"><span /><span /><span /></div>
                <div className="site-thumb-body">
                  <div className="site-thumb-hero" />
                  <div className="site-thumb-line" style={{ width: '72%' }} />
                  <div className="site-thumb-line" style={{ width: '52%' }} />
                  {agent && <div className="site-thumb-agent"><Icon name="spark" className="icon sm" /></div>}
                </div>
              </div>
              <div className="site-card-copy">
                <div className="site-card-title-row">
                  <h3>{site.name}</h3>
                  <span className={`status-pill ${pub ? 'green' : 'yellow'}`}>{pub ? `Live · ${pub.label}` : 'Draft'}</span>
                </div>
                <p className="site-card-url">{site.slug}.opensaddle.site</p>
                <div className="site-card-meta">
                  <span className="vis-badge">{project?.name ?? 'Project'}</span>
                  {agent && <span className="vis-badge"><Icon name="spark" className="icon sm" />{agent.name}</span>}
                  <span>{site.versions.length} version{site.versions.length === 1 ? '' : 's'}{drafts ? ` · ${drafts} draft` : ''}</span>
                  <span style={{ marginLeft: 'auto' }}>{relativeTime(site.updatedAt)}</span>
                </div>
              </div>
            </button>
          )
        })}
        {!visibleSites.length && <div className="empty-state"><h3>No sites yet</h3><p>Create one to publish an agent-powered page for {scopedProject?.name ?? 'this workspace'}.</p></div>}
      </div>

      {createOpen && (
        <div className="modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) setCreateOpen(false) }}>
          <div className="modal">
            <div className="modal-head"><div className="modal-icon" style={{ color: 'var(--accent)', borderColor: 'rgba(128,169,255,.3)', background: 'rgba(128,169,255,.08)' }}><Icon name="globe" /></div><div><h3>Create a site</h3><p>Sites belong to a project and inherit its knowledge, permissions, and agents.</p></div></div>
            <div className="modal-body">
              <div className="form-row"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="form-row"><label>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div className="form-row"><label>Project</label>
                <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setAgentId('') }}>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}><label>Embedded agent</label>
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">None yet</option>
                  {projectAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="primary-btn" onClick={() => {
                const s = createSite({
                  projectId, name, description,
                  pages: [{ id: 'p1', title: 'Home', body: 'Welcome. This page was scaffolded as version v1 — edit and publish when ready.', agentRail: true }],
                  agentId: agentId || undefined, visibility: 'project',
                })
                setCreateOpen(false)
                toast('Site created', `${s.name} · v1 draft`)
                nav(`/site/${s.id}`)
              }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ============ Single site experience ============ */

export function SiteExperiencePage() {
  const { siteId } = useParams()
  const { data, createChat, createSiteVersion, publishSiteVersion, updateSite, toast } = useStore()
  const nav = useNavigate()
  const site = data.sites.find((s) => s.id === siteId)
  const [pageIdx, setPageIdx] = useState(0)
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatLog, setChatLog] = useState<Array<{ role: 'user' | 'agent'; text: string }>>([])
  const [editorOpen, setEditorOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editAccent, setEditAccent] = useState('#80a9ff')
  const [editPages, setEditPages] = useState<Site['pages']>([])
  const [settingsPanel, setSettingsPanel] = useState<'versions' | 'agent' | 'details' | null>(null)
  const [previewFullscreen, setPreviewFullscreen] = useState(false)

  const project = data.projects.find((p) => p.id === site?.projectId)
  const agent = data.agents.find((a) => a.id === site?.agentId)
  const projectAgents = useMemo(() => data.agents.filter((a) => a.projectId === site?.projectId), [data.agents, site?.projectId])

  if (!site || !project) return <div className="content-page empty-state"><h3>Site not found</h3></div>

  const pub = publishedVersion(site)
  const preview = previewVersionId ? site.versions.find((v) => v.id === previewVersionId) : (pub ?? site.versions[0])
  const snapshot = preview?.snapshot
  const renderedSite = snapshot ?? site
  const renderedPages = snapshot?.pages ?? site.pages
  const page = renderedPages[Math.min(pageIdx, renderedPages.length - 1)]!
  const viewingDraft = preview?.status !== 'published'

  const canWrite = evaluatePermissions(data.permissionGrants, {
    userId: data.currentUserId, resourceKind: 'project', resourceId: site.projectId, action: 'write',
  })

  const guardWrite = (fn: () => void) => {
    if (!canWrite.allowed) { toast('Blocked', canWrite.reason); return }
    fn()
  }

  const openEditor = () => guardWrite(() => {
    setEditName(site.name)
    setEditDescription(site.description)
    setEditSlug(site.slug)
    setEditAccent(site.accent)
    setEditPages(structuredClone(site.pages))
    setEditorOpen(true)
  })

  const saveSite = () => {
    const cleanSlug = editSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '')
    if (!editName.trim() || !cleanSlug || !editPages.length || editPages.some((item) => !item.title.trim())) {
      toast('Cannot save site', 'Add a site name, valid slug, and at least one named page.')
      return
    }
    updateSite(site.id, {
      name: editName.trim(),
      description: editDescription.trim(),
      slug: cleanSlug,
      accent: editAccent,
      pages: editPages,
    })
    setPageIdx((idx) => Math.min(idx, editPages.length - 1))
    setPreviewVersionId(site.versions.find((version) => version.status === 'draft')?.id ?? null)
    setEditorOpen(false)
    toast('Site saved', 'Draft content was saved to SQLite and is ready to preview.')
  }

  const shareUrl = `${window.location.origin}${import.meta.env.BASE_URL}published/${site.slug}`

  const askAgent = () => {
    const q = chatInput.trim()
    if (!q) return
    setChatInput('')
    setChatLog((log) => [...log, { role: 'user', text: q }])
    window.setTimeout(() => {
      setChatLog((log) => [...log, {
        role: 'agent',
        text: `${agent?.name ?? 'The project agent'} here — I answer with ${project.name}'s knowledge and this site's ${preview?.label ?? 'current'} content. For "${q.slice(0, 60)}", I'd check the ${page.title} page first; open a full chat for a complete agent run.`,
      }])
    }, 550)
  }

  const openFullChat = () => {
    const c = createChat(site.projectId, `${site.name} visitor session`, site.agentId)
    nav(`/chat/${c.id}`)
  }

  const agentWidget = agent && (
    <div className="site-agent-panel">
      <div className="site-agent-head">
        <span className="site-agent-avatar"><Icon name="spark" className="icon sm" /></span>
        <div>
          <strong>{agent.name}</strong>
          <span>Embedded agent · scoped to {project.name}</span>
        </div>
        {site.agentPlacement === 'bubble' && (
          <button className="icon-btn" style={{ marginLeft: 'auto', width: 26, height: 26 }} onClick={() => setChatOpen(false)}><Icon name="x" className="icon sm" /></button>
        )}
      </div>
      <div className="site-agent-log">
        {!chatLog.length && <p className="site-agent-hint">Ask about anything on this site. The agent sees the {preview?.label ?? 'current'} content and the project's knowledge sources — visitors get read-only scope.</p>}
        {chatLog.map((m, i) => (
          <div key={i} className={`site-agent-msg ${m.role}`}>{m.text}</div>
        ))}
      </div>
      <div className="site-agent-input">
        <input
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') askAgent() }}
          placeholder={`Ask ${agent.name}…`}
        />
        <button className="send-btn" style={{ width: 26, height: 26 }} onClick={askAgent}><Icon name="arrow" className="icon sm" /></button>
      </div>
      <button className="site-agent-fullchat" onClick={openFullChat}>Continue in full chat →</button>
    </div>
  )

  return (
    <div className={`content-page site-experience ${previewFullscreen ? 'site-experience-fullscreen' : ''}`} style={{ maxWidth: 1280 }}>
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">Site · {project.name}</div>
          <h1>{site.name}</h1>
          <p>{site.description}</p>
        </div>
        <div className="page-header-actions">
          <button className="secondary-btn" onClick={() => {
            void navigator.clipboard.writeText(shareUrl).then(() => toast('Share link copied', shareUrl)).catch(() => toast('Copy failed', 'Open the preview link manually.'))
          }}><Icon name="globe" className="icon sm" />Share</button>
          <button className="secondary-btn" onClick={() => setSettingsPanel('versions')}><Icon name="clock" className="icon sm" />Versions</button>
          <button className="secondary-btn" onClick={() => setSettingsPanel('agent')}><Icon name="spark" className="icon sm" />Agent</button>
          <button className="secondary-btn" onClick={() => setSettingsPanel('details')}><Icon name="info" className="icon sm" />Details</button>
          <button className="secondary-btn" aria-pressed={previewFullscreen} onClick={() => setPreviewFullscreen((value) => !value)}><Icon name="layout" className="icon sm" />{previewFullscreen ? 'Exit full screen' : 'Full screen'}</button>
          <a className="secondary-btn" href={shareUrl} target="_blank" rel="noreferrer"><Icon name="globe" className="icon sm" />Open preview</a>
          <button className="primary-btn" onClick={openEditor}><Icon name="sliders" className="icon sm" />Edit site</button>
          <Link className="secondary-btn" to={`/project/${site.projectId}`}><Icon name="folder" className="icon sm" />Project</Link>
        </div>
      </div>

      {settingsPanel && (
        <div className="modal-backdrop open" onClick={(event) => { if (event.target === event.currentTarget) setSettingsPanel(null) }}>
          <div className="modal site-settings-modal">
            <div className="modal-head">
              <div className="modal-icon"><Icon name={settingsPanel === 'versions' ? 'clock' : settingsPanel === 'agent' ? 'spark' : 'info'} /></div>
              <div><h3>{settingsPanel === 'versions' ? 'Versions' : settingsPanel === 'agent' ? 'Embedded agent' : 'Site details'}</h3><p>Site configuration for {site.name}.</p></div>
              <button className="icon-btn" onClick={() => setSettingsPanel(null)}><Icon name="x" className="icon sm" /></button>
            </div>
            <div className="modal-body">
              {settingsPanel === 'versions' && (
                <div className="row-list">
                  {site.versions.map((version) => <button key={version.id} className="version-main" onClick={() => { setPreviewVersionId(version.id); setSettingsPanel(null) }}><div className="version-title"><strong>{version.label}</strong><span className={`status-pill ${version.status === 'published' ? 'green' : version.status === 'draft' ? 'yellow' : ''}`}>{version.status}</span></div><span className="version-sub">{version.summary}</span></button>)}
                </div>
              )}
              {settingsPanel === 'agent' && (
                <>
                  <div className="form-row"><label>Agent</label><select value={site.agentId ?? ''} onChange={(event) => guardWrite(() => updateSite(site.id, { agentId: event.target.value || undefined }))}><option value="">None</option>{projectAgents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                  <div className="form-row"><label>Placement</label><div className="seg"><button className={site.agentPlacement === 'bubble' ? 'active' : ''} onClick={() => guardWrite(() => updateSite(site.id, { agentPlacement: 'bubble' }))}>Floating bubble</button><button className={site.agentPlacement === 'rail' ? 'active' : ''} onClick={() => guardWrite(() => updateSite(site.id, { agentPlacement: 'rail' }))}>Side rail</button></div></div>
                  <div className="scope-box"><strong>Permission boundary</strong><p>Visitors are read-only. Any write by the embedded agent uses this project’s approval rules.</p></div>
                </>
              )}
              {settingsPanel === 'details' && (
                <div className="site-details-list"><div className="kv"><span>Public URL</span><span>{shareUrl}</span></div><div className="kv"><span>Project</span><span>{project.name}</span></div><div className="kv"><span>Visibility</span><span>{site.visibility}</span></div><div className="kv"><span>Pages</span><span>{renderedPages.length}</span></div><div className="kv"><span>Your access</span><span>{canWrite.allowed ? 'Can edit & publish' : 'View only'}</span></div></div>
              )}
            </div>
            <div className="modal-actions"><button className="primary-btn" onClick={() => setSettingsPanel(null)}>Done</button></div>
          </div>
        </div>
      )}

      <div className="site-layout">
        <div className="site-viewer" style={{ '--site-accent': renderedSite.accent } as React.CSSProperties}>
          <div className="site-browser-bar">
            <span className="pf-dot" /><span className="pf-dot" /><span className="pf-dot" />
            <span className="site-url">{shareUrl}</span>
            <span className={`status-pill ${viewingDraft ? 'yellow' : 'green'}`}>{viewingDraft ? `Previewing ${preview?.label ?? 'draft'}` : `Live · ${preview?.label}`}</span>
          </div>
          <div className="site-canvas">
            <div className="site-nav">
              <span className="site-nav-brand" style={{ background: renderedSite.accent }} />
              <strong>{renderedSite.name}</strong>
              <div className="site-nav-pages">
                {renderedPages.map((p, i) => (
                  <button key={p.id} className={i === pageIdx ? 'active' : ''} onClick={() => setPageIdx(i)}>{p.title}</button>
                ))}
              </div>
            </div>
            <div className="site-content">
              <div className="site-hero" style={{ borderColor: renderedSite.accent }}>
                {page.eyebrow && <span className="site-eyebrow">{page.eyebrow}</span>}
                <h2>{page.title}</h2>
                <p>{page.body}</p>
                {page.ctaLabel && (
                  <a className="site-cta" style={{ background: renderedSite.accent }} href={safeHref(page.ctaUrl || '#') ?? '#'}>{page.ctaLabel}</a>
                )}
              </div>
              <div className="site-blocks">
                {(page.sections?.length ? page.sections : [
                  { id: 'project', title: `Powered by ${project.name}`, body: `This experience is generated from project knowledge and stays in sync with version ${preview?.label ?? '—'}.` },
                  { id: 'approval', title: 'Human in the loop', body: `Anything the embedded agent writes back is gated by the project's approval rules.` },
                ]).map((section) => (
                  <div className="site-block" key={section.id}><strong>{section.title}</strong><p>{section.body}</p></div>
                ))}
              </div>
            </div>

            {agent && site.agentPlacement === 'rail' && <div className="site-rail">{agentWidget}</div>}
            {agent && site.agentPlacement === 'bubble' && (
              chatOpen
                ? <div className="site-bubble-panel">{agentWidget}</div>
                : (
                  <button className="site-agent-bubble" style={{ background: site.accent }} onClick={() => setChatOpen(true)} title={`Chat with ${agent.name}`}>
                    <Icon name="spark" />
                  </button>
                )
            )}
          </div>
        </div>

        <div className="site-side">
          <div className="card">
            <div className="card-header">
              <div><h3>Versions</h3><p>Draft, publish, and roll back</p></div>
              <button className="tiny-btn right" onClick={() => guardWrite(() => {
                const label = `v${site.versions.length + 1}`
                const v = createSiteVersion(site.id, label, 'New draft from current pages')
                if (v) { setPreviewVersionId(v.id); toast('Draft created', `${site.name} · ${label}`) }
              })}>New draft</button>
            </div>
            <div className="card-body row-list">
              {site.versions.map((v) => (
                <div key={v.id} className={`version-row ${preview?.id === v.id ? 'previewing' : ''}`}>
                  <button className="version-main" onClick={() => setPreviewVersionId(v.id)}>
                    <div className="version-title">
                      <strong>{v.label}</strong>
                      <span className={`status-pill ${v.status === 'published' ? 'green' : v.status === 'draft' ? 'yellow' : ''}`}>{v.status}</span>
                    </div>
                    <span className="version-sub">{v.summary}</span>
                    <span className="version-meta">{data.members.find((m) => m.id === v.createdBy)?.name ?? v.createdBy} · {relativeTime(v.createdAt)}</span>
                  </button>
                  {v.status === 'draft' && (
                    <button className="tiny-btn" onClick={() => guardWrite(() => { publishSiteVersion(site.id, v.id); setPreviewVersionId(null); toast('Published', `${site.name} ${v.label} is live`) })}>Publish</button>
                  )}
                  {v.status === 'archived' && (
                    <button className="tiny-btn" onClick={() => guardWrite(() => { publishSiteVersion(site.id, v.id); setPreviewVersionId(null); toast('Rolled back', `${site.name} restored to ${v.label}`) })}>Restore</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div><h3>Embedded agent</h3><p>AI that lives inside the site</p></div></div>
            <div className="card-body">
              <div className="form-row"><label>Agent</label>
                <select value={site.agentId ?? ''} onChange={(e) => guardWrite(() => { updateSite(site.id, { agentId: e.target.value || undefined }); toast('Agent updated', e.target.value ? 'Embedded agent changed' : 'Agent removed') })}>
                  <option value="">None</option>
                  {projectAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="form-row" style={{ marginBottom: 10 }}><label>Placement</label>
                <div className="seg">
                  <button className={site.agentPlacement === 'bubble' ? 'active' : ''} onClick={() => guardWrite(() => updateSite(site.id, { agentPlacement: 'bubble' }))}>Floating bubble</button>
                  <button className={site.agentPlacement === 'rail' ? 'active' : ''} onClick={() => guardWrite(() => updateSite(site.id, { agentPlacement: 'rail' }))}>Side rail</button>
                </div>
              </div>
              <div className="scope-box">
                <strong>Scope</strong>
                <p>The embedded agent runs with {project.name}'s permission grants. Site visitors get read-only scope; writes route through the project's approval rules.</p>
              </div>
              {agent && (
                <button className="secondary-btn" style={{ width: '100%', marginTop: 10 }} onClick={() => nav(`/agent/${agent.id}`)}><Icon name="spark" className="icon sm" />Open {agent.name}</button>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div><h3>Details</h3></div></div>
            <div className="card-body">
              <div className="kv"><span>Project</span><span>{project.name}</span></div>
              <div className="kv"><span>Visibility</span><span>{site.visibility}</span></div>
              <div className="kv"><span>Created</span><span>{new Date(site.createdAt).toLocaleDateString()}</span></div>
              <div className="kv"><span>Updated</span><span>{relativeTime(site.updatedAt)}</span></div>
              <div className="kv"><span>Your access</span><span>{canWrite.allowed ? 'Can edit & publish' : 'View only'}</span></div>
            </div>
          </div>
        </div>
      </div>

      {editorOpen && (
        <div className="modal-backdrop open" onClick={(event) => { if (event.target === event.currentTarget) setEditorOpen(false) }}>
          <div className="modal site-editor-modal">
            <div className="modal-head">
              <div className="modal-icon"><Icon name="layout" /></div>
              <div><h3>Edit custom site</h3><p>Changes update the current draft. Publishing freezes a versioned snapshot.</p></div>
            </div>
            <div className="modal-body site-editor-body">
              <div className="site-editor-settings">
                <div className="form-row"><label>Site name</label><input value={editName} onChange={(event) => setEditName(event.target.value)} /></div>
                <div className="form-row"><label>Description</label><textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></div>
                <div className="form-row"><label>Public slug</label><div className="slug-input"><span>/published/</span><input value={editSlug} onChange={(event) => setEditSlug(event.target.value)} /></div></div>
                <div className="form-row"><label>Accent</label><div className="color-input"><input type="color" value={editAccent} onChange={(event) => setEditAccent(event.target.value)} /><code>{editAccent}</code></div></div>
              </div>

              <div className="site-editor-pages">
                <div className="site-editor-section-head">
                  <div><strong>Pages</strong><span>Build navigation and page content</span></div>
                  <button className="tiny-btn" onClick={() => setEditPages((pages) => [...pages, {
                    id: `page-${crypto.randomUUID()}`,
                    title: 'New page',
                    body: 'Describe this page.',
                    eyebrow: '',
                    ctaLabel: '',
                    ctaUrl: '',
                    agentRail: true,
                    sections: [],
                  }])}><Icon name="plus" className="icon sm" />Add page</button>
                </div>
                {editPages.map((editPage, index) => {
                  const updatePage = (patch: Partial<Site['pages'][number]>) => setEditPages((pages) =>
                    pages.map((item, pageIndex) => pageIndex === index ? { ...item, ...patch } : item))
                  return (
                    <div className="site-page-editor" key={editPage.id}>
                      <div className="site-page-editor-head">
                        <strong>{index + 1}. {editPage.title || 'Untitled page'}</strong>
                        <button className="icon-btn" title="Delete page" disabled={editPages.length === 1} onClick={() => setEditPages((pages) => pages.filter((_, pageIndex) => pageIndex !== index))}><Icon name="x" className="icon sm" /></button>
                      </div>
                      <div className="site-editor-grid">
                        <div className="form-row"><label>Navigation title</label><input value={editPage.title} onChange={(event) => updatePage({ title: event.target.value })} /></div>
                        <div className="form-row"><label>Eyebrow</label><input value={editPage.eyebrow ?? ''} onChange={(event) => updatePage({ eyebrow: event.target.value })} placeholder="Optional" /></div>
                      </div>
                      <div className="form-row"><label>Hero copy</label><textarea value={editPage.body} onChange={(event) => updatePage({ body: event.target.value })} /></div>
                      <div className="site-editor-grid">
                        <div className="form-row"><label>Button label</label><input value={editPage.ctaLabel ?? ''} onChange={(event) => updatePage({ ctaLabel: event.target.value })} placeholder="Optional" /></div>
                        <div className="form-row"><label>Button URL</label><input value={editPage.ctaUrl ?? ''} onChange={(event) => updatePage({ ctaUrl: event.target.value })} placeholder="https://…" /></div>
                      </div>
                      <div className="site-editor-section-head compact">
                        <div><strong>Content cards</strong><span>Optional supporting sections</span></div>
                        <button className="tiny-btn" onClick={() => updatePage({ sections: [...(editPage.sections ?? []), { id: `section-${crypto.randomUUID()}`, title: 'New section', body: 'Add supporting details.' }] })}><Icon name="plus" className="icon sm" />Add card</button>
                      </div>
                      {(editPage.sections ?? []).map((section, sectionIndex) => (
                        <div className="site-section-editor" key={section.id}>
                          <input value={section.title} onChange={(event) => updatePage({ sections: editPage.sections?.map((item, itemIndex) => itemIndex === sectionIndex ? { ...item, title: event.target.value } : item) })} />
                          <textarea value={section.body} onChange={(event) => updatePage({ sections: editPage.sections?.map((item, itemIndex) => itemIndex === sectionIndex ? { ...item, body: event.target.value } : item) })} />
                          <button className="icon-btn" title="Delete card" onClick={() => updatePage({ sections: editPage.sections?.filter((_, itemIndex) => itemIndex !== sectionIndex) })}><Icon name="x" className="icon sm" /></button>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setEditorOpen(false)}>Cancel</button>
              <button className="primary-btn" onClick={saveSite}>Save draft</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Read-only public rendering of the published site snapshot. */
export function PublishedSitePage() {
  const { slug } = useParams()
  const { data } = useStore()
  const localSite = data.sites.find((item) => item.slug === slug)
  const localVersion = localSite ? publishedVersion(localSite) : undefined
  const [remote, setRemote] = useState<{
    site: { name: string; slug: string; accent: string }
    version: { label: string; snapshot?: SiteVersion['snapshot'] }
  } | null>(null)
  const [pageIdx, setPageIdx] = useState(0)
  useEffect(() => {
    if (!slug) return
    const baseUrl = import.meta.env.VITE_OPENSADDLE_URL ?? 'http://127.0.0.1:8765'
    const controller = new AbortController()
    void fetch(`${baseUrl}/api/public/sites/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return
        const payload = await response.json() as NonNullable<typeof remote>
        setRemote(payload)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [slug])

  const site = remote?.site ?? localSite
  const version = remote?.version ?? localVersion
  const snapshot = version?.snapshot
  const pages = snapshot?.pages ?? localSite?.pages ?? []
  const page = pages[Math.min(pageIdx, Math.max(0, pages.length - 1))]

  if (!site || !version || !page) {
    return <div className="published-site-missing"><Icon name="globe" /><h1>Site unavailable</h1><p>This site has not been published, or the link is invalid.</p></div>
  }

  const name = snapshot?.name ?? site.name
  const accent = snapshot?.accent ?? site.accent
  return (
    <div className="published-site" style={{ '--site-accent': accent } as React.CSSProperties}>
      <header>
        <span className="published-site-logo" style={{ background: accent }} />
        <strong>{name}</strong>
        <nav>{pages.map((item, index) => <button key={item.id} className={index === pageIdx ? 'active' : ''} onClick={() => setPageIdx(index)}>{item.title}</button>)}</nav>
        <span className="published-site-version">{version.label}</span>
      </header>
      <main>
        <section className="published-site-hero">
          {page.eyebrow && <span>{page.eyebrow}</span>}
          <h1>{page.title}</h1>
          <p>{page.body}</p>
          {page.ctaLabel && <a href={safeHref(page.ctaUrl || '#') ?? '#'} style={{ background: accent }}>{page.ctaLabel}</a>}
        </section>
        {(page.sections?.length ?? 0) > 0 && (
          <section className="published-site-sections">
            {page.sections?.map((section) => <article key={section.id}><h2>{section.title}</h2><p>{section.body}</p></article>)}
          </section>
        )}
      </main>
      <footer>Published with OpenSaddle · {version.label}</footer>
    </div>
  )
}
