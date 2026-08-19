import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import type { Project } from '../../types'
import { selectThreadSummaries } from '../thread/domain'
import { useModalFocus } from '../../ui/modalFocus'
import '../../styles/team-shell.css'

const TEAM_COLORS_KEY = 'opensaddle.team-colors'
const PINNED_THREADS_KEY = 'opensaddle.pinned-threads'
const SEEN_THREADS_KEY = 'opensaddle.seen-threads'
const HIDDEN_TEAMS_KEY = 'opensaddle.hidden-teams'
const PROJECT_ACCESS_KEY = 'opensaddle.project-access'

function readLocalRecord(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function readLocalList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function teamInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function projectScope(projects: Project[], rootId: string) {
  const ids = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const project of projects) {
      if (project.parentId && ids.has(project.parentId) && !ids.has(project.id)) {
        ids.add(project.id)
        changed = true
      }
    }
  }
  return ids
}

function teamForProject(projects: Project[], teams: Project[], projectId: string) {
  const teamIds = new Set(teams.map((team) => team.id))
  let current = projects.find((project) => project.id === projectId)
  while (current) {
    if (teamIds.has(current.id)) return current
    current = projects.find((project) => project.id === current?.parentId)
  }
  return teams[0]
}

export function ThreadFirstSidebar({
  collapsed,
  globalMode,
  onCollapsedChange,
  onCreateProject,
  onResizeStart,
  onResetWidth,
}: {
  collapsed: boolean
  globalMode: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onCreateProject: () => void
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  onResetWidth: () => void
}) {
  const {
    data,
    archiveChat,
    branchChat,
    createChat,
    setActiveChat,
    setActiveProject,
    services,
    removeDemoData,
    removeLocalProject,
    toast,
    updateProject,
  } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [teamSettingsOpen, setTeamSettingsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [agentChooserOpen, setAgentChooserOpen] = useState(false)
  const [configureTeam, setConfigureTeam] = useState<Project | null>(null)
  const [teamName, setTeamName] = useState('')
  const [teamColor, setTeamColor] = useState('#73a8dd')
  const [teamColors, setTeamColors] = useState<Record<string, string>>(() => readLocalRecord(TEAM_COLORS_KEY))
  const [pinnedThreadIds, setPinnedThreadIds] = useState<string[]>(() => readLocalList(PINNED_THREADS_KEY))
  const [seenThreads, setSeenThreads] = useState<Record<string, string>>(() => readLocalRecord(SEEN_THREADS_KEY))
  const [threadMenu, setThreadMenu] = useState<{ chatId: string; projectId: string; x: number; y: number } | null>(null)
  const [teamMenu, setTeamMenu] = useState<{ team: Project; x: number; y: number } | null>(null)
  const [hiddenTeamIds, setHiddenTeamIds] = useState<string[]>(() => readLocalList(HIDDEN_TEAMS_KEY))
  const [projectAccess, setProjectAccess] = useState<Record<string, string>>(() => readLocalRecord(PROJECT_ACCESS_KEY))
  const agentChooserRef = useRef<HTMLElement>(null)
  const configureTeamRef = useRef<HTMLElement>(null)
  useModalFocus(agentChooserOpen, agentChooserRef, () => setAgentChooserOpen(false))
  useModalFocus(Boolean(configureTeam), configureTeamRef, () => setConfigureTeam(null))

  const organizationRoots = useMemo(
    () => data.projects.filter((project) => project.parentId === null && project.workspaceKind !== 'local'),
    [data.projects],
  )
  const enterpriseTeams = useMemo(() => {
    if (organizationRoots.length !== 1) return organizationRoots
    const root = organizationRoots[0]
    const directTeams = data.projects.filter((project) => project.parentId === root?.id && project.workspaceKind !== 'local')
    return root ? [root, ...directTeams] : directTeams
  }, [data.projects, organizationRoots])
  const localTeams = useMemo(
    () => data.projects.filter((project) => project.parentId === null && project.workspaceKind === 'local'),
    [data.projects],
  )
  const teams = useMemo(
    () => [...enterpriseTeams, ...localTeams].filter((team) => !hiddenTeamIds.includes(team.id)),
    [enterpriseTeams, hiddenTeamIds, localTeams],
  )
  const activeTeam = teamForProject(data.projects, teams, data.activeProjectId) ?? data.projects[0]
  const scopedProjectIds = useMemo(
    () => projectScope(data.projects, activeTeam?.id ?? data.activeProjectId),
    [activeTeam?.id, data.activeProjectId, data.projects],
  )
  const recent = useMemo(
    () => selectThreadSummaries(data).filter((thread) => scopedProjectIds.has(thread.projectId)).slice(0, 5),
    [data, scopedProjectIds],
  )
  const pinnedThreads = useMemo(
    () => selectThreadSummaries(data).filter((thread) => pinnedThreadIds.includes(thread.chatId) && scopedProjectIds.has(thread.projectId)),
    [data, pinnedThreadIds, scopedProjectIds],
  )
  const scopedAgents = useMemo(
    () => data.agents.filter((agent) => scopedProjectIds.has(agent.projectId)),
    [data.agents, scopedProjectIds],
  )
  const me = data.members.find((member) => member.id === data.currentUserId)
  const isAdmin = me?.role === 'Admin'
  const closeMobileNavigation = () => document.getElementById('sidebar')?.classList.remove('mobile-open')
  const openTeamRoute = (href: string) => {
    setActiveProject(activeTeam.id)
    navigate(href)
    closeMobileNavigation()
  }
  const adminShortcuts = isAdmin ? [
      {
        id: `${activeTeam.id}:knowledge`,
        label: 'Knowledge',
        icon: 'db',
        href: `/project/${activeTeam.id}/manage`,
        active: location.pathname === `/project/${activeTeam.id}/manage`,
        open: () => openTeamRoute(`/project/${activeTeam.id}/manage`),
      },
      {
        id: `${activeTeam.id}:files`,
        label: 'Files',
        icon: 'file',
        href: '/files',
        active: location.pathname === '/files',
        open: () => openTeamRoute('/files'),
      },
      {
        id: `${activeTeam.id}:access`,
        label: 'Access',
        icon: 'shield',
        href: `/permissions/${activeTeam.id}`,
        active: location.pathname.startsWith('/permissions'),
        open: () => openTeamRoute(`/permissions/${activeTeam.id}`),
      },
    ] : []

  useEffect(() => {
    const closeMenus = () => {
      setThreadMenu(null)
      setTeamMenu(null)
      setTeamSettingsOpen(false)
      setProfileOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setThreadMenu(null)
      setTeamMenu(null)
      setAgentChooserOpen(false)
      setConfigureTeam(null)
    }
    window.addEventListener('click', closeMenus)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', closeMenus)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    // Establish a local baseline. A dot only appears after a known thread changes
    // or the user explicitly marks it unread.
    setSeenThreads((current) => {
      let changed = false
      const next = { ...current }
      for (const thread of recent) {
        if (!(thread.chatId in next)) {
          next[thread.chatId] = String(thread.updatedAt)
          changed = true
        }
      }
      if (changed) localStorage.setItem(SEEN_THREADS_KEY, JSON.stringify(next))
      return changed ? next : current
    })
  }, [recent])

  const selectTeam = (team: Project) => {
    setActiveProject(team.id)
    const nextAccess = { ...projectAccess, [team.id]: String(Date.now()) }
    setProjectAccess(nextAccess)
    localStorage.setItem(PROJECT_ACCESS_KEY, JSON.stringify(nextAccess))
    navigate(`/project/${team.id}`)
    closeMobileNavigation()
  }

  const openProject = (project: Project) => {
    setActiveProject(project.id)
    const nextAccess = { ...projectAccess, [project.id]: String(Date.now()) }
    setProjectAccess(nextAccess)
    localStorage.setItem(PROJECT_ACCESS_KEY, JSON.stringify(nextAccess))
    navigate(`/project/${project.id}`)
    closeMobileNavigation()
  }

  const startTask = (agentId?: string) => {
    const targetProjectId = scopedProjectIds.has(data.activeProjectId) ? data.activeProjectId : activeTeam.id
    const agent = agentId ? data.agents.find((item) => item.id === agentId) : undefined
    const chat = createChat(targetProjectId, agent ? `${agent.name} task` : 'New task', agentId)
    setActiveChat(chat.id)
    navigate(`/chat/${chat.id}`)
    setAgentChooserOpen(false)
    closeMobileNavigation()
  }

  const openThread = (chatId: string, projectId: string) => {
    const thread = selectThreadSummaries(data).find((item) => item.chatId === chatId)
    const nextSeen = { ...seenThreads, [chatId]: String(thread?.updatedAt ?? Date.now()) }
    setSeenThreads(nextSeen)
    localStorage.setItem(SEEN_THREADS_KEY, JSON.stringify(nextSeen))
    setActiveProject(projectId)
    setActiveChat(chatId)
    navigate(`/chat/${chatId}`)
    closeMobileNavigation()
  }

  const togglePinned = (chatId: string) => {
    const next = pinnedThreadIds.includes(chatId)
      ? pinnedThreadIds.filter((id) => id !== chatId)
      : [chatId, ...pinnedThreadIds]
    setPinnedThreadIds(next)
    localStorage.setItem(PINNED_THREADS_KEY, JSON.stringify(next))
    setThreadMenu(null)
  }

  const markUnread = (chatId: string) => {
    const next = { ...seenThreads, [chatId]: '0' }
    setSeenThreads(next)
    localStorage.setItem(SEEN_THREADS_KEY, JSON.stringify(next))
    setThreadMenu(null)
  }

  const openConfigureTeam = (team: Project) => {
    setTeamName(team.name)
    setTeamColor(teamColors[team.id] ?? team.iconColor)
    setConfigureTeam(team)
  }

  const saveTeamConfiguration = () => {
    if (!configureTeam) return
    const name = teamName.trim()
    if (name && name !== configureTeam.name) updateProject(configureTeam.id, { name })
    const nextColors = { ...teamColors, [configureTeam.id]: teamColor }
    setTeamColors(nextColors)
    localStorage.setItem(TEAM_COLORS_KEY, JSON.stringify(nextColors))
    setConfigureTeam(null)
  }

  const leaveTeam = (team: Project) => {
    if (!window.confirm(`Leave ${team.name}? You can restore it by resetting local workspace preferences.`)) return
    const next = [...hiddenTeamIds, team.id]
    setHiddenTeamIds(next)
    localStorage.setItem(HIDDEN_TEAMS_KEY, JSON.stringify(next))
    const fallback = teams.find((candidate) => candidate.id !== team.id)
    if (fallback) selectTeam(fallback)
    else navigate('/start')
    setTeamMenu(null)
    toast('Team left', `${team.name} was removed from your team rail.`)
  }

  const removeLocalTeam = (team: Project) => {
    if (!window.confirm(`Remove local project “${team.name}” from OpenSaddle? Files on disk will not be deleted.`)) return
    removeLocalProject(team.id)
    setTeamMenu(null)
    navigate('/start')
    toast('Local project removed', 'The folder remains unchanged on your computer.')
  }

  const isUnseen = (chatId: string, updatedAt: number) =>
    Number(seenThreads[chatId] ?? updatedAt) < updatedAt

  const renderThreadRow = (thread: (typeof recent)[number], pinned = false) => (
    <div
      className="tf-thread-row"
      key={thread.id}
      onContextMenu={(event) => {
        event.preventDefault()
        setThreadMenu({ chatId: thread.chatId, projectId: thread.projectId, x: event.clientX, y: event.clientY })
      }}
    >
      <button className="tf-thread-open" onClick={() => openThread(thread.chatId, thread.projectId)}>
        {isUnseen(thread.chatId, thread.updatedAt) && <i className="tf-unseen-dot" aria-label="Unread update" />}
        <span>{thread.title}</span>
        <small>{relativeTime(thread.updatedAt)}</small>
      </button>
      <button
        className={`tf-thread-pin ${pinned ? 'pinned' : ''}`}
        onClick={() => togglePinned(thread.chatId)}
        aria-label={`${pinned ? 'Unpin' : 'Pin'} ${thread.title}`}
        title={pinned ? 'Unpin' : 'Pin'}
      >
        <Icon name="pin" className="icon xs" />
      </button>
    </div>
  )

  if (!activeTeam) return null

  return (
    <aside
      className={`tf-sidebar tf-team-shell ${collapsed ? 'collapsed' : ''} ${globalMode ? 'global-mode' : ''} ${services?.mode === 'desktop' ? 'desktop-mode' : ''}`}
      id="sidebar"
      aria-label="OpenSaddle navigation"
      style={{ '--team-color': teamColors[activeTeam.id] ?? activeTeam.iconColor } as React.CSSProperties}
    >
      <nav className="tf-team-rail" aria-label="Teams">
        <button className="tf-team-brand" onClick={() => navigate('/start')} aria-label="OpenSaddle home">
          <Icon name="saddle" className="icon sm" />
        </button>
        <span className="os-sr-only">Teams</span>
        <div className="tf-team-list">
          {teams.map((team) => (
            <button
              key={team.id}
              className={`tf-team-switch ${team.id === activeTeam.id ? 'active' : ''}`}
              style={{ '--team-color': teamColors[team.id] ?? team.iconColor } as React.CSSProperties}
              onClick={() => selectTeam(team)}
              onContextMenu={(event) => {
                event.preventDefault()
                setTeamMenu({ team, x: event.clientX, y: event.clientY })
              }}
              aria-label={`Switch to ${team.name}`}
              aria-current={team.id === activeTeam.id ? 'page' : undefined}
              title={team.name}
            >
              {teamInitials(team.name)}
            </button>
          ))}
          <button className="tf-team-switch tf-add-team" onClick={onCreateProject} aria-label="Add project" title="Add a local or cloud project">
            <Icon name="plus" className="icon sm" />
          </button>
        </div>
        <div className="tf-rail-spacer" />
        <button
          className="tf-rail-profile"
          aria-label={`${data.settings.displayName} profile and settings`}
          title={data.settings.displayName}
          onClick={(event) => {
            event.stopPropagation()
            setProfileOpen((value) => !value)
          }}
        >
          {me?.initials ?? teamInitials(data.settings.displayName)}
        </button>
      </nav>

      {!collapsed && !globalMode && (
        <section className="tf-selected-team" aria-label={`Selected team: ${activeTeam.name}`}>
          <header className="tf-selected-team-head">
            <div>
              <strong>{activeTeam.name}</strong>
              {activeTeam.demo && <em className="tf-demo-tag">Demo data</em>}
            </div>
            <button
              className="tf-icon-button"
              onClick={(event) => {
                event.stopPropagation()
                setTeamSettingsOpen((value) => !value)
              }}
              aria-label="Open team administration"
              aria-expanded={teamSettingsOpen}
              title="Team administration"
            >
              <Icon name="settings" className="icon sm" />
            </button>
            <button
              className="tf-icon-button"
              onClick={() => {
                if (window.matchMedia('(max-width: 820px)').matches) closeMobileNavigation()
                else onCollapsedChange(true)
              }}
              aria-label="Close or collapse selected team navigation"
            >
              <Icon name="x" className="icon sm tf-mobile-nav-close" />
              <Icon name="panel" className="icon sm tf-desktop-nav-collapse" />
            </button>
          </header>

          <div className="tf-selected-team-scroll">
            <div className="tf-team-primary-actions">
              <button className="tf-team-new-task" onClick={() => setAgentChooserOpen(true)}>
                <Icon name="plus" className="icon sm" />
                <span>New task</span>
              </button>
              <button className="tf-team-search" type="button" onClick={() => window.dispatchEvent(new CustomEvent('opensaddle:palette'))} aria-label="Search commands" title="Search commands">
                <Icon name="search" className="icon sm" />
                <span>Search</span>
                <kbd>⌘ K</kbd>
              </button>
            </div>

            <nav className="tf-team-nav" aria-label={`${activeTeam.name} navigation`}>
              <NavLink
                to="/work"
                className={({ isActive }) => isActive ? 'active' : ''}
                onClick={() => {
                  setActiveProject(activeTeam.id)
                  closeMobileNavigation()
                }}
              >
                <Icon name="clock" className="icon sm" /><span>Work</span>
                {services?.mode !== 'desktop' && data.notifications.some((item) => !item.read) && <i className="tf-attention-dot" />}
              </NavLink>
              <button className={location.pathname === `/project/${activeTeam.id}` ? 'active' : ''} onClick={() => openProject(activeTeam)}>
                <Icon name="layout" className="icon sm" /><span>Team overview</span>
              </button>
            </nav>

            {pinnedThreads.length > 0 && (
              <div className="tf-team-section tf-team-pinned">
                <div className="tf-team-section-label static"><span>Pinned</span></div>
                <div className="tf-team-section-list">
                  {pinnedThreads.map((thread) => renderThreadRow(thread, true))}
                </div>
              </div>
            )}

            <div className="tf-team-section tf-team-recent">
              <div className="tf-team-section-label static"><span>Recent</span></div>
              <div className="tf-team-section-list">
                {recent.map((thread) => renderThreadRow(thread, pinnedThreadIds.includes(thread.chatId)))}
              </div>
            </div>
          </div>

          {teamSettingsOpen && (
            <div className="tf-team-header-menu" role="menu" onClick={(event) => event.stopPropagation()}>
              {data.projects.some((project) => project.demo) && (
                <button role="menuitem" onClick={() => {
                  if (confirm('Remove all demo teams, people and conversations? A snapshot is kept in recovery.')) {
                    removeDemoData()
                    setTeamSettingsOpen(false)
                  }
                }}>
                  <Icon name="trash" className="icon sm" />Remove demo data
                </button>
              )}
              {adminShortcuts.map((shortcut) => (
                <button key={shortcut.id} role="menuitem" onClick={() => { shortcut.open(); setTeamSettingsOpen(false) }}>
                  <Icon name={shortcut.icon} className="icon sm" /><span>{shortcut.label}</span>
                </button>
              ))}
              <button role="menuitem" onClick={() => { openConfigureTeam(activeTeam); setTeamSettingsOpen(false) }}>
                <Icon name="settings" className="icon sm" /><span>Name &amp; appearance</span>
              </button>
            </div>
          )}

          <div
            className="tf-sidebar-resizer"
            role="separator"
            aria-label="Resize selected team navigation"
            aria-orientation="vertical"
            onPointerDown={onResizeStart}
            onDoubleClick={onResetWidth}
          />
        </section>
      )}

      {profileOpen && createPortal(
        <div className="tf-profile-menu tf-rail-profile-menu" onClick={(event) => event.stopPropagation()}>
          <div className="tf-profile-menu-head"><span>{me?.initials ?? teamInitials(data.settings.displayName)}</span><div><strong>{data.settings.displayName}</strong><small>{me?.role ?? 'Member'}</small></div></div>
          <button onClick={() => navigate('/settings')}><Icon name="settings" className="icon sm" />Settings</button>
          <button onClick={() => navigate('/settings/icon-packs')}><Icon name="spark" className="icon sm" />Icon lab</button>
          {isAdmin && <button onClick={() => navigate('/admin')}><Icon name="users" className="icon sm" />Admin</button>}
          <button onClick={() => navigate('/usage')}><Icon name="chart" className="icon sm" />Usage</button>
          <button onClick={() => navigate('/plugins')}><Icon name="plugin" className="icon sm" />Tools & plugins</button>
        </div>,
        document.body,
      )}

      {teamMenu && (
        <div
          className="tf-thread-context-menu tf-team-context-menu"
          role="menu"
          style={{ left: Math.min(teamMenu.x, window.innerWidth - 220), top: Math.min(teamMenu.y, window.innerHeight - 180) }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="tf-context-menu-title">{teamMenu.team.name}</div>
          <button role="menuitem" onClick={() => { openConfigureTeam(teamMenu.team); setTeamMenu(null) }}><Icon name="settings" className="icon sm" />Name &amp; appearance</button>
          <button role="menuitem" onClick={() => openProject(teamMenu.team)}><Icon name="folder" className="icon sm" />Open team</button>
          <div role="separator" />
          {teamMenu.team.workspaceKind === 'local'
            ? <button className="danger" role="menuitem" onClick={() => removeLocalTeam(teamMenu.team)}><Icon name="archive" className="icon sm" />Remove local project</button>
            : <button className="danger" role="menuitem" onClick={() => leaveTeam(teamMenu.team)}><Icon name="x" className="icon sm" />Leave team</button>}
        </div>
      )}

      {agentChooserOpen && (
        <div className="tf-shell-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAgentChooserOpen(false) }}>
          <section ref={agentChooserRef} className="tf-shell-dialog" role="dialog" aria-modal="true" aria-labelledby="tf-agent-chooser-title" tabIndex={-1}>
            <header>
              <div><span>New task</span><h2 id="tf-agent-chooser-title">Choose how to start</h2></div>
              <button className="tf-icon-button" onClick={() => setAgentChooserOpen(false)} aria-label="Close agent chooser"><Icon name="x" className="icon sm" /></button>
            </header>
            <div className="tf-agent-options">
              <button onClick={() => startTask()}>
                <Icon name="plus" className="icon sm" />
                <span><strong>Blank task</strong><small>Start without a predefined agent</small></span>
              </button>
              {scopedAgents.map((agent) => (
                <button key={agent.id} onClick={() => startTask(agent.id)}>
                  <Icon name="spark" className="icon sm" />
                  <span><strong>{agent.name}</strong><small>{agent.description}</small></span>
                </button>
              ))}
              {!scopedAgents.length && <p>No agents have been created in this team yet.</p>}
            </div>
          </section>
        </div>
      )}

      {configureTeam && (
        <div className="tf-shell-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfigureTeam(null) }}>
          <section ref={configureTeamRef} className="tf-shell-dialog tf-configure-team" role="dialog" aria-modal="true" aria-labelledby="tf-configure-team-title" tabIndex={-1}>
            <header>
              <div><span>Team settings</span><h2 id="tf-configure-team-title">Name &amp; appearance</h2></div>
              <button className="tf-icon-button" onClick={() => setConfigureTeam(null)} aria-label="Close team settings"><Icon name="x" className="icon sm" /></button>
            </header>
            <label>
              <span>Display name</span>
              <input autoFocus value={teamName} onChange={(event) => setTeamName(event.target.value)} />
            </label>
            <label>
              <span>Team color</span>
              <div className="tf-color-field">
                <input type="color" value={teamColor} onChange={(event) => setTeamColor(event.target.value)} />
                <code>{teamColor.toUpperCase()}</code>
              </div>
            </label>
            <div className="tf-dialog-actions">
              <button onClick={() => setConfigureTeam(null)}>Cancel</button>
              <button className="primary" onClick={saveTeamConfiguration} disabled={!teamName.trim()}>Save changes</button>
            </div>
          </section>
        </div>
      )}

      {threadMenu && (() => {
        const thread = selectThreadSummaries(data).find((item) => item.chatId === threadMenu.chatId)
        const pinned = pinnedThreadIds.includes(threadMenu.chatId)
        return (
          <div
            className="tf-thread-context-menu"
            role="menu"
            style={{ left: Math.min(threadMenu.x, window.innerWidth - 210), top: Math.min(threadMenu.y, window.innerHeight - 180) }}
            onClick={(event) => event.stopPropagation()}
          >
            <button role="menuitem" onClick={() => togglePinned(threadMenu.chatId)}><Icon name="pin" className="icon sm" />{pinned ? 'Unpin' : 'Pin'}</button>
            <button role="menuitem" onClick={() => markUnread(threadMenu.chatId)}><Icon name="bell" className="icon sm" />Mark as unread</button>
            <button role="menuitem" onClick={() => { archiveChat(threadMenu.chatId); setThreadMenu(null) }}><Icon name="archive" className="icon sm" />Archive</button>
            <div role="separator" />
            <button role="menuitem" onClick={() => {
              const branched = branchChat(threadMenu.chatId)
              if (branched) openThread(branched.id, branched.projectId)
              setThreadMenu(null)
            }} disabled={!thread}>
              <Icon name="branch" className="icon sm" />Continue in new chat
            </button>
          </div>
        )
      })()}

      {collapsed && !globalMode && (
        <button className="tf-expand-team-rail" onClick={() => onCollapsedChange(false)} aria-label="Expand selected team navigation" title="Show selected team">
          <Icon name="panel" className="icon sm" />
        </button>
      )}
    </aside>
  )
}
