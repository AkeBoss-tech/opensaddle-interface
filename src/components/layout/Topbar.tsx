import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../../data/store'
import { connectionPresentation } from '../../lib/connectionPresentation'
import { Icon } from '../common/Icon'

export function Topbar({ crumbs, sidebarCollapsed, onToggleSidebar, onBack, onForward, onPalette, onBrowser }: { crumbs: React.ReactNode; sidebarCollapsed: boolean; onToggleSidebar: () => void; onBack: () => void; onForward: () => void; onPalette: () => void; onBrowser?: () => void }) {
  const { connection, data, setTheme, markNotificationsRead, toast, services, persistenceStatus } = useStore()
  const [notifOpen, setNotifOpen] = useState(false)
  const nav = useNavigate()
  const location = useLocation()
  const globalContext = location.pathname === '/start'
  const activeProject = data.projects.find((project) => project.id === data.activeProjectId)
  const organizationRoots = data.projects.filter((project) => project.parentId === null && project.workspaceKind !== 'local')
  const teamCandidates = organizationRoots.length === 1
    ? [organizationRoots[0]!, ...data.projects.filter((project) => project.parentId === organizationRoots[0]!.id && project.workspaceKind !== 'local')]
    : organizationRoots
  const localTeams = data.projects.filter((project) => project.parentId === null && project.workspaceKind === 'local')
  const teamIds = new Set([...teamCandidates, ...localTeams].map((team) => team.id))
  let activeTeam = activeProject
  while (activeTeam?.parentId && !teamIds.has(activeTeam.id)) {
    activeTeam = data.projects.find((project) => project.id === activeTeam?.parentId)
  }
  const activeScopeIds = new Set<string>()
  if (activeTeam) {
    activeScopeIds.add(activeTeam.id)
    let changed = true
    while (changed) {
      changed = false
      data.projects.forEach((project) => {
        if (project.parentId && activeScopeIds.has(project.parentId) && !activeScopeIds.has(project.id)) {
          activeScopeIds.add(project.id)
          changed = true
        }
      })
    }
  }
  const notificationProject = (notification: typeof data.notifications[number]) => {
    const chatId = notification.href?.match(/^\/chat\/(.+)$/)?.[1]
    const chatProjectId = chatId ? data.chats.find((chat) => chat.id === chatId)?.projectId : undefined
    if (chatProjectId) return data.projects.find((project) => project.id === chatProjectId)
    const copy = `${notification.title} ${notification.body}`.toLowerCase()
    return data.projects
      .filter((project) => copy.includes(project.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0]
  }
  const visibleNotifications = globalContext
    ? data.notifications
    : data.notifications.filter((notification) => {
      const project = notificationProject(notification)
      return !project || activeScopeIds.has(project.id)
    })
  const unread = visibleNotifications.filter((notification) => !notification.read).length
  const connectionState = connectionPresentation({
    connection,
    controlPlane: services?.controlPlane ?? null,
    desktop: Boolean(window.opensaddleDesktop),
  })
  const connectedLocal = Boolean(services?.controlPlane.connected && services.controlPlane.mode === 'local')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onPalette() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPalette])

  const cycleTheme = () => {
    const order = ['dark', 'light', 'liquid', 'hc'] as const
    const next = order[(order.indexOf(data.settings.theme) + 1) % order.length]
    setTheme(next)
    toast('Theme changed', next === 'dark' ? 'Dark' : next === 'light' ? 'Light' : next === 'liquid' ? 'Liquid Glass' : 'High contrast')
  }

  return (
    <header className="topbar" style={{ position: 'relative' }}>
      <div className="topbar-nav">
        {sidebarCollapsed && <button className="icon-btn sidebar-toggle" title="Show sidebar" onClick={onToggleSidebar}><Icon name="panel" /></button>}
        <button className="icon-btn page-nav" title="Back" onClick={onBack}><Icon name="back" /></button>
        <button className="icon-btn page-nav" title="Forward" onClick={onForward}><Icon name="forward" /></button>
      </div>
      <button className="icon-btn mobile-menu" aria-label="Open team navigation" onClick={() => document.getElementById('sidebar')?.classList.toggle('mobile-open')}><Icon name="menu" /></button>
      <div className="crumbs">{crumbs}</div>
      <div className="topbar-actions">
        <Link
          to="/settings"
          className="crumb-pill system-pill"
          title={connectionState.title}
        >
          <span className={`pulse ${connectionState.kind}`} />
          {connectionState.label}
          {persistenceStatus === 'error' && <span className="system-pill-sync">Save error</span>}
        </Link>
        {window.opensaddleDesktop && onBrowser && <button className="icon-btn" title="Open split browser" onClick={onBrowser}><Icon name="globe" /></button>}
        <button className="icon-btn" title={`Theme: ${data.settings.theme === 'liquid' ? 'Liquid Glass' : data.settings.theme}. Click to change.`} onClick={cycleTheme}><Icon name="sun" /></button>
        {!connectedLocal && <button className="icon-btn" title="Notifications" onClick={() => { setNotifOpen((v) => !v); if (!notifOpen) markNotificationsRead() }} style={{ position: 'relative' }}>
          <Icon name="bell" />
          {unread > 0 && <span style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: 'var(--orange)' }} />}
        </button>}
      </div>
      {notifOpen && (
        <div className="notif-panel">
          <div className="inspector-header" style={{ padding: '10px 12px' }}><div><strong>{globalContext ? 'Notifications' : `${activeTeam?.name ?? 'Team'} notifications`}</strong><small>{globalContext ? 'Across all teams' : 'Scoped to this team'}</small></div><button className="icon-btn" onClick={() => setNotifOpen(false)}><Icon name="x" className="icon sm" /></button></div>
          {visibleNotifications.map((n) => {
            const project = notificationProject(n)
            return (
            <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`} onClick={() => { setNotifOpen(false); if (n.href) nav(n.href) }}>
              {globalContext && <i className="notif-team-mark" style={{ background: project?.iconColor ?? 'var(--dim)' }} title={project?.name ?? 'Workspace'} />}
              <div><strong>{n.title}</strong><span>{n.body}</span>{globalContext && <small>{project?.name ?? 'Workspace'}</small>}</div>
            </div>
          )})}
          {!visibleNotifications.length && <div className="notif-empty">No notifications for this team.</div>}
        </div>
      )}
    </header>
  )
}

export function DemoBanner() {
  const { connection, data, updateSettings, toast, services } = useStore()
  if (!data.settings.demoMode) return null
  return (
    <div className="demo-banner">
      <Icon name="saddle" className="icon sm" />
      <span>
        {connection.mode === 'demo'
          ? 'Demo workspace · seeded sample data · simulated runs · no control-plane enforcement'
          : services?.controlPlane.connected
          ? `Connected · ${services.controlPlane.mode === 'company' ? 'company' : 'local'} control plane · ${services.controlPlane.modelProvider && services.controlPlane.modelProvider !== 'unconfigured' ? services.controlPlane.modelProvider : 'native harnesses'} · ${services.controlPlane.storage === 'sqlite' ? 'SQLite persistence' : 'server storage'}`
          : `Control plane unavailable · reconnect to ${connection.baseUrl} for durable chats and enforced permissions`}
      </span>
      <button className="tiny-btn" onClick={() => { updateSettings({ demoMode: false }); toast('Demo banner hidden', 'Re-enable from Settings.') }}>Dismiss</button>
    </div>
  )
}
