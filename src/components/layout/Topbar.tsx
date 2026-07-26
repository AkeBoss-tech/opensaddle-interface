import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../../data/store'
import { Icon } from '../common/Icon'

export function Topbar({ onPalette }: { onPalette: () => void }) {
  const { data, setTheme, markNotificationsRead, toast, runtimeModeLabel, services, runtimeStatus } = useStore()
  const [notifOpen, setNotifOpen] = useState(false)
  const nav = useNavigate()
  const unread = data.notifications.filter((n) => !n.read).length

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

  const offline = runtimeStatus.connection === 'offline-cache'
  const shortState = offline
    ? 'offline cache'
    : runtimeStatus.connection === 'syncing' ? 'syncing'
      : services?.controlPlane.modelProvider === 'unconfigured' ? 'no model'
        : services?.controlPlane.modelProvider ?? 'connected'
  const fullState = offline
    ? `${runtimeModeLabel} · offline cache fallback · reconnect to restore authoritative state`
    : `${runtimeModeLabel} · ${shortState} · ${services?.controlPlane.storage ?? 'server'} storage`
  const workerLabel = runtimeStatus.localWorker === 'available' ? 'local worker ready' : 'no local worker'

  return (
    <header className="topbar" style={{ position: 'relative' }}>
      <button className="icon-btn mobile-menu" onClick={() => document.getElementById('sidebar')?.classList.toggle('mobile-open')}><Icon name="menu" /></button>
      <Link to="/settings" className="crumb-pill system-pill" title={`${fullState} · ${workerLabel} — open system settings`}>
        <span className={`pulse ${offline ? 'offline' : ''}`} />
        Codex · {shortState}
        <span className={`system-pill-worker ${runtimeStatus.localWorker === 'available' ? 'ok' : ''}`} aria-label={workerLabel} />
      </Link>
      <div className="topbar-actions">
        <button className="icon-btn" title="Command palette" onClick={onPalette}><Icon name="command" /></button>
        <button className="icon-btn" title="Toggle theme" onClick={cycleTheme}><Icon name="sun" /></button>
        <button className="icon-btn" title="Notifications" onClick={() => { setNotifOpen((v) => !v); if (!notifOpen) markNotificationsRead() }} style={{ position: 'relative' }}>
          <Icon name="bell" />
          {unread > 0 && <span style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: 'var(--orange)' }} />}
        </button>
        <Link to="/settings" className="icon-btn" title="Settings"><Icon name="settings" /></Link>
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
  const { data, updateSettings, toast, runtimeModeLabel, services, runtimeStatus } = useStore()
  if (!data.settings.demoMode) return null
  return (
    <div className="demo-banner">
      <Icon name="saddle" className="icon sm" />
      <span>
        {runtimeStatus.connection !== 'offline-cache' && services?.controlPlane.connected
          ? `${services.controlPlane.mode === 'company' ? 'Company' : 'Local'} control plane connected${services.controlPlane.modelProvider === 'unconfigured' ? ' — configure a model in Settings' : ''}`
          : `${runtimeModeLabel} — running on offline cache, reconnect to restore authoritative state`}
      </span>
      <button className="tiny-btn" onClick={() => { updateSettings({ demoMode: false }); toast('Demo banner hidden', 'Re-enable from Settings.') }}>Dismiss</button>
    </div>
  )
}
