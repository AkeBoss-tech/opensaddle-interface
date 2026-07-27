import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import { Button, Status } from '../../ui'
import { selectThreadSummaries, type ThreadStatus } from '../thread/domain'

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
  if (status === 'needs_approval' || status === 'needs_input') return 'warning' as const
  if (status === 'running' || status === 'planning' || status === 'reviewing') return 'info' as const
  return 'neutral' as const
}

export function ProjectWorkspacePage() {
  const { projectId } = useParams()
  const { data, createChat, setActiveChat, setActiveProject } = useStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState<ProjectTab>('overview')
  const project = data.projects.find((item) => item.id === projectId)
    ?? data.projects.find((item) => item.id === data.activeProjectId)
    ?? data.projects[0]

  const threads = useMemo(() => selectThreadSummaries(data, { projectId: project.id }), [data, project.id])
  const sources = data.sources.filter((item) => item.projectId === project.id)
  const knowledge = data.knowledge.filter((item) => item.projectId === project.id)
  const services = data.services.filter((item) => item.projectId === project.id)
  const workflows = data.workflows.filter((item) => item.projectId === project.id)
  const tasks = data.tasks.filter((item) => item.projectId === project.id)

  const startTask = () => {
    setActiveProject(project.id)
    const chat = createChat(project.id, 'New task')
    setActiveChat(chat.id)
    navigate(`/chat/${chat.id}`)
  }

  const openThread = (threadId: string) => {
    setActiveProject(project.id)
    setActiveChat(threadId)
    navigate(`/chat/${threadId}`)
  }

  const resourceLinks: ResourceLink[] = [
    { label: 'Agents', detail: `${data.agents.filter((item) => item.projectId === project.id).length} configured`, icon: 'spark', href: `/agents/${project.id}` },
    { label: 'Knowledge', detail: `${knowledge.length + sources.length} sources`, icon: 'db', href: '/wiki' },
    { label: 'Automations', detail: `${workflows.length + tasks.length} workflows and tasks`, icon: 'activity', action: () => setTab('automations') },
    { label: 'Apps & sites', detail: `${data.sites.filter((item) => item.projectId === project.id).length} published experiences`, icon: 'globe', href: '/sites' },
    { label: 'Files', detail: 'Project files and artifacts', icon: 'file', href: '/files' },
    { label: 'Access', detail: 'Permissions and inheritance', icon: 'shield', href: `/permissions/${project.id}` },
  ]

  return (
    <div className="tf-project-page">
      <header className="tf-project-header">
        <div className="tf-project-title">
          <span className="tf-project-mark" style={{ '--project-color': project.iconColor } as CSSProperties}><Icon name="folder" /></span>
          <div><span className="tf-eyebrow">Project</span><h1>{project.name}</h1><p>{project.description}</p></div>
        </div>
        <div className="tf-project-actions">
          <Button variant="ghost" size="sm" onClick={() => navigate(project.workspaceKind === 'local' ? '/local' : `/project/${project.id}/manage`)}>{project.workspaceKind === 'local' ? 'Local admin' : 'Manage'}</Button>
          <Button variant="primary" size="sm" leadingIcon={<Icon name="plus" className="icon sm" />} onClick={startTask}>Start a task</Button>
        </div>
      </header>

      <div className="tf-project-tabs" role="tablist" aria-label="Project sections">
        {(['overview', 'threads', 'context', 'automations', 'settings'] as const).map((item) => (
          <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {item[0]!.toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="tf-project-layout">
          <main>
            <section className="tf-project-section">
              <div className="tf-project-section-head"><div><h2>Recent work</h2><p>Threads and outcomes in this project</p></div><button onClick={() => setTab('threads')}>View all</button></div>
              <div className="tf-project-thread-list">
                {threads.slice(0, 6).map((thread) => (
                  <button key={thread.id} onClick={() => openThread(thread.chatId)}>
                    <span className="tf-project-thread-icon"><Icon name="message" className="icon sm" /></span>
                    <span><strong>{thread.title}</strong><small>{thread.latestTurnPreview ?? 'No messages yet'} · {relativeTime(thread.updatedAt)}</small></span>
                    {thread.changedFileCount > 0 && <span className="tf-project-change-stat">+{thread.additions} −{thread.deletions}</span>}
                    <Status tone={statusTone(thread.status)} label={thread.statusLabel} pulse={thread.status === 'running'} />
                  </button>
                ))}
                {!threads.length && <div className="tf-project-empty">Start the first task in this project.</div>}
              </div>
            </section>

            <section className="tf-project-section">
              <div className="tf-project-section-head"><div><h2>Resources</h2><p>Capabilities available to work in this project</p></div></div>
              <div className="tf-resource-grid">
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
          </main>

          <aside className="tf-project-side">
            <section>
              <h2>Context</h2>
              <div className="tf-context-stat"><span>Sources</span><strong>{sources.length + knowledge.length}</strong></div>
              <div className="tf-context-stat"><span>Connections</span><strong>{services.length}</strong></div>
              <div className="tf-context-stat"><span>Inherited depth</span><strong>{Math.max(0, project.lineage.length - 2)}</strong></div>
              <button onClick={() => setTab('context')}>Inspect context</button>
            </section>
            <section>
              <h2>People</h2>
              <div className="tf-member-stack">{data.members.slice(0, 5).map((member) => <span key={member.id} className="avatar" title={`${member.name} · ${member.role}`}>{member.initials}</span>)}</div>
              <p>{data.members.length} workspace members can be governed here.</p>
            </section>
          </aside>
        </div>
      )}

      {tab === 'threads' && (
        <section className="tf-project-section tf-project-single">
          <div className="tf-project-section-head"><div><h2>Threads</h2><p>Every task and conversation in {project.name}</p></div><Button variant="primary" size="sm" onClick={startTask}>New task</Button></div>
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
          <div className="tf-project-section-head"><div><h2>Project context</h2><p>Sources stay inspectable without occupying the task surface.</p></div><button onClick={() => navigate('/wiki')}>Open knowledge</button></div>
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
          <div className="tf-project-section-head"><div><h2>Automations</h2><p>Scheduled and event-driven work for this project</p></div><button onClick={() => navigate(`/workflows/${project.id}`)}>Manage automations</button></div>
          <div className="tf-context-list">
            {workflows.map((workflow) => <div key={workflow.id}><Icon name="activity" className="icon sm" /><span><strong>{workflow.name}</strong><small>{workflow.trigger} · {workflow.status}</small></span><Status tone={workflow.status === 'active' ? 'success' : 'neutral'} label={workflow.status} /></div>)}
            {tasks.map((task) => <div key={task.id}><Icon name="clock" className="icon sm" /><span><strong>{task.name}</strong><small>{task.schedule || task.trigger} · {task.status}</small></span></div>)}
          </div>
        </section>
      )}

      {tab === 'settings' && (
        <section className="tf-project-section tf-project-single">
          <div className="tf-project-section-head"><div><h2>Project settings</h2><p>Defaults and policies used only when a task needs them</p></div><Button variant="secondary" size="sm" onClick={() => navigate(`/project/${project.id}/manage`)}>Open advanced manager</Button></div>
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
