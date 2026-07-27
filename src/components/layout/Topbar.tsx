import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../../data/store'
import { Icon } from '../common/Icon'

export function Topbar({ crumbs, sidebarCollapsed, onToggleSidebar, onBack, onForward, onPalette, onBrowser }: { crumbs: React.ReactNode; sidebarCollapsed: boolean; onToggleSidebar: () => void; onBack: () => void; onForward: () => void; onPalette: () => void; onBrowser: () => void }) {
  const { data, setTheme, markNotificationsRead, toast, runtimeModeLabel, services, persistenceStatus } = useStore()
  const [notifOpen, setNotifOpen] = useState(false)
  const nav = useNavigate()
  const unread = data.notifications.filter((n) => !n.read).length
  const connectionLabel = services?.controlPlane.connected
    ? services.controlPlane.mode === 'company' ? 'Cloud' : 'Local'
    : window.opensaddleDesktop ? 'Starting…' : 'Offline'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onPalette() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPalette])

  const cycleTheme = () => {
    const order = ['dark', 'light', 'hc'] as const
    const next = order[(order.indexOf(data.settings.theme) + 1) % order.length]
    setTheme(next)
    toast('Theme changed', next === 'dark' ? 'Dark' : next === 'light' ? 'Light' : 'High contrast')
  }

  return (
    <header className="topbar" style={{ position: 'relative' }}>
      <div className="topbar-nav">
        {sidebarCollapsed && <button className="icon-btn sidebar-toggle" title="Show sidebar" onClick={onToggleSidebar}><Icon name="panel" /></button>}
        <button className="icon-btn page-nav" title="Back" onClick={onBack}><Icon name="back" /></button>
        <button className="icon-btn page-nav" title="Forward" onClick={onForward}><Icon name="forward" /></button>
      </div>
      <button className="icon-btn mobile-menu" onClick={() => document.getElementById('sidebar')?.classList.toggle('mobile-open')}><Icon name="menu" /></button>
      <div className="crumbs">{crumbs}</div>
      <div className="topbar-actions">
        <Link
          to="/settings"
          className="crumb-pill system-pill"
          title={services?.controlPlane.connected
            ? `${services.controlPlane.mode === 'company' ? 'Company' : 'Local'} control plane · ${services.controlPlane.modelProvider} · ${services.controlPlane.storage ?? 'server'}`
            : `${runtimeModeLabel} · offline cache`}
        >
          <span className={`pulse ${services?.controlPlane.connected ? '' : 'offline'}`} />
          {connectionLabel}
          {persistenceStatus === 'error' && <span className="system-pill-sync">Save error</span>}
        </Link>
        {window.opensaddleDesktop && <button className="icon-btn" title="Open split browser" onClick={onBrowser}><Icon name="globe" /></button>}
        <button className="icon-btn" title="Toggle theme" onClick={cycleTheme}><Icon name="sun" /></button>
        <button className="icon-btn" title="Notifications" onClick={() => { setNotifOpen((v) => !v); if (!notifOpen) markNotificationsRead() }} style={{ position: 'relative' }}>
          <Icon name="bell" />
          {unread > 0 && <span style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: 'var(--orange)' }} />}
        </button>
      </div>
      {notifOpen && (
        <div className="notif-panel">
          <div className="inspector-header" style={{ padding: '10px 12px' }}><strong>Notifications</strong><button className="icon-btn" onClick={() => setNotifOpen(false)}><Icon name="x" className="icon sm" /></button></div>
          {data.notifications.map((n) => (
            <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`} onClick={() => { setNotifOpen(false); if (n.href) nav(n.href) }}>
              <strong style={{ display: 'block', fontSize: 11 }}>{n.title}</strong>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{n.body}</span>
            </div>
          ))}
        </div>
      )}
    </header>
  )
}

export function DemoBanner() {
  const { data, updateSettings, toast, runtimeModeLabel, services } = useStore()
  if (!data.settings.demoMode) return null
  return (
    <div className="demo-banner">
      <Icon name="saddle" className="icon sm" />
      <span>
        {services?.controlPlane.connected
          ? `Codex connected · ${services.controlPlane.mode === 'company' ? 'company' : 'local'} control plane · ${services.controlPlane.modelProvider === 'unconfigured' ? 'configure a model in Settings' : services.controlPlane.modelProvider} · ${services.controlPlane.storage === 'sqlite' ? 'SQLite persistence' : 'server storage'}`
          : `${runtimeModeLabel} · Codex offline cache · start the control plane for durable chats`}
      </span>
      <button className="tiny-btn" onClick={() => { updateSettings({ demoMode: false }); toast('Demo banner hidden', 'Re-enable from Settings.') }}>Dismiss</button>
    </div>
  )
}
