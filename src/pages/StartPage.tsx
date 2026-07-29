import { type FormEvent, type KeyboardEvent, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'
import '../styles/start-hub.css'

const QUICK_PROMPTS = [
  'What needs my attention?',
  'Summarize progress across teams',
  'Where should I focus today?',
]

function relativeTime(timestamp: number) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function StartPage() {
  const navigate = useNavigate()
  const { data, createChat } = useStore()
  const [prompt, setPrompt] = useState('')
  const [scopeProjectId, setScopeProjectId] = useState<string | null>(null)
  const [scopeOpen, setScopeOpen] = useState(false)

  const activeProject = data.projects.find((project) => project.id === data.activeProjectId)
    ?? data.projects[0]
  const scopedProject = data.projects.find((project) => project.id === scopeProjectId)
  const recentChats = useMemo(
    () => data.chats
      .filter((chat) => !chat.archived)
      .sort((left, right) => right.updatedAt - left.updatedAt),
    [data.chats],
  )
  const latestChat = recentChats[0]
  const latestAgent = data.agents[0]
  const latestSite = [...data.sites].sort((left, right) => right.updatedAt - left.updatedAt)[0]
  const activeWorkflows = data.workflows.filter((workflow) => workflow.status === 'active')
  const indexedItems = data.knowledge.reduce((total, source) => total + source.items, 0)
  const firstName = data.settings.displayName.trim().split(/\s+/)[0] || 'there'

  const ask = (value = prompt) => {
    const nextPrompt = value.trim()
    const destinationProject = scopedProject ?? activeProject
    if (!nextPrompt || !destinationProject) return
    const title = nextPrompt.length > 52 ? `${nextPrompt.slice(0, 49).trimEnd()}…` : nextPrompt
    const chat = createChat(destinationProject.id, title)
    sessionStorage.setItem('opensaddle-pending-prompt', JSON.stringify({
      chatId: chat.id,
      prompt: nextPrompt,
    }))
    navigate(`/chat/${chat.id}`)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    ask()
  }

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      ask()
    }
  }

  return (
    <div className="osh-start">
      <section className="osh-hero" aria-labelledby="osh-start-title">
        <div className="osh-orbit osh-orbit-one" aria-hidden="true" />
        <div className="osh-orbit osh-orbit-two" aria-hidden="true" />
        <div className="osh-hero-content">
          <span className="osh-overline"><Icon name="spark" className="icon sm" /> OpenSaddle</span>
          <h1 id="osh-start-title">Where do you want to go next, {firstName}?</h1>
          <p>Ask about anything you can access, across every team, project, agent, and artifact.</p>

          <form className="osh-prompt" onSubmit={submit}>
            <label className="osh-visually-hidden" htmlFor="osh-global-prompt">Ask OpenSaddle</label>
            <textarea
              id="osh-global-prompt"
              rows={1}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="Ask a question or describe what you want to accomplish…"
              autoFocus
            />
            <div className="osh-prompt-footer">
              <div className="osh-scope-picker">
                <button
                  type="button"
                  className="osh-scope"
                  onClick={() => setScopeOpen((value) => !value)}
                  aria-haspopup="listbox"
                  aria-expanded={scopeOpen}
                >
                  {scopedProject
                    ? <span className="osh-project-dot" style={{ background: scopedProject.iconColor }} />
                    : <Icon name="globe" className="icon sm" />}
                  {scopedProject?.name ?? 'All teams'}
                  <Icon name="chevron" className={`icon xs ${scopeOpen ? 'open' : ''}`} />
                </button>
                {scopeOpen && (
                  <div className="osh-scope-menu" role="listbox" aria-label="Choose a team scope">
                    <button
                      type="button"
                      role="option"
                      aria-selected={!scopeProjectId}
                      className={!scopeProjectId ? 'selected' : ''}
                      onClick={() => { setScopeProjectId(null); setScopeOpen(false) }}
                    >
                      <Icon name="globe" className="icon sm" />
                      <span><strong>All teams</strong><small>Search everything you can access</small></span>
                      {!scopeProjectId && <Icon name="check" className="icon xs" />}
                    </button>
                    {data.projects.map((project) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={scopeProjectId === project.id}
                        className={scopeProjectId === project.id ? 'selected' : ''}
                        key={project.id}
                        onClick={() => { setScopeProjectId(project.id); setScopeOpen(false) }}
                      >
                        <span className="osh-project-dot" style={{ background: project.iconColor }} />
                        <span><strong>{project.name}</strong><small>Limit this question to one team</small></span>
                        {scopeProjectId === project.id && <Icon name="check" className="icon xs" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="osh-enter-hint">Enter to ask</span>
              <button className="osh-send" type="submit" disabled={!prompt.trim()} aria-label="Ask OpenSaddle">
                <Icon name="arrow" className="icon sm" />
              </button>
            </div>
          </form>

          <div className="osh-quick-prompts" aria-label="Suggested questions">
            {QUICK_PROMPTS.map((item) => (
              <button type="button" key={item} onClick={() => ask(item)}>{item}</button>
            ))}
          </div>
        </div>
        <a className="osh-scroll-cue" href="#for-you">
          <span>Explore your workspace</span>
          <Icon name="chevron" className="icon xs" />
        </a>
      </section>

      <section className="osh-feed" id="for-you" aria-labelledby="osh-feed-title">
        <header className="osh-feed-head">
          <div>
            <span className="osh-section-label">Your intelligent workspace</span>
            <h2 id="osh-feed-title">Picked for you</h2>
          </div>
          <button type="button" className="osh-text-button" onClick={() => navigate('/work')}>
            View all work <Icon name="forward" className="icon xs" />
          </button>
        </header>

        <div className="osh-feature-grid">
          <article className="osh-card osh-focus-card">
            <div className="osh-card-topline">
              <span className="osh-card-icon blue"><Icon name="message" className="icon sm" /></span>
              <span>Continue where you left off</span>
            </div>
            {latestChat ? (
              <>
                <h3>{latestChat.title}</h3>
                <p>Return to your most recently active conversation and keep the momentum going.</p>
                <button type="button" className="osh-card-action" onClick={() => navigate(`/chat/${latestChat.id}`)}>
                  Continue chat <Icon name="forward" className="icon xs" />
                </button>
                <span className="osh-card-meta">{relativeTime(latestChat.updatedAt)}</span>
              </>
            ) : (
              <>
                <h3>Your first conversation starts here</h3>
                <p>Ask the question above and OpenSaddle will create a focused workspace for it.</p>
              </>
            )}
          </article>

          <article className="osh-card osh-pulse-card">
            <div className="osh-card-topline">
              <span className="osh-card-icon green"><Icon name="activity" className="icon sm" /></span>
              <span>Workspace pulse</span>
            </div>
            <h3>{activeWorkflows.length} automations are keeping work moving</h3>
            <div className="osh-stat-row" aria-label="Workspace counts">
              <div><strong>{recentChats.length}</strong><span>open chats</span></div>
              <div><strong>{data.workflowRuns.length}</strong><span>recent runs</span></div>
              <div><strong>{data.projects.length}</strong><span>projects</span></div>
            </div>
            <button type="button" className="osh-card-action" onClick={() => navigate('/work')}>
              Review activity <Icon name="forward" className="icon xs" />
            </button>
          </article>

          <article className="osh-card osh-knowledge-card">
            <div className="osh-card-topline">
              <span className="osh-card-icon violet"><Icon name="book" className="icon sm" /></span>
              <span>Knowledge across teams</span>
            </div>
            <h3>{indexedItems.toLocaleString()} items ready to answer from</h3>
            <p>{data.knowledge.length} connected sources give OpenSaddle grounded context for your questions.</p>
            <button type="button" className="osh-card-action" onClick={() => navigate('/wiki')}>
              Browse knowledge <Icon name="forward" className="icon xs" />
            </button>
          </article>
        </div>

        <div className="osh-feed-head osh-secondary-head">
          <div>
            <span className="osh-section-label">Across OpenSaddle</span>
            <h2>Discover and continue</h2>
          </div>
        </div>

        <div className="osh-discovery-grid">
          <article className="osh-card osh-teams-card">
            <div className="osh-card-topline">
              <span className="osh-card-icon amber"><Icon name="folder" className="icon sm" /></span>
              <span>Teams and projects</span>
            </div>
            <div className="osh-project-list">
              {data.projects.slice(0, 4).map((project) => {
                const projectChats = recentChats.filter((chat) => chat.projectId === project.id).length
                return (
                  <button type="button" key={project.id} onClick={() => navigate(`/project/${project.id}`)}>
                    <span className="osh-project-mark" style={{ background: project.iconColor }} aria-hidden="true">
                      {project.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span><strong>{project.name}</strong><small>{projectChats} active chat{projectChats === 1 ? '' : 's'}</small></span>
                    <Icon name="forward" className="icon xs" />
                  </button>
                )
              })}
            </div>
          </article>

          <article className="osh-card osh-recommendation">
            <div className="osh-ai-badge"><Icon name="spark" className="icon xs" /> AI suggestion</div>
            <span className="osh-card-icon blue"><Icon name="spark" className="icon sm" /></span>
            <h3>{latestAgent ? `Ask ${latestAgent.name} to prepare your next brief` : 'Create a specialist for repeatable work'}</h3>
            <p>{latestAgent?.description ?? 'Give recurring work a role, tools, and a clear scope.'}</p>
            <button
              type="button"
              className="osh-card-action"
              onClick={() => navigate(latestAgent ? `/agent/${latestAgent.id}` : '/agents')}
            >
              {latestAgent ? 'Open agent' : 'Browse agents'} <Icon name="forward" className="icon xs" />
            </button>
          </article>

          <article className="osh-card osh-site-card">
            <div className="osh-card-topline">
              <span className="osh-card-icon green"><Icon name="globe" className="icon sm" /></span>
              <span>Apps and sites</span>
            </div>
            <h3>{latestSite?.name ?? 'Turn team work into a shared experience'}</h3>
            <p>{latestSite?.description ?? 'Publish useful artifacts as searchable, living destinations for your team.'}</p>
            <button
              type="button"
              className="osh-card-action"
              onClick={() => navigate(latestSite ? `/site/${latestSite.id}` : '/sites')}
            >
              {latestSite ? 'Open site' : 'Explore sites'} <Icon name="forward" className="icon xs" />
            </button>
          </article>
        </div>
      </section>
    </div>
  )
}
