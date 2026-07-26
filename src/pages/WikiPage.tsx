import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'

type WikiTab = 'overview' | 'people' | 'pages' | 'sources'
type WikiPerspective = 'business' | 'engineering'

const PERSPECTIVE_COPY: Record<WikiPerspective, { label: string; description: string }> = {
  business: { label: 'Business', description: 'Customer operations, delivery health, budgets, and governed automation.' },
  engineering: { label: 'Engineering', description: 'Runtime reliability, agent tooling, security, and delivery throughput.' },
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

export function WikiPage() {
  const { projectId } = useParams()
  const {
    data,
    updateWikiSettings,
    refreshWikiSummaries,
    createChat,
    appendMessage,
    toast,
    setActiveProject,
  } = useStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState<WikiTab>('overview')
  const [perspective, setPerspective] = useState<WikiPerspective>('engineering')
  const [refreshing, setRefreshing] = useState(false)
  const selectedProjectId = projectId ?? data.wikiSettings.selectedProjectId
  const project = data.projects.find((item) => item.id === selectedProjectId) ?? data.projects[0]
  const teamSummary = data.wikiSummaries.find((item) => item.projectId === project.id && item.scope === 'team')
  const peopleSummaries = data.wikiSummaries.filter((item) => item.projectId === project.id && item.scope === 'member')

  useEffect(() => {
    if (projectId && projectId !== data.wikiSettings.selectedProjectId) updateWikiSettings({ selectedProjectId: projectId })
    if (projectId && projectId !== data.activeProjectId) setActiveProject(projectId)
  }, [data.activeProjectId, data.wikiSettings.selectedProjectId, projectId, setActiveProject, updateWikiSettings])

  const sources = useMemo(() => {
    const sourceIds = new Set(data.wikiSummaries.filter((item) => item.projectId === project.id).flatMap((item) => item.sourceIds))
    return [
      ...data.services.filter((source) => sourceIds.has(source.id)).map((source) => ({
        id: source.id,
        name: source.name,
        kind: 'Connected service',
        status: source.status,
        detail: source.subtitle,
        logo: source.logo,
      })),
      ...data.knowledge.filter((source) => sourceIds.has(source.id)).map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.kind,
        status: source.status,
        detail: `${source.items.toLocaleString()} items · synced ${source.lastSync}`,
        logo: '',
      })),
    ]
  }, [data.knowledge, data.services, data.wikiSummaries, project.id])

  const refresh = () => {
    setRefreshing(true)
    window.setTimeout(() => {
      refreshWikiSummaries(project.id)
      setRefreshing(false)
      toast('Team wiki refreshed', `Synthesized ${sources.length} connected sources for ${project.name}.`)
    }, 900)
  }

  const askAgent = () => {
    const chat = createChat(project.id, `${project.name} team pulse`, 'agent-research')
    appendMessage({
      chatId: chat.id,
      role: 'user',
      text: `Summarize what the ${project.name} team is working on. Use the connected Jira, GitHub, Slack, and knowledge sources, cite every claim, and call out blockers.`,
    })
    navigate(`/chat/${chat.id}`)
  }

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">Project knowledge</div>
          <h1>Team wiki</h1>
          <p>A source-grounded reference for this team’s priorities, decisions, risks, and connected systems.</p>
        </div>
        <div className="page-header-actions">
          <select
            aria-label="Team wiki project"
            value={project.id}
            onChange={(event) => {
              updateWikiSettings({ selectedProjectId: event.target.value })
              navigate(`/project/${event.target.value}/wiki`)
            }}
          >
            {data.projects.filter((item) => data.wikiSummaries.some((summary) => summary.projectId === item.id && summary.scope === 'team')).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <div className="seg wiki-perspective" aria-label="Wiki perspective">
            {(Object.entries(PERSPECTIVE_COPY) as Array<[WikiPerspective, { label: string; description: string }]>).map(([id, copy]) => (
              <button key={id} className={perspective === id ? 'active' : ''} title={copy.description} onClick={() => setPerspective(id)}>{copy.label}</button>
            ))}
          </div>
          <button className="secondary-btn" onClick={askAgent}><Icon name="message" className="icon sm" />Ask the team agent</button>
          <button className="primary-btn" onClick={refresh} disabled={refreshing}>
            <Icon name="refresh" className={`icon sm ${refreshing ? 'spin' : ''}`} />
            {refreshing ? 'Synthesizing…' : 'Refresh summary'}
          </button>
        </div>
      </div>

      <div className="wiki-article-note"><Icon name="review" className="icon sm" /><span>This page is maintained from {sources.length} approved sources. Summaries are read-only and keep their citations.</span></div>

      <div className="tabs" role="tablist" aria-label="Team wiki sections">
        {([
          ['overview', 'Overview'],
          ['people', 'People'],
          ['pages', 'Pages'],
          ['sources', `Sources · ${sources.length}`],
        ] as Array<[WikiTab, string]>).map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && teamSummary && (
        <>
          <div className="task-summary">
            <div className="summary-card"><span className="label">Connected sources</span><strong>{sources.length}</strong><span className="metric-sub">Jira + knowledge</span></div>
            <div className="summary-card"><span className="label">Active priorities</span><strong>{teamSummary.highlights.length}</strong><span className="metric-sub">Across this team</span></div>
            <div className="summary-card"><span className="label">Open blockers</span><strong>{teamSummary.blockers.length}</strong><span className="metric-sub">Needs attention</span></div>
            <div className="summary-card"><span className="label">Last synthesized</span><strong className="wiki-time">{relativeTime(teamSummary.updatedAt)}</strong><span className="metric-sub">Read-only workflow</span></div>
          </div>

          <div className="wiki-layout">
            <article className="card wiki-brief">
              <div className="card-header">
                <div><span className="eyebrow">This week</span><h3>{teamSummary.headline}</h3></div>
                <span className="status-pill">AI-generated</span>
              </div>
              <div className="card-body">
                <p className="wiki-lead">{teamSummary.overview}</p>
                <div className="wiki-section">
                  <h4>Current priorities</h4>
                  {teamSummary.highlights.map((item) => <div className="wiki-bullet" key={item}><Icon name="check" className="icon sm" /><span>{item}</span></div>)}
                </div>
                <div className="wiki-section">
                  <h4>Risks & blockers</h4>
                  {teamSummary.blockers.map((item) => <div className="wiki-bullet risk" key={item}><Icon name="activity" className="icon sm" /><span>{item}</span></div>)}
                </div>
                <div className="wiki-citations">
                  <Icon name="review" className="icon sm" />
                  <span>Grounded in {sources.map((source) => source.name).join(', ')}</span>
                </div>
              </div>
            </article>

            <aside className="card">
              <div className="card-header"><div><h3>Workflow controls</h3><p>Privacy-aware team reporting</p></div></div>
              <div className="card-body">
                <div className="setting-row">
                  <div className="setting-copy"><strong>Individual work summaries</strong><span>Show per-person activity only when explicitly enabled.</span></div>
                  <button
                    aria-label="Toggle individual work summaries"
                    aria-pressed={data.wikiSettings.individualSummariesEnabled}
                    className={`switch ${data.wikiSettings.individualSummariesEnabled ? 'on' : ''}`}
                    onClick={() => updateWikiSettings({ individualSummariesEnabled: !data.wikiSettings.individualSummariesEnabled })}
                  />
                </div>
                <div className="form-row">
                  <label>Refresh cadence</label>
                  <select value={data.wikiSettings.refreshCadence} onChange={(event) => updateWikiSettings({ refreshCadence: event.target.value as typeof data.wikiSettings.refreshCadence })}>
                    <option value="manual">Manual</option>
                    <option value="daily">Daily at 8:00 AM</option>
                    <option value="weekly">Weekly on Monday</option>
                  </select>
                </div>
                <div className="scope-box">
                  <strong>Privacy boundary</strong>
                  <p>Only work visible to this project is summarized. Private chats, direct messages, and unapproved sources are excluded.</p>
                </div>
              </div>
            </aside>
          </div>
        </>
      )}

      {tab === 'people' && (
        <div>
          {!data.wikiSettings.individualSummariesEnabled ? (
            <div className="empty-state wiki-empty">
              <Icon name="lock" />
              <h3>Individual summaries are off</h3>
              <p>Enable them to show source-grounded work summaries for team members. This setting is intentionally opt-in.</p>
              <button className="primary-btn" onClick={() => updateWikiSettings({ individualSummariesEnabled: true })}>Enable individual summaries</button>
            </div>
          ) : (
            <div className="wiki-people-grid">
              {peopleSummaries.map((summary) => {
                const member = data.members.find((item) => item.id === summary.memberId)
                if (!member) return null
                return (
                  <article className="card wiki-person" key={summary.id}>
                    <div className="card-header">
                      <div className="wiki-person-head"><span className="avatar">{member.initials}</span><div><h3>{member.name}</h3><p>{member.role} · Updated {relativeTime(summary.updatedAt)}</p></div></div>
                    </div>
                    <div className="card-body">
                      <strong className="wiki-person-title">{summary.headline}</strong>
                      <p className="wiki-person-copy">{summary.overview}</p>
                      {summary.highlights.map((item) => <div className="wiki-bullet" key={item}><Icon name="check" className="icon sm" /><span>{item}</span></div>)}
                      {summary.blockers.map((item) => <div className="wiki-bullet risk" key={item}><Icon name="activity" className="icon sm" /><span>{item}</span></div>)}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'sources' && (
        <div className="knowledge-card-grid">
          {sources.map((source) => (
            <article className="knowledge-card" key={source.id}>
              <div className="knowledge-card-top">
                <div className="row-icon">
                  {source.logo ? <img className="plugin-logo" src={`${import.meta.env.BASE_URL}assets/${source.logo}`} alt="" /> : <Icon name="db" className="icon sm" />}
                </div>
                <div><h4>{source.name}</h4><span className="row-sub">{source.kind}</span></div>
              </div>
              <p>{source.detail}</p>
              <div className="knowledge-card-footer"><span className="status-pill green">{source.status}</span><span>Used in cited summaries</span></div>
            </article>
          ))}
        </div>
      )}

      {tab === 'pages' && (
        <div className="wiki-pages-grid">
          {[
            perspective === 'engineering'
              ? ['Runtime architecture', 'How local, browser, VM, and GPU runtimes are selected, provisioned, and audited.', 'Engineering', 'Runtime policy · Updated today']
              : ['Customer operations handbook', 'Claims intake, outreach review, and human approval patterns for customer-facing workflows.', 'Business', 'Operations · Updated today'],
            perspective === 'engineering'
              ? ['Agent provider guide', 'When to use Codex App Server, Claude Code, Cursor, Gemini, or the native OpenSaddle agent.', 'Engineering', 'Model routing · Updated yesterday']
              : ['Workflow governance', 'How teams request access, review protected writes, and measure automation quality.', 'Business', 'Governance · Updated yesterday'],
            perspective === 'engineering'
              ? ['Incident response runbook', 'Debugging failed runs, inspecting tool timelines, and recovering from unavailable providers.', 'Engineering', 'Runbooks · Updated 2d ago']
              : ['Weekly operating brief', 'A concise view of priorities, blockers, service health, and recent workflow activity.', 'Business', 'Leadership · Updated 2d ago'],
            ['Project directory', `Pages and source-grounded notes for ${project.name}.`, PERSPECTIVE_COPY[perspective].label, 'Reference · Maintained continuously'],
          ].map(([title, body, group, meta]) => (
            <article className="card wiki-page-card" key={title}>
              <div className="card-header"><div><span className="eyebrow">{group}</span><h3>{title}</h3></div><Icon name="file" className="icon sm" /></div>
              <div className="card-body"><p>{body}</p><div className="wiki-page-meta"><span>{meta}</span><button className="tiny-btn" onClick={() => toast('Wiki page opened', title)}>Open page</button></div></div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
