import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../data/store'
import { Icon } from '../common/Icon'
import type { PinnedArtifact, Project } from '../../types'
import { artifactIsActive, projectArtifacts, projectHref } from '../../navigation/projectArtifacts'

function relativeTime(ts: number) {
  const diff = Date.now() - ts
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

function projectTree(projects: Project[]) {
  const byParent = new Map<string | null, Project[]>()
  for (const p of projects) {
    const key = p.parentId
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(p)
  }
  return byParent
}

export function Sidebar({ onCreateProject }: { onCreateProject: () => void }) {
  const { data, setActiveProject, createChat, setActiveChat, switchUser, toast, updateWikiSettings, setPinnedArtifacts } = useStore()
  const nav = useNavigate()
  const location = useLocation()
  const tree = useMemo(() => projectTree(data.projects), [data.projects])
  const [wsOpen, setWsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('opensaddle-sidebar-collapsed') === 'true')
  const pinned = data.pinnedArtifacts ?? []
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('opensaddle-tree-collapsed')
      return new Set(raw ? JSON.parse(raw) as string[] : [])
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', sidebarCollapsed ? '76px' : '292px')
    localStorage.setItem('opensaddle-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    if (data.pinnedArtifacts) return
    try {
      const legacy = localStorage.getItem('opensaddle-pinned')
      setPinnedArtifacts(legacy ? JSON.parse(legacy) as PinnedArtifact[] : [])
      localStorage.removeItem('opensaddle-pinned')
    } catch {
      setPinnedArtifacts([])
    }
  }, [data.pinnedArtifacts, setPinnedArtifacts])

  const isPinned = (kind: PinnedArtifact['kind'], id: string) => pinned.some((x) => x.kind === kind && x.id === id)
  const togglePin = (kind: PinnedArtifact['kind'], id: string, label: string) => {
    const exists = pinned.some((x) => x.kind === kind && x.id === id)
    const next = exists ? pinned.filter((x) => !(x.kind === kind && x.id === id)) : [...pinned, { kind, id }]
    setPinnedArtifacts(next)
    toast(exists ? 'Unpinned' : 'Pinned', `${label} · synced to workspace`)
  }

  const openWiki = (projectId: string) => {
    updateWikiSettings({ selectedProjectId: projectId })
    nav('/wiki')
  }

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem('opensaddle-tree-collapsed', JSON.stringify([...next]))
      return next
    })
  }

  const renderBranch = (parentId: string | null, depth: number) =>
    (tree.get(parentId) ?? []).map((p) => {
      const childProjects = tree.get(p.id) ?? []
      const artifacts = projectArtifacts(data, p)
      const hasChildren = childProjects.length > 0 || artifacts.length > 0
      const isCollapsed = collapsed.has(p.id)
      const childDepth = Math.min(depth + 1, 2)
      return (
        <div key={p.id}>
          <button
            className={`tree-row depth-${Math.min(depth, 2)} ${data.activeProjectId === p.id ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
            onClick={() => {
              setActiveProject(p.id)
              nav(projectHref(p.id))
            }}
          >
            {depth < 2 && (hasChildren
              ? (
                <span
                  className="chev-toggle"
                  role="button"
                  aria-label={isCollapsed ? `Expand ${p.name}` : `Collapse ${p.name}`}
                  aria-expanded={!isCollapsed}
                  onClick={(e) => { e.stopPropagation(); toggleCollapsed(p.id) }}
                >
                  <Icon name="chevron" className="icon sm chev" />
                </span>
              )
              : <span style={{ width: 13 }} />)}
            <Icon name={depth >= 2 ? 'branch' : 'folder'} className="icon sm folder" />
            <span className="tree-title">{p.name}</span>
            <span
              className={`row-hover-btn ${isPinned('project', p.id) ? 'pinned' : ''}`}
              role="button"
              aria-label={isPinned('project', p.id) ? `Unpin ${p.name}` : `Pin ${p.name}`}
              title={isPinned('project', p.id) ? 'Unpin' : 'Pin'}
              onClick={(e) => { e.stopPropagation(); togglePin('project', p.id, p.name) }}
            >
              <Icon name="pin" className="icon sm" />
            </span>
            <span
              className="row-gear"
              role="button"
              aria-label={`${p.name} settings`}
              title="Project settings"
              onClick={(e) => { e.stopPropagation(); setActiveProject(p.id); nav(`/project/${p.id}`) }}
            >
              <Icon name="settings" className="icon sm" />
            </span>
          </button>
          {hasChildren && !isCollapsed && (
            <>
              {artifacts.map((artifact) => (
                <button
                  key={`${artifact.kind}-${artifact.id}`}
                  className={`tree-row depth-${childDepth} resource-row artifact-row ${artifact.kind} ${artifactIsActive(location.pathname, artifact) ? 'active' : ''}`}
                  title={`${artifact.label} in ${p.name}`}
                  onClick={() => {
                    setActiveProject(p.id)
                    if (artifact.kind === 'wiki') updateWikiSettings({ selectedProjectId: p.id })
                    nav(artifact.href)
                  }}
                >
                  <span style={{ width: 13 }} />
                  <Icon name={artifact.icon} className={`icon sm resource-icon ${artifact.kind}`} />
                  <span className="tree-title">{artifact.label}</span>
                  <span
                    className={`row-hover-btn ${isPinned(artifact.kind === 'site' ? 'site' : artifact.kind === 'wiki' ? 'wiki' : 'project', artifact.kind === 'site' ? artifact.id : p.id) ? 'pinned' : ''}`}
                    role="button"
                    title="Pin"
                    onClick={(e) => {
                      e.stopPropagation()
                      const kind = artifact.kind === 'site' ? 'site' : artifact.kind === 'wiki' ? 'wiki' : 'project'
                      togglePin(kind, artifact.kind === 'site' ? artifact.id : p.id, artifact.label)
                    }}
                  >
                    <Icon name="pin" className="icon sm" />
                  </span>
                </button>
              ))}
              {renderBranch(p.id, depth + 1)}
            </>
          )}
        </div>
      )
    })

  const pinnedRows = pinned
    .map((item) => {
      if (item.kind === 'project') {
        const p = data.projects.find((x) => x.id === item.id)
        if (!p) return null
        return {
          key: `project:${p.id}`, item, icon: 'folder', iconClass: 'folder', label: p.name,
          active: location.pathname === projectHref(p.id),
          go: () => { setActiveProject(p.id); nav(projectHref(p.id)) },
        }
      }
      if (item.kind === 'site') {
        const s = data.sites.find((x) => x.id === item.id)
        if (!s) return null
        return {
          key: `site:${s.id}`, item, icon: 'globe', iconClass: 'resource-icon site', label: s.name,
          active: location.pathname === `/site/${s.id}`,
          go: () => { setActiveProject(s.projectId); nav(`/site/${s.id}`) },
        }
      }
      const p = data.projects.find((x) => x.id === item.id)
      if (!p) return null
      return {
        key: `wiki:${p.id}`, item, icon: 'book', iconClass: 'resource-icon wiki', label: `${p.name} wiki`,
        active: location.pathname === `/project/${p.id}/wiki`,
        go: () => openWiki(p.id),
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} id="sidebar">
      <div className="sidebar-top" style={{ position: 'relative' }}>
        <button className="workspace-switcher" onClick={() => setWsOpen((v) => !v)}>
          <span className="workspace-logo"><Icon name="saddle" className="icon sm" /></span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="workspace-name">OpenSaddle</span>
            <span className="workspace-meta">{data.workspaceName}</span>
          </span>
          <Icon name="chevron" className="icon sm" />
        </button>
        <button className="sidebar-collapse-btn" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Minimize sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Minimize sidebar'} onClick={() => setSidebarCollapsed((value) => !value)}><Icon name="panel" className="icon sm" /></button>
        {wsOpen && (
          <div className="menu-dropdown" style={{ left: 12, right: 12, top: 52 }}>
            <button className="menu-item" onClick={() => { setWsOpen(false); nav('/admin') }}><Icon name="users" className="icon sm" /> Organization admin</button>
            <button className="menu-item" onClick={() => { setWsOpen(false); nav('/settings') }}><Icon name="settings" className="icon sm" /> Workspace settings</button>
            <button className="menu-item" onClick={() => { setWsOpen(false); nav('/usage') }}><Icon name="chart" className="icon sm" /> Usage & budgets</button>
          </div>
        )}
      </div>

      <div className="sidebar-scroll">
        <div className="nav-group">
          <button className="nav-item" onClick={() => {
            const c = createChat(data.activeProjectId)
            setActiveChat(c.id)
            nav(`/chat/${c.id}`)
          }}><Icon name="plus" />New chat</button>
          <button className="nav-item" onClick={() => window.dispatchEvent(new CustomEvent('opensaddle:palette'))}><Icon name="search" />Search<span className="nav-count">⌘ K</span></button>
        </div>

        {pinnedRows.length > 0 && (
          <div className="nav-group">
            <div className="nav-label">Pinned</div>
            <div className="tree">
              {pinnedRows.map((row) => (
                <button key={row.key} className={`tree-row pinned-row ${row.active ? 'active' : ''}`} onClick={row.go}>
                  <Icon name={row.icon} className={`icon sm ${row.iconClass}`} />
                  <span className="tree-title">{row.label}</span>
                  <span
                    className="row-hover-btn pinned"
                    role="button"
                    title="Unpin"
                    onClick={(e) => { e.stopPropagation(); togglePin(row.item.kind, row.item.id, row.label) }}
                  >
                    <Icon name="pin" className="icon sm" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="nav-group">
          <div className="nav-label">Projects <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={onCreateProject} title="Create project"><Icon name="plus" className="icon sm" /></button></div>
          <div className="tree">{renderBranch(null, 0)}</div>
        </div>

        <div className="nav-group">
          <div className="nav-label">Recent</div>
          {data.recentChatIds
            .map((id) => data.chats.find((c) => c.id === id))
            .filter((chat): chat is NonNullable<typeof chat> => Boolean(chat && !chat.archived))
            .slice(0, 8)
            .map((chat) => (
              <button key={chat.id} className="nav-item recent" onClick={() => { setActiveChat(chat.id); setActiveProject(chat.projectId); nav(`/chat/${chat.id}`) }}>
                <Icon name="message" className="icon sm" />
                <span className="recent-title">{chat.title}</span>
                <span className="nav-count">{relativeTime(chat.updatedAt)}</span>
              </button>
            ))}
          {!data.recentChatIds.some((id) => data.chats.some((c) => c.id === id && !c.archived)) && (
            <p className="recent-empty">Chats you open show up here.</p>
          )}
        </div>
      </div>

      <div className="sidebar-footer" style={{ position: 'relative' }}>
        {(() => {
          const me = data.members.find((m) => m.id === data.currentUserId)
          const roleLabel = me?.role === 'Admin' ? 'Enterprise · Full access'
            : me?.role === 'Editor' ? 'Enterprise · Can edit'
            : me?.role === 'Reviewer' ? 'Enterprise · Review only'
            : 'Enterprise · View only'
          const go = (path: string) => { setProfileOpen(false); nav(path) }
          return (
            <>
              <button className="profile-button" onClick={() => setProfileOpen((v) => !v)}>
                <span className="avatar">{me?.initials ?? 'AD'}</span>
                <span className="profile-copy"><span className="profile-name">{data.settings.displayName}</span><span className="profile-plan">{roleLabel}</span></span>
                <Icon name="settings" className="icon sm" />
              </button>
              {profileOpen && (
                <div className="menu-dropdown profile-menu" style={{ left: 8, right: 8, bottom: 56 }}>
                  <div className="menu-section-label">View as · demo profiles</div>
                  {data.members.map((m) => (
                    <button key={m.id} className={`menu-item persona-row ${m.id === data.currentUserId ? 'current' : ''}`} onClick={() => {
                      if (m.id !== data.currentUserId) {
                        switchUser(m.id)
                        toast('Profile switched', `${m.name} · ${m.role} — permissions re-evaluated`)
                      }
                      setProfileOpen(false)
                    }}>
                      <span className="avatar" style={{ width: 22, height: 22, fontSize: 8 }}>{m.initials}</span>
                      <span className="persona-copy"><span>{m.name}</span><small>{m.role}</small></span>
                      {m.id === data.currentUserId && <Icon name="check" className="icon sm" />}
                    </button>
                  ))}
                  <div className="menu-divider" />
                  <div className="menu-section-label">Personal</div>
                  <button className="menu-item" onClick={() => go('/settings')}><Icon name="settings" className="icon sm" /> Profile & preferences</button>
                  <button className="menu-item" onClick={() => go('/files')}><Icon name="file" className="icon sm" /> Files</button>
                  <button className="menu-item" onClick={() => go('/usage')}><Icon name="chart" className="icon sm" /> Usage & budgets</button>
                  <div className="menu-divider" />
                  <div className="menu-section-label">Workspace tools</div>
                  <button className="menu-item" onClick={() => go('/permissions')}><Icon name="shield" className="icon sm" /> Permissions</button>
                  <button className="menu-item" onClick={() => go('/environments')}><Icon name="vm" className="icon sm" /> Environments</button>
                  <button className="menu-item" onClick={() => go('/plugins')}><Icon name="plugin" className="icon sm" /> Plugin store</button>
                  <button className="menu-item" onClick={() => go('/harness')}><Icon name="tools" className="icon sm" /> Desktop harness</button>
                  {me?.role === 'Admin' && (
                    <>
                      <div className="menu-divider" />
                      <button className="menu-item" onClick={() => go('/admin')}><Icon name="users" className="icon sm" /> Organization admin</button>
                    </>
                  )}
                </div>
              )}
            </>
          )
        })()}
      </div>
      <div className="sidebar-resizer" id="sidebarResizer" title="Drag to resize" />
    </aside>
  )
}
