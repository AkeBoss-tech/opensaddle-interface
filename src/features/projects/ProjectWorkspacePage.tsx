import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import { Button, Status } from '../../ui'
import { selectThreadSummaries, type ThreadStatus } from '../thread/domain'
import '../../styles/team-workspace.css'

type ProjectTab = 'overview' | 'threads' | 'context' | 'automations' | 'settings'

function relativeTime(timestamp: number) {
  const hours = Math.max(0, Math.round((Date.now() - timestamp) / 3_600_000))
  if (hours < 1) return 'now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

interface ResourceLink {
  label: string
  detail: string
  icon: string
  href?: string
  action?: () => void
}

function statusTone(status: ThreadStatus) {
  if (status === 'completed') return 'success' as const
  if (status === 'blocked' || status === 'failed') return 'danger' as const
  if (status === 'needs_approval' || status === 'needs_input' || status === 'paused') return 'warning' as const
  if (status === 'running' || status === 'planning' || status === 'reviewing') return 'info' as const
  return 'neutral' as const
}

export function ProjectWorkspacePage() {
  const { projectId } = useParams()
  const { data, createChat, setActiveChat, setActiveProject } = useStore()
  const navigate = useNavigate()
  const [tab] = useState<ProjectTab>('overview')
  const [prompt, setPrompt] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('auto')
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const project = data.projects.find((item) => item.id === projectId)
    ?? data.projects.find((item) => item.id === data.activeProjectId)
    ?? data.projects[0]

  useEffect(() => {
    if (project.id !== data.activeProjectId) setActiveProject(project.id)
  }, [data.activeProjectId, project.id, setActiveProject])

  const teamProjectIds = useMemo(() => {
    const ids = new Set([project.id])
    let changed = true
    while (changed) {
      changed = false
      data.projects.forEach((candidate) => {
        if (candidate.parentId && ids.has(candidate.parentId) && !ids.has(candidate.id)) {
          ids.add(candidate.id)
          changed = true
        }
      })
    }
    return ids
  }, [data.projects, project.id])

  const threads = useMemo(
    () => selectThreadSummaries(data).filter((thread) => teamProjectIds.has(thread.projectId)),
    [data, teamProjectIds],
  )
  const sources = data.sources.filter((item) => teamProjectIds.has(item.projectId))
  const knowledge = data.knowledge.filter((item) => teamProjectIds.has(item.projectId))
  const services = data.services.filter((item) => teamProjectIds.has(item.projectId))
  const workflows = data.workflows.filter((item) => teamProjectIds.has(item.projectId))
  const tasks = data.tasks.filter((item) => teamProjectIds.has(item.projectId))
  const teamAgents = data.agents.filter((item) => teamProjectIds.has(item.projectId))
  const sites = data.sites.filter((item) => teamProjectIds.has(item.projectId))

  const recentArtifacts = useMemo(() => data.messages
    .filter((message) => {
      const chat = data.chats.find((item) => item.id === message.chatId)
      return chat && teamProjectIds.has(chat.projectId) && message.run?.artifacts?.length
    })
    .flatMap((message) => {
      const chat = data.chats.find((item) => item.id === message.chatId)
      return (message.run?.artifacts ?? []).map((artifact) => ({
        ...artifact,
        chatId: message.chatId,
        chatTitle: chat?.title ?? 'Team task',
        createdAt: message.createdAt,
      }))
    })
    .sort((a, b) => b.createdAt - a.createdAt), [data.chats, data.messages, teamProjectIds])

  const featuredThread = threads[0]
  const featuredAgent = teamAgents.find((agent) => agent.id === data.chats.find((chat) => chat.id === featuredThread?.chatId)?.agentId)
    ?? teamAgents[0]
  const selectedAgent = teamAgents.find((agent) => agent.id === selectedAgentId)

  const startTask = (initialPrompt?: string) => {
    const text = initialPrompt?.trim()
    const agentId = selectedAgentId === 'auto' ? teamAgents[0]?.id : selectedAgentId
    setActiveProject(project.id)
    const title = text
      ? text.replace(/^@\S+\s*/, '').slice(0, 64)
      : agentId
        ? `New task with ${teamAgents.find((agent) => agent.id === agentId)?.name ?? 'team agent'}`
        : 'New team task'
    const chat = createChat(project.id, title, agentId)
    if (text) {
      sessionStorage.setItem('opensaddle-pending-prompt', JSON.stringify({
        chatId: chat.id,
        prompt: text,
      }))
    }
    setActiveChat(chat.id)
    navigate(`/chat/${chat.id}`)
  }

  const submitPrompt = (event: FormEvent) => {
    event.preventDefault()
    if (!prompt.trim()) return
    startTask(prompt)
  }

  const openThread = (threadId: string) => {
    setActiveProject(project.id)
    setActiveChat(threadId)
    navigate(`/chat/${threadId}`)
  }

  const resourceLinks: ResourceLink[] = [
    { label: 'Agents', detail: `${teamAgents.length} configured`, icon: 'spark', href: `/agents/${project.id}` },
    { label: 'Knowledge', detail: `${knowledge.length + sources.length} sources`, icon: 'db', href: '/wiki' },
    { label: 'Automations', detail: `${workflows.length + tasks.length} workflows and tasks`, icon: 'activity', href: `/workflows/${project.id}` },
    { label: 'Apps & sites', detail: `${sites.length} published experiences`, icon: 'globe', href: '/sites' },
    { label: 'Files', detail: 'Team files and artifacts', icon: 'file', href: '/files' },
    { label: 'Access', detail: 'Permissions and inheritance', icon: 'shield', href: `/permissions/${project.id}` },
  ]

  return (
    <div
      className="tf-project-page tw-page"
      style={{ '--tw-team-color': project.iconColor } as CSSProperties}
    >
      {tab === 'overview' && (
        <div className="tw-home">
          <section className="tw-hero" aria-labelledby="team-prompt-title">
            <div className="tw-orbit tw-orbit-one" aria-hidden="true" />
            <div className="tw-orbit tw-orbit-two" aria-hidden="true" />
            <div className="tw-hero-copy">
              <span className="tw-live-pill"><span /> Team context connected</span>
              <h2 id="team-prompt-title">What would you like to work on?</h2>
              <p>Ask about anything in {project.name}, or start a task with one of your team agents.</p>
            </div>
            <form className="tw-composer" onSubmit={submitPrompt}>
              <label className="sr-only" htmlFor="team-prompt">Message the {project.name} team</label>
              <textarea
                id="team-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    if (prompt.trim()) startTask(prompt)
                  }
                }}
                placeholder={`Ask ${project.name} anything, or @mention an agent…`}
                rows={3}
              />
              <div className="tw-composer-actions">
                <div>
                  <button type="button" className="tw-icon-button" aria-label="Attach team context"><Icon name="paperclip" className="icon sm" /></button>
                  <div className="tw-agent-picker">
                    <button
                      type="button"
                      className="tw-agent-select"
                      aria-haspopup="listbox"
                      aria-expanded={agentPickerOpen}
                      onClick={() => setAgentPickerOpen((value) => !value)}
                    >
                      <Icon name="spark" className="icon sm" />
                      <span>{selectedAgent?.name ?? 'Auto-pick agent'}</span>
                      <Icon name="chevron" className={`icon xs ${agentPickerOpen ? 'open' : ''}`} />
                    </button>
                    {agentPickerOpen && (
                      <div className="tw-agent-menu" role="listbox" aria-label="Choose an agent">
                        <button
                          type="button"
                          role="option"
                          aria-selected={selectedAgentId === 'auto'}
                          className={selectedAgentId === 'auto' ? 'selected' : ''}
                          onClick={() => { setSelectedAgentId('auto'); setAgentPickerOpen(false) }}
                        >
                          <span className="tw-agent-menu-icon"><Icon name="spark" className="icon sm" /></span>
                          <span><strong>Auto-pick agent</strong><small>Let OpenSaddle choose for this task</small></span>
                          {selectedAgentId === 'auto' && <Icon name="check" className="icon xs" />}
                        </button>
                        {teamAgents.map((agent) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={selectedAgentId === agent.id}
                            className={selectedAgentId === agent.id ? 'selected' : ''}
                            key={agent.id}
                            onClick={() => { setSelectedAgentId(agent.id); setAgentPickerOpen(false) }}
                          >
                            <span className="tw-agent-menu-icon"><Icon name="spark" className="icon sm" /></span>
                            <span><strong>{agent.name}</strong><small>{agent.description}</small></span>
                            {selectedAgentId === agent.id && <Icon name="check" className="icon xs" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <button className="tw-send" type="submit" disabled={!prompt.trim()} aria-label="Start team chat"><Icon name="arrow" className="icon sm" /></button>
              </div>
            </form>
            <div className="tw-suggestions" aria-label="Suggested prompts">
              {['Summarize what changed today', 'What needs my attention?', 'Find the latest team artifact'].map((suggestion) => (
                <button key={suggestion} onClick={() => setPrompt(suggestion)}>{suggestion}</button>
              ))}
            </div>
            <a className="tw-scroll-cue" href="#team-explore">
              <span>Explore your team</span>
              <Icon name="chevron" className="icon xs" />
            </a>
          </section>

          <section className="tw-section tw-section-first" id="team-explore" aria-labelledby="collaboration-title">
            <div className="tw-section-heading">
              <div><span className="tw-kicker">Human + AI collaboration</span><h2 id="collaboration-title">Team channels</h2><p>Conversation stays readable here; detailed reasoning lives in linked agent threads.</p></div>
              <button onClick={() => navigate('/work')}>See all conversations <Icon name="forward" className="icon xs" /></button>
            </div>
            <div className="tw-channel-shell">
              <nav className="tw-channel-list" aria-label="Team channels">
                <button className="active"><span>#</span> engineering</button>
                <button><span>#</span> product-help</button>
                <button><span>#</span> releases</button>
              </nav>
              <div className="tw-channel">
                <div className="tw-channel-head">
                  <div><strong># engineering</strong><span>{data.members.length} people · {teamAgents.length} agents</span></div>
                  {featuredThread && <button onClick={() => openThread(featuredThread.chatId)}>Open channel</button>}
                </div>
                <div className="tw-message">
                  <span className="avatar">MC</span>
                  <div>
                    <p><strong>Maya Chen</strong><time>9:42 AM</time></p>
                    <p>Can <button className="tw-mention" onClick={() => {
                      if (featuredAgent) {
                        setSelectedAgentId(featuredAgent.id)
                        setPrompt(`@${featuredAgent.name} review the latest work and share anything the team needs to know`)
                      }
                    }}>@{featuredAgent?.name ?? 'Team Agent'}</button> review the latest work and share anything the team needs to know?</p>
                  </div>
                </div>
                <div className="tw-message tw-agent-message">
                  <span className="tw-agent-avatar"><Icon name="spark" className="icon sm" /></span>
                  <div>
                    <p><strong>{featuredAgent?.name ?? 'OpenSaddle Agent'}</strong><span className="tw-bot-label">AI</span><time>9:44 AM</time></p>
                    <p>{featuredThread?.latestTurnPreview ?? 'I reviewed the team context and recent work. The latest implementation is ready for review, with verification complete and no blocking issues.'}</p>
                    <div className="tw-response-links">
                      <button onClick={() => featuredThread && openThread(featuredThread.chatId)}><Icon name="file" className="icon sm" /> View artifact</button>
                      <button onClick={() => featuredThread && openThread(featuredThread.chatId)}><Icon name="trace" className="icon sm" /> Open agent thread</button>
                    </div>
                  </div>
                </div>
                <button className="tw-channel-reply" onClick={() => {
                  setPrompt(featuredAgent ? `@${featuredAgent.name} ` : '')
                  document.getElementById('team-prompt')?.focus()
                }}>Reply or @mention an agent…</button>
              </div>
            </div>
          </section>

          <section className="tw-section" aria-labelledby="team-now-title">
            <div className="tw-section-heading">
              <div><span className="tw-kicker">Live team pulse</span><h2 id="team-now-title">What’s happening now</h2></div>
            </div>
            <div className="tw-dashboard">
              <div className="tw-feed">
                <div className="tw-card-head"><h3>Ongoing & recent work</h3><button onClick={() => navigate('/work')}>View all</button></div>
                <div className="tf-project-thread-list tw-thread-list">
                  {threads.slice(0, 5).map((thread) => (
                    <button key={thread.id} onClick={() => openThread(thread.chatId)}>
                      <span className="tf-project-thread-icon"><Icon name={thread.status === 'running' ? 'activity' : 'message'} className="icon sm" /></span>
                      <span><strong>{thread.title}</strong><small>{thread.latestTurnPreview ?? 'No messages yet'} · {relativeTime(thread.updatedAt)}</small></span>
                      {thread.changedFileCount > 0 && <span className="tf-project-change-stat">+{thread.additions} −{thread.deletions}</span>}
                      <Status tone={statusTone(thread.status)} label={thread.statusLabel} pulse={thread.status === 'running'} />
                    </button>
                  ))}
                  {!threads.length && <div className="tf-project-empty">No team work yet. Ask a question above to get started.</div>}
                </div>
              </div>
              <aside className="tw-side-cards">
                <section className="tw-attention-card">
                  <div className="tw-card-head"><h3>Needs attention</h3><span>{threads.filter((thread) => thread.status === 'needs_approval' || thread.status === 'needs_input').length || 1}</span></div>
                  <button onClick={() => featuredThread && openThread(featuredThread.chatId)}>
                    <span className="tw-attention-icon"><Icon name="shield" className="icon sm" /></span>
                    <span><strong>Review agent output</strong><small>Approval requested · {relativeTime(featuredThread?.updatedAt ?? Date.now())}</small></span>
                    <Icon name="chevron" className="icon xs" />
                  </button>
                </section>
                <section className="tw-stats-card">
                  <h3>Team snapshot</h3>
                  <div><span>Active conversations</span><strong>{threads.filter((thread) => ['running', 'planning', 'reviewing'].includes(thread.status)).length}</strong></div>
                  <div><span>Artifacts this week</span><strong>{recentArtifacts.length}</strong></div>
                  <div><span>Agents available</span><strong>{teamAgents.length}</strong></div>
                  <div><span>Automations</span><strong>{workflows.length + tasks.length}</strong></div>
                </section>
              </aside>
            </div>
          </section>

          <section className="tw-section" aria-labelledby="artifacts-title">
            <div className="tw-section-heading">
              <div><span className="tw-kicker">Created by your team</span><h2 id="artifacts-title">Latest artifacts & milestones</h2></div>
            </div>
            <div className="tw-artifact-grid">
              {recentArtifacts.slice(0, 3).map((artifact) => (
                <button key={`${artifact.chatId}-${artifact.id}`} onClick={() => openThread(artifact.chatId)}>
                  <span className={`tw-artifact-icon ${artifact.type}`}><Icon name={artifact.type === 'diff' ? 'code' : artifact.type === 'table' ? 'chart' : 'file'} /></span>
                  <span className="tw-artifact-meta">{artifact.type}<time>{relativeTime(artifact.createdAt)}</time></span>
                  <strong>{artifact.title}</strong>
                  <small>{artifact.subtitle ?? artifact.chatTitle}</small>
                  <span className="tw-artifact-link">Open artifact <Icon name="forward" className="icon xs" /></span>
                </button>
              ))}
              {!recentArtifacts.length && (
                <button onClick={() => startTask('Create a team status summary')}>
                  <span className="tw-artifact-icon report"><Icon name="spark" /></span>
                  <span className="tw-artifact-meta">Suggested milestone</span>
                  <strong>Create a team status summary</strong>
                  <small>Ask an agent to turn recent work into a shareable artifact.</small>
                  <span className="tw-artifact-link">Start with AI <Icon name="forward" className="icon xs" /></span>
                </button>
              )}
            </div>
          </section>

          <section className="tw-section">
            <div className="tw-section-heading"><div><span className="tw-kicker">Team workspace</span><h2>Explore resources</h2></div></div>
            <div className="tf-resource-grid tw-resource-grid">
              {resourceLinks.map((resource) => (
                <button key={resource.label} onClick={() => {
                  if (resource.action) resource.action()
                  else if (resource.href) navigate(resource.href)
                }}>
                  <span><Icon name={resource.icon} /></span>
                  <strong>{resource.label}</strong>
                  <small>{resource.detail}</small>
                  <Icon name="chevron" className="icon xs tf-resource-arrow" />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === 'threads' && (
        <section className="tf-project-section tf-project-single">
          <div className="tf-project-section-head"><div><h2>Threads</h2><p>Every task and conversation in {project.name} and its team areas</p></div><Button variant="primary" size="sm" onClick={() => startTask()}>New task</Button></div>
          <div className="tf-project-thread-list">
            {threads.map((thread) => (
              <button key={thread.id} onClick={() => openThread(thread.chatId)}>
                <span className="tf-project-thread-icon"><Icon name="message" className="icon sm" /></span>
                <span><strong>{thread.title}</strong><small>{thread.messageCount} messages · {relativeTime(thread.updatedAt)}</small></span>
                <Status tone={statusTone(thread.status)} label={thread.statusLabel} />
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === 'context' && (
        <section className="tf-project-section tf-project-single">
          <div className="tf-project-section-head"><div><h2>Team context</h2><p>Sources stay inspectable without occupying the conversation surface.</p></div><button onClick={() => navigate('/wiki')}>Open knowledge</button></div>
          <div className="tf-context-list">
            {[...sources.map((item) => ({ id: item.id, name: item.name, detail: `${item.kind} · ${item.status}` })),
              ...knowledge.map((item) => ({ id: item.id, name: item.name, detail: `${item.kind} · ${item.status} · ${item.sensitivity}` })),
              ...services.map((item) => ({ id: item.id, name: item.name, detail: item.subtitle }))].map((item) => (
              <div key={item.id}><Icon name="db" className="icon sm" /><span><strong>{item.name}</strong><small>{item.detail}</small></span></div>
            ))}
          </div>
        </section>
      )}

      {tab === 'automations' && (
        <section className="tf-project-section tf-project-single">
          <div className="tf-project-section-head"><div><h2>Automations</h2><p>Scheduled and event-driven work for this team</p></div><button onClick={() => navigate(`/workflows/${project.id}`)}>Manage automations</button></div>
          <div className="tf-context-list">
            {workflows.map((workflow) => <div key={workflow.id}><Icon name="activity" className="icon sm" /><span><strong>{workflow.name}</strong><small>{workflow.trigger} · {workflow.status}</small></span><Status tone={workflow.status === 'active' ? 'success' : 'neutral'} label={workflow.status} /></div>)}
            {tasks.map((task) => <div key={task.id}><Icon name="clock" className="icon sm" /><span><strong>{task.name}</strong><small>{task.schedule || task.trigger} · {task.status}</small></span></div>)}
          </div>
        </section>
      )}

      {tab === 'settings' && (
        <section className="tf-project-section tf-project-single">
          <div className="tf-project-section-head"><div><h2>Team settings</h2><p>Defaults and policies used only when a task needs them</p></div><Button variant="secondary" size="sm" onClick={() => navigate(`/project/${project.id}/manage`)}>Open advanced manager</Button></div>
          <div className="tf-settings-rows">
            <div><span>Default provider</span><strong>{project.routingDefaults?.providerKey ?? 'Auto'}</strong></div>
            <div><span>Default model</span><strong>{project.routingDefaults?.modelKey ?? 'Auto'}</strong></div>
            <div><span>Default runtime</span><strong>{project.routingDefaults?.runtimeKey ?? 'Auto'}</strong></div>
            {project.local && <div><span>Local folder</span><strong>{project.local.rootPath}</strong></div>}
            {project.local && <div><span>Agent permissions</span><button onClick={() => navigate('/local')}>Open local admin</button></div>}
            <div><span>Knowledge sources</span><strong>{knowledge.length + sources.length}</strong></div>
            <div><span>Access policy</span><button onClick={() => navigate(`/permissions/${project.id}`)}>Review access</button></div>
          </div>
        </section>
      )}
    </div>
  )
}
