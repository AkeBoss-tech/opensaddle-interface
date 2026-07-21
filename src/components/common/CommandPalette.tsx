import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'

export type PaletteItem = { id: string; group: string; label: string; icon: string; run: () => void }

export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const filtered = useMemo(() => items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())), [items, q])

  useEffect(() => {
    if (open) { setQ(''); setIdx(0) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter' && filtered[idx]) { filtered[idx].run(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, idx, onClose])

  if (!open) return null
  const groups = [...new Set(filtered.map((f) => f.group))]

  return (
    <div className="palette-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="search" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIdx(0) }} placeholder="Search pages, projects, actions…" />
        </div>
        <div className="palette-results">
          {groups.map((g) => (
            <div key={g}>
              <div className="palette-group">{g}</div>
              {filtered.filter((f) => f.group === g).map((item) => {
                const globalIdx = filtered.indexOf(item)
                return (
                  <div key={item.id} className={`palette-item ${globalIdx === idx ? 'active' : ''}`} onClick={() => { item.run(); onClose() }} onMouseEnter={() => setIdx(globalIdx)}>
                    <Icon name={item.icon} className="icon sm" />
                    <span>{item.label}</span>
                    <span className="pi-hint">↵</span>
                  </div>
                )
              })}
            </div>
          ))}
          {!filtered.length && <div className="palette-group">No matches</div>}
        </div>
      </div>
    </div>
  )
}

export function usePaletteItems(actions: {
  go: (path: string) => void
  newChat: () => void
  createProject: () => void
  toggleTheme: () => void
  reset: () => void
}): PaletteItem[] {
  const nav = useNavigate()
  return useMemo(() => [
    { id: 'chat', group: 'Go to', label: 'New chat', icon: 'plus', run: actions.newChat },
    { id: 'runs', group: 'Go to', label: 'Runs & automations', icon: 'clock', run: () => nav('/runs') },
    { id: 'env', group: 'Go to', label: 'Environments', icon: 'vm', run: () => nav('/environments') },
    { id: 'plugins', group: 'Go to', label: 'Plugin store', icon: 'plugin', run: () => nav('/plugins') },
    { id: 'usage', group: 'Go to', label: 'Usage & budgets', icon: 'chart', run: () => nav('/usage') },
    { id: 'settings', group: 'Go to', label: 'Settings', icon: 'settings', run: () => nav('/settings') },
    { id: 'admin', group: 'Go to', label: 'Organization admin', icon: 'users', run: () => nav('/admin') },
    { id: 'proj', group: 'Actions', label: 'Create project', icon: 'folder', run: actions.createProject },
    { id: 'theme', group: 'Actions', label: 'Toggle theme', icon: 'sun', run: actions.toggleTheme },
    { id: 'reset', group: 'Actions', label: 'Reset demo data', icon: 'refresh', run: actions.reset },
  ], [actions, nav])
}
