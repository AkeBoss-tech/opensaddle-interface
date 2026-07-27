import { useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import { selectThreadSummaries, type ThreadSummary } from '../thread/domain'
import type { AppData, Project } from '../../types'
import type { ProjectArtifactManifest } from '../../services/contracts'

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function threadTone(status: ThreadSummary['status']) {
  if (status === 'running' || status === 'planning' || status === 'reviewing') return 'running'
  if (status === 'paused') return 'paused'
  if (status === 'blocked' || status === 'failed' || status === 'needs_approval' || status === 'needs_input') return 'blocked'
  return 'ready'
}

function ProjectTree({
  projects,
  parentId,
  activeProjectId,
  data,
  manifests,
  expanded,
  locationPath,
  onOpen,
  onToggle,
  onOpenWiki,
  onOpenSites,
  onOpenSite,
  onOpenLocalArtifact,
}: {
  projects: Project[]
  parentId: string | null
  activeProjectId: string
  data: AppData
  manifests: Record<string, ProjectArtifactManifest>
  expanded: Set<string>
  locationPath: string
  onOpen: (project: Project) => void
  onToggle: (projectId: string) => void
  onOpenWiki: (project: Project) => void
  onOpenSites: (project: Project) => void
  onOpenSite: (project: Project, siteId: string) => void
  onOpenLocalArtifact: (project: Project, tab: 'documentation' | 'agents' | 'skills') => void
}) {
  const children = projects.filter((project) => project.parentId === parentId)
  if (!children.length) return null
  return (
    <div className={parentId ? 'tf-project-children' : 'tf-project-tree'}>
      {children.map((project) => {
        const sites = data.sites.filter((site) => site.projectId === project.id)
        const wikiCount = data.wikiSummaries.filter((summary) => summary.projectId === project.id).length
        const agents = data.agents.filter((agent) => agent.projectId === project.id)
        const documents = project.local?.documents ?? []
        const skills = project.local?.skills ?? []
        const manifest = manifests[project.id]
        const isOpen = expanded.has(project.id)
        return (
          <div key={project.id} className="tf-project-node">
            <div className="tf-project-row-wrap">
              <button
                className="tf-project-disclosure"
                aria-label={isOpen ? `Collapse ${project.name}` : `Expand ${project.name}`}
                aria-expanded={isOpen}
                onClick={() => onToggle(project.id)}
              >
                <Icon name="chevron" className={`icon xs tf-chevron ${isOpen ? 'open' : ''}`} />
              </button>
              <button
                className={`tf-project-row ${activeProjectId === project.id ? 'active' : ''}`}
                onClick={() => onOpen(project)}
              >
                <Icon name="folder" className={`icon sm ${project.workspaceKind === 'local' ? 'tf-local-folder' : ''}`} />
                <span>{project.name}</span>
                {project.workspaceKind === 'local' && <small className="tf-project-kind">Local</small>}
              </button>
            </div>
            {isOpen && (
              <div className="tf-project-artifacts">
                <button
                  className={`tf-artifact-row ${locationPath === '/wiki' && data.wikiSettings.selectedProjectId === project.id ? 'active' : ''}`}
                  onClick={() => onOpenWiki(project)}
                >
                  <Icon name="book" className="icon sm tf-artifact-icon wiki" />
                  <span>Wiki</span>
                  <small>{wikiCount || manifest?.artifacts.filter((artifact) => artifact.path.toLowerCase().includes('wiki')).length || '—'}</small>
                </button>
                <button className={`tf-artifact-row ${locationPath === '/sites' && activeProjectId === project.id ? 'active' : ''}`} onClick={() => onOpenSites(project)}>
                  <Icon name="globe" className="icon sm tf-artifact-icon site" />
                  <span>Sites</span>
                  <small>{sites.length + (manifest?.counts.site ?? 0)}</small>
                </button>
                {sites.map((site) => (
                  <button
                    key={site.id}
                    className={`tf-artifact-row ${locationPath === `/site/${site.id}` ? 'active' : ''}`}
                    onClick={() => onOpenSite(project, site.id)}
                  >
                    <Icon name="globe" className="icon sm tf-artifact-icon site" />
                    <span>{site.name}</span>
                    <small>Site</small>
                  </button>
                ))}
                {project.local && (
                  <>
                    <button className="tf-artifact-row" onClick={() => onOpenLocalArtifact(project, 'documentation')}>
                      <Icon name="file" className="icon sm tf-artifact-icon docs" />
                      <span>Documentation</span>
                      <small>{manifest?.counts.documentation ?? documents.length}</small>
                    </button>
                    <button className="tf-artifact-row" onClick={() => onOpenLocalArtifact(project, 'agents')}>
                      <Icon name="spark" className="icon sm tf-artifact-icon agents" />
                      <span>Agents</span>
                      <small>{agents.length + (manifest?.counts.agent ?? 0)}</small>
                    </button>
                    <button className="tf-artifact-row" onClick={() => onOpenLocalArtifact(project, 'skills')}>
                      <Icon name="plugin" className="icon sm tf-artifact-icon skills" />
                      <span>Skills</span>
                      <small>{manifest?.counts.skill ?? skills.length}</small>
                    </button>
                  </>
                )}
                <ProjectTree
                  projects={projects}
                  parentId={project.id}
                  activeProjectId={activeProjectId}
                  data={data}
                  manifests={manifests}
                  expanded={expanded}
                  locationPath={locationPath}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  onOpenWiki={onOpenWiki}
                  onOpenSites={onOpenSites}
                  onOpenSite={onOpenSite}
                  onOpenLocalArtifact={onOpenLocalArtifact}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ThreadFirstSidebar({
  collapsed,
  onCollapsedChange,
  onCreateProject,
}: {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onCreateProject: () => void
}) {
  const store = useStore()
  const { data, createChat, setActiveChat, setActiveProject, services, localProjectManifests } = store
  const navigate = useNavigate()
  const location = useLocation()
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [localProjectsOpen, setLocalProjectsOpen] = useState(true)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set(
    data.projects.filter((project) => project.workspaceKind === 'local').map((project) => project.id),
  ))
  const [profileOpen, setProfileOpen] = useState(false)

  const recent = useMemo(() => selectThreadSummaries(data).slice(0, 9), [data])
  const localProjects = useMemo(() => data.projects.filter((project) => project.workspaceKind === 'local'), [data.projects])
  const workspaceProjects = useMemo(() => data.projects.filter((project) => project.workspaceKind !== 'local'), [data.projects])

  const newTask = () => {
    const chat = createChat(data.activeProjectId, 'New task')
    setActiveChat(chat.id)
    navigate(`/chat/${chat.id}`)
  }

  const openProject = (project: Project) => {
    setActiveProject(project.id)
    navigate(project.workspaceKind === 'local' ? `/local?project=${project.id}` : `/project/${project.id}`)
  }

  const toggleProject = (projectId: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const openWiki = (project: Project) => {
    setActiveProject(project.id)
    store.updateWikiSettings({ selectedProjectId: project.id })
    navigate('/wiki')
  }

  const openSite = (project: Project, siteId: string) => {
    setActiveProject(project.id)
    navigate(`/site/${siteId}`)
  }

  const openSites = (project: Project) => {
    setActiveProject(project.id)
    navigate(`/sites?project=${project.id}`)
  }

  const openLocalArtifact = (project: Project, tab: 'documentation' | 'agents' | 'skills') => {
    setActiveProject(project.id)
    navigate(`/local?project=${project.id}&tab=${tab}`)
  }

  const openThread = (thread: ThreadSummary) => {
    setActiveProject(thread.projectId)
    setActiveChat(thread.chatId)
    navigate(`/chat/${thread.chatId}`)
  }

  const me = data.members.find((member) => member.id === data.currentUserId)

  return (
    <aside className={`tf-sidebar ${collapsed ? 'collapsed' : ''}`} id="sidebar" aria-label="Workspace navigation">
      <div className="tf-sidebar-head">
        <button className="tf-workspace" onClick={() => navigate('/work')} title="OpenSaddle workspace">
          <span className="tf-workspace-logo"><Icon name="saddle" className="icon sm" /></span>
          {!collapsed && <span><strong>OpenSaddle</strong><small>{services?.mode === 'desktop' || services?.controlPlane.mode === 'local' ? 'Local desktop workspace' : data.workspaceName}</small></span>}
        </button>
        <button className="tf-icon-button" onClick={() => onCollapsedChange(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon name="panel" className="icon sm" />
        </button>
      </div>

      <div className="tf-sidebar-scroll">
        <div className="tf-nav-block tf-primary-actions">
          <button className="tf-nav-row" onClick={newTask}>
            <Icon name="plus" className="icon sm" /><span>New task</span>
          </button>
          <button className="tf-nav-row" onClick={() => window.dispatchEvent(new CustomEvent('opensaddle:palette'))}>
            <Icon name="search" className="icon sm" /><span>Search</span>{!collapsed && <kbd>⌘ K</kbd>}
          </button>
        </div>

        <nav className="tf-nav-block" aria-label="Primary">
          <NavLink to="/work" className={({ isActive }) => `tf-nav-row ${isActive ? 'active' : ''}`}>
            <Icon name="clock" className="icon sm" /><span>Work</span>
            {!collapsed && services?.mode !== 'desktop' && services?.controlPlane.mode !== 'local' && data.notifications.some((item) => !item.read) && <span className="tf-attention-dot" />}
          </NavLink>
          {(window.opensaddleDesktop || services?.controlPlane.mode === 'local' || localProjects.length > 0) && (
            <>
              <button className={`tf-nav-row ${location.pathname === '/local' ? 'active' : ''}`} onClick={() => setLocalProjectsOpen((value) => !value)}>
                <Icon name="terminal" className="icon sm" /><span>Local projects</span>
                {!collapsed && <small className="tf-local-tag">Admin</small>}
                {!collapsed && <Icon name="chevron" className={`icon xs tf-chevron ${localProjectsOpen ? 'open' : ''}`} />}
              </button>
              {!collapsed && localProjectsOpen && (
                <div className="tf-projects-wrap tf-local-projects-wrap">
                  <ProjectTree
                    projects={localProjects}
                    parentId={null}
                    activeProjectId={data.activeProjectId}
                    data={data}
                    manifests={localProjectManifests}
                    expanded={expandedProjects}
                    locationPath={location.pathname}
                    onOpen={openProject}
                    onToggle={toggleProject}
                    onOpenWiki={openWiki}
                    onOpenSites={openSites}
                    onOpenSite={openSite}
                    onOpenLocalArtifact={openLocalArtifact}
                  />
                  <button className="tf-add-project" onClick={() => navigate('/local')}>
                    <Icon name="plus" className="icon xs" /> Add folder
                  </button>
                  <button className={`tf-add-project ${location.pathname === '/sessions' ? 'active' : ''}`} onClick={() => navigate('/sessions')}>
                    <Icon name="terminal" className="icon xs" /> Codex / Claude sessions
                  </button>
                </div>
              )}
            </>
          )}
          <button className={`tf-nav-row ${location.pathname.startsWith('/project/') ? 'active' : ''}`} onClick={() => setProjectsOpen((value) => !value)}>
            <Icon name="folder" className="icon sm" /><span>Projects</span>
            {!collapsed && <Icon name="chevron" className={`icon xs tf-chevron ${projectsOpen ? 'open' : ''}`} />}
          </button>
          {!collapsed && projectsOpen && (
            <div className="tf-projects-wrap">
              <ProjectTree
                projects={workspaceProjects}
                parentId={null}
                activeProjectId={data.activeProjectId}
                data={data}
                manifests={localProjectManifests}
                expanded={expandedProjects}
                locationPath={location.pathname}
                onOpen={openProject}
                onToggle={toggleProject}
                onOpenWiki={openWiki}
                onOpenSites={openSites}
                onOpenSite={openSite}
                onOpenLocalArtifact={openLocalArtifact}
              />
              <button className="tf-add-project" onClick={onCreateProject}><Icon name="plus" className="icon xs" /> New project</button>
            </div>
          )}
        </nav>

        {!collapsed && (
          <div className="tf-nav-block tf-recent-block">
            <div className="tf-section-label">Recent</div>
            {recent.map((thread) => {
              const tone = threadTone(thread.status)
              return (
                <button key={thread.id} className={`tf-thread-row ${location.pathname === `/chat/${thread.chatId}` ? 'active' : ''}`} onClick={() => openThread(thread)}>
                  <span className={`tf-thread-state ${tone}`} title={thread.statusLabel} />
                  <span className="tf-thread-copy"><strong>{thread.title}</strong><small>{thread.project.name}</small></span>
                  <span className="tf-thread-time">{relativeTime(thread.updatedAt)}</span>
                </button>
              )
            })}
            {!recent.length && <p className="tf-empty-copy">Your recent tasks will appear here.</p>}
          </div>
        )}
      </div>

      <div className="tf-sidebar-foot">
        <button className="tf-profile" onClick={() => setProfileOpen((value) => !value)}>
          <span className="avatar">{me?.initials ?? 'OS'}</span>
          {!collapsed && <span><strong>{data.settings.displayName}</strong><small>{me?.role ?? 'Member'}</small></span>}
          {!collapsed && <Icon name="chevron" className="icon xs" />}
        </button>
        {profileOpen && (
          <div className="tf-profile-menu">
            <button onClick={() => { setProfileOpen(false); navigate('/settings') }}><Icon name="settings" className="icon sm" />Settings</button>
            <button onClick={() => { setProfileOpen(false); navigate('/admin') }}><Icon name="users" className="icon sm" />Admin</button>
            <button onClick={() => { setProfileOpen(false); navigate('/usage') }}><Icon name="chart" className="icon sm" />Usage</button>
            <button onClick={() => { setProfileOpen(false); navigate('/plugins') }}><Icon name="plugin" className="icon sm" />Tools & plugins</button>
          </div>
        )}
      </div>
    </aside>
  )
}
