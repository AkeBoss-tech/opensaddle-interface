import { NavLink, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useStore } from '../../data/store'
import { Icon } from '../common/Icon'
import type { Project } from '../../types'

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
  const { data, setActiveProject, createChat, setActiveChat } = useStore()
  const nav = useNavigate()
  const tree = useMemo(() => projectTree(data.projects), [data.projects])
  const [wsOpen, setWsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('opensaddle-tree-collapsed')
      return new Set(raw ? JSON.parse(raw) as string[] : [])
    } catch {
      return new Set()
    }
  })
  const unread = data.notifications.filter((n) => !n.read).length

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
      const hasChildren = Boolean(tree.get(p.id)?.length)
      const isCollapsed = collapsed.has(p.id)
      return (
        <div key={p.id}>
          <button
            className={`tree-row depth-${Math.min(depth, 2)} ${data.activeProjectId === p.id ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`}
            onClick={() => { setActiveProject(p.id); nav(`/project/${p.id}`) }}
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
          </button>
          {hasChildren && !isCollapsed && renderBranch(p.id, depth + 1)}
        </div>
      )
    })

  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar-top" style={{ position: 'relative' }}>
        <button className="workspace-switcher" onClick={() => setWsOpen((v) => !v)}>
          <span className="workspace-logo"><Icon name="spark" className="icon sm" /></span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="workspace-name">OpenSaddle</span>
            <span className="workspace-meta">{data.workspaceName}</span>
          </span>
          <Icon name="chevron" className="icon sm" />
        </button>
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

        <div className="nav-group">
          <div className="nav-label">Workspace</div>
          <NavLink to="/runs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="clock" />Runs & automations{unread ? <span className="status-dot" /> : null}</NavLink>
          <NavLink to="/wiki" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="review" />Team wiki</NavLink>
          <NavLink to="/agents" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="spark" />Agents<span className="nav-count">{data.agentSessions.filter((s) => s.status === 'running').length}</span></NavLink>
          <NavLink to="/workflows" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="activity" />Workflows</NavLink>
          <NavLink to="/harness" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="tools" />Harness</NavLink>
          <NavLink to="/files" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="file" />Files</NavLink>
          <NavLink to="/permissions" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="shield" />Permissions</NavLink>
          <NavLink to="/environments" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="vm" />Environments<span className="nav-count">{data.environments.filter((e) => e.status === 'Running').length}</span></NavLink>
          <NavLink to="/plugins" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="plugin" />Plugin store</NavLink>
          <NavLink to="/usage" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="chart" />Usage & budgets</NavLink>
          <NavLink to="/admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="users" />Organization</NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="settings" />Settings</NavLink>
        </div>

        <div className="nav-group">
          <div className="nav-label">Projects <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={onCreateProject} title="Create project"><Icon name="plus" className="icon sm" /></button></div>
          <div className="tree">{renderBranch(null, 0)}</div>
        </div>

        <div className="nav-group">
          <div className="nav-label">Recent</div>
          {data.recentChatIds.map((id) => {
            const chat = data.chats.find((c) => c.id === id)
            if (!chat || chat.archived) return null
            return (
              <button key={id} className="nav-item recent" onClick={() => { setActiveChat(id); setActiveProject(chat.projectId); nav(`/chat/${id}`) }}>
                <Icon name="message" className="icon sm" />
                <span className="recent-title">{chat.title}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="sidebar-footer" style={{ position: 'relative' }}>
        <button className="profile-button" onClick={() => setProfileOpen((v) => !v)}>
          <span className="avatar">AD</span>
          <span className="profile-copy"><span className="profile-name">{data.settings.displayName}</span><span className="profile-plan">Enterprise · Full access</span></span>
          <Icon name="settings" className="icon sm" />
        </button>
        {profileOpen && (
          <div className="menu-dropdown" style={{ left: 8, right: 8, bottom: 56 }}>
            <button className="menu-item" onClick={() => { setProfileOpen(false); nav('/settings') }}>Profile & preferences</button>
            <button className="menu-item" onClick={() => { setProfileOpen(false); nav('/admin') }}>Organization admin</button>
          </div>
        )}
      </div>
      <div className="sidebar-resizer" id="sidebarResizer" title="Drag to resize" />
    </aside>
  )
}
