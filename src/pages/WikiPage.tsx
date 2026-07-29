import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'
import '../styles/wiki-reader.css'

type WikiPageId = 'overview' | 'architecture' | 'agents' | 'incidents' | 'directory'

const PAGE_LABELS: Array<{ id: WikiPageId; label: string; detail: string }> = [
  { id: 'overview', label: 'Team overview', detail: 'Priorities, decisions, and current focus' },
  { id: 'architecture', label: 'Runtime architecture', detail: 'How work is routed and executed' },
  { id: 'agents', label: 'Agent provider guide', detail: 'Choosing agents, models, and tools' },
  { id: 'incidents', label: 'Incident response runbook', detail: 'Diagnose, contain, and recover' },
  { id: 'directory', label: 'Project directory', detail: 'Projects and connected knowledge' },
]

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

export function WikiPage() {
  const { data, updateWikiSettings, refreshWikiSummaries, createChat, appendMessage, toast } = useStore()
  const navigate = useNavigate()
  const [selectedPage, setSelectedPage] = useState<WikiPageId>('overview')
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const selectedProjectId = data.wikiSettings.selectedProjectId
  const project = data.projects.find((item) => item.id === selectedProjectId) ?? data.projects[0]
  const summary = data.wikiSummaries.find((item) => item.projectId === project.id && item.scope === 'team')

  const sources = useMemo(() => {
    const sourceIds = new Set(data.wikiSummaries.filter((item) => item.projectId === project.id).flatMap((item) => item.sourceIds))
    return [
      ...data.services.filter((source) => sourceIds.has(source.id)).map((source) => source.name),
      ...data.knowledge.filter((source) => sourceIds.has(source.id)).map((source) => source.name),
    ]
  }, [data.knowledge, data.services, data.wikiSummaries, project.id])

  const visiblePages = PAGE_LABELS.filter((page) =>
    `${page.label} ${page.detail}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const refresh = () => {
    setRefreshing(true)
    window.setTimeout(() => {
      refreshWikiSummaries(project.id)
      setRefreshing(false)
      toast('Wiki updated', `Re-synthesized ${sources.length} approved sources for ${project.name}.`)
    }, 700)
  }

  const askAgent = () => {
    const page = PAGE_LABELS.find((item) => item.id === selectedPage)?.label ?? 'Team overview'
    const chat = createChat(project.id, `Ask about ${page}`, 'agent-research')
    appendMessage({
      chatId: chat.id,
      role: 'user',
      text: `Answer questions about the ${project.name} wiki page “${page}”. Use only approved team sources and cite factual claims.`,
    })
    navigate(`/chat/${chat.id}`)
  }

  const pageTitle = PAGE_LABELS.find((item) => item.id === selectedPage)?.label ?? 'Team overview'
  const intro = selectedPage === 'overview'
    ? summary?.overview
    : selectedPage === 'architecture'
      ? `This page explains how ${project.name} turns a request into governed work. Routing selects an agent, model, and runtime, then applies the project’s inherited access policy before execution begins.`
      : selectedPage === 'agents'
        ? 'Agents are reusable team entry points. Each one combines a prompt, a preferred harness, tools, knowledge, and an explicit permission boundary.'
        : selectedPage === 'incidents'
          ? 'Use this runbook when an agent run fails, produces an unexpected result, or requests access outside the expected boundary.'
          : `The ${project.name} workspace is organized as a team with projects beneath it. Projects inherit approved knowledge and policies while keeping their work, artifacts, and agents discoverable.`

  return (
    <div className="wiki-reader">
      <aside className="wiki-reader-nav">
        <div className="wiki-reader-brand">
          <span><Icon name="book" /></span>
          <div><strong>{project.name} wiki</strong><small>{PAGE_LABELS.length} maintained pages</small></div>
        </div>
        <label className="wiki-reader-search">
          <Icon name="search" className="icon sm" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documentation…" />
        </label>
        <span className="wiki-reader-label">Contents</span>
        <nav aria-label="Wiki contents">
          {visiblePages.map((page, index) => (
            <button key={page.id} className={selectedPage === page.id ? 'active' : ''} onClick={() => setSelectedPage(page.id)}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div><strong>{page.label}</strong><small>{page.detail}</small></div>
            </button>
          ))}
        </nav>
        <div className="wiki-reader-nav-actions">
          <button onClick={refresh} disabled={refreshing}><Icon name="refresh" className={`icon sm ${refreshing ? 'spin' : ''}`} />{refreshing ? 'Updating…' : 'Update from sources'}</button>
          <button onClick={() => navigate(`/project/${project.id}/manage`)}><Icon name="settings" className="icon sm" />Wiki settings</button>
        </div>
        <div className="wiki-reader-context">
          <section>
            <span>On this page</span>
            <a href="#top">{pageTitle}</a>
            <a href="#details">Details and guidance</a>
            <a href="#sources">Source material</a>
          </section>
          <section id="sources">
            <span>Source material</span>
            <strong>{sources.length} approved sources</strong>
            {sources.slice(0, 5).map((source) => <small key={source}>{source}</small>)}
          </section>
          <section className="wiki-reader-progress">
            <span>Documentation health</span>
            <strong>Current</strong>
            <small>Updated {relativeTime(summary?.updatedAt ?? Date.now())}</small>
          </section>
        </div>
      </aside>

      <main className="wiki-reader-document">
        <div className="wiki-reader-toolbar">
          <select value={project.id} aria-label="Wiki team" onChange={(event) => updateWikiSettings({ selectedProjectId: event.target.value })}>
            {data.projects.filter((item) => data.wikiSummaries.some((candidate) => candidate.projectId === item.id && candidate.scope === 'team')).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <span>Last updated {relativeTime(summary?.updatedAt ?? Date.now())}</span>
          <button onClick={() => navigator.clipboard?.writeText(window.location.href)}><Icon name="paperclip" className="icon sm" />Copy link</button>
        </div>

        <article className="wiki-markdown">
          <p className="wiki-section-meta">SECTION {String(PAGE_LABELS.findIndex((item) => item.id === selectedPage) + 1).padStart(2, '0')} · 8 MIN READ</p>
          <h1>{pageTitle}</h1>
          <p className="wiki-deck">{intro}</p>

          {selectedPage === 'overview' && (
            <>
              <h2>{summary?.headline ?? `${project.name} at a glance`}</h2>
              <p>The wiki is the human-readable memory of this team. It explains what the team owns, how decisions are made, and where to look before starting new work.</p>
              <h3>Current priorities</h3>
              <ul>{summary?.highlights.map((item) => <li key={item}>{item}</li>)}</ul>
              <h3>Risks and blockers</h3>
              <ul className="wiki-risk-list">{summary?.blockers.map((item) => <li key={item}>{item}</li>)}</ul>
              <blockquote>Ask AI can explain this summary, find the underlying source, or turn any section into a concrete task.</blockquote>
            </>
          )}

          {selectedPage === 'architecture' && (
            <>
              <h2>From request to governed execution</h2>
              <p>A request begins in chat. OpenSaddle resolves team context, identifies an eligible agent, and prepares the smallest permission set needed for the work.</p>
              <div className="wiki-flow" aria-label="Request execution flow">
                {['Request', 'Team context', 'Agent + model', 'Runtime', 'Artifact'].map((item, index) => <span key={item}>{item}{index < 4 && <Icon name="forward" className="icon sm" />}</span>)}
              </div>
              <h3>Runtime selection</h3>
              <p>Read-only questions can remain local. Repository changes use an isolated coding workspace. Sensitive or long-running jobs move to a governed VM with an auditable trace.</p>
              <pre><code>{`route = policy.resolve({\n  task,\n  team: "${project.name}",\n  requireAudit: true\n})`}</code></pre>
            </>
          )}

          {selectedPage === 'agents' && (
            <>
              <h2>Choose an entry point, not just a model</h2>
              <p>People start with a team agent because it carries the right instructions and tools. Model choice remains an implementation detail unless a task needs a specific capability.</p>
              <h3>Agent checklist</h3>
              <ul>
                <li>Give the agent one clear responsibility and a recognizable name.</li>
                <li>Attach only the knowledge sources needed for that responsibility.</li>
                <li>Default to read access and elevate writes at the point of action.</li>
                <li>Return an artifact and trace link when work completes.</li>
              </ul>
            </>
          )}

          {selectedPage === 'incidents' && (
            <>
              <h2>Respond in four phases</h2>
              <ol>
                <li><strong>Observe.</strong> Open the trace and identify the first failed decision or tool call.</li>
                <li><strong>Contain.</strong> Pause the run and revoke temporary credentials if the boundary is uncertain.</li>
                <li><strong>Recover.</strong> Retry from a known checkpoint or continue in a clean workspace.</li>
                <li><strong>Learn.</strong> Capture the resolution here and link the relevant artifact.</li>
              </ol>
              <blockquote>Never copy secrets, personal contact information, or raw production records into a wiki page.</blockquote>
            </>
          )}

          {selectedPage === 'directory' && (
            <>
              <h2>Projects in this team</h2>
              <p>Projects are narrower workspaces inside the team. They may represent a repository, product surface, operational process, or long-running initiative.</p>
              <div className="wiki-project-directory">
                {data.projects.filter((item) => item.id === project.id || item.parentId === project.id).map((item) => (
                  <button key={item.id} onClick={() => navigate(`/project/${item.id}`)}>
                    <Icon name={item.workspaceKind === 'local' ? 'terminal' : 'folder'} />
                    <span><strong>{item.name}</strong><small>{item.description}</small></span>
                    <Icon name="forward" className="icon sm" />
                  </button>
                ))}
              </div>
            </>
          )}
        </article>
      </main>

      <button className="wiki-ask-ai" onClick={askAgent}><Icon name="spark" />Ask AI</button>
    </div>
  )
}
