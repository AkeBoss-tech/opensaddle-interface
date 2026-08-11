import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useModalFocus } from '../../ui/modalFocus'
import { Icon } from './Icon'

export type PaletteItem = {
  id: string
  group: string
  label: string
  description?: string
  keywords?: string[]
  icon: string
  tone?: 'default' | 'danger'
  run: () => void
}

export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const paletteRef = useRef<HTMLDivElement>(null)
  const normalizedQuery = q.trim().toLowerCase()
  const filtered = useMemo(() => items.filter((item) => {
    if (!normalizedQuery) return true
    return [item.label, item.group, item.description, ...(item.keywords ?? [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery))
  }), [items, normalizedQuery])
  useModalFocus(open, paletteRef, onClose)

  useEffect(() => {
    if (open) { setQ(''); setIdx(0) }
  }, [open])

  useEffect(() => {
    if (idx >= filtered.length) setIdx(Math.max(0, filtered.length - 1))
  }, [filtered.length, idx])

  const execute = (item: PaletteItem) => {
    item.run()
    onClose()
  }

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIdx((current) => filtered.length ? (current + 1) % filtered.length : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIdx((current) => filtered.length ? (current - 1 + filtered.length) % filtered.length : 0)
    } else if (event.key === 'Enter' && filtered[idx]) {
      event.preventDefault()
      execute(filtered[idx])
    }
  }

  if (!open) return null
  const groups = [...new Set(filtered.map((f) => f.group))]

  return (
    <div className="palette-backdrop open" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={paletteRef} className="palette" role="dialog" aria-modal="true" aria-labelledby="palette-title" aria-describedby="palette-description" tabIndex={-1}>
        <h2 id="palette-title" className="os-sr-only">Search OpenSaddle</h2>
        <p id="palette-description" className="os-sr-only">Search pages and actions. Use the arrow keys to choose a result.</p>
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            role="combobox"
            aria-autocomplete="list"
            aria-controls="palette-results"
            aria-expanded="true"
            aria-activedescendant={filtered[idx] ? `palette-item-${filtered[idx].id}` : undefined}
            value={q}
            onChange={(event) => { setQ(event.target.value); setIdx(0) }}
            onKeyDown={onInputKeyDown}
            placeholder="Search pages, projects, actions…"
          />
          <kbd>esc</kbd>
        </div>
        <div id="palette-results" className="palette-results" role="listbox" aria-label="Search results">
          {!normalizedQuery && <div className="palette-suggestion"><Icon name="spark" className="icon xs" /><span>Suggested destinations and safe actions</span></div>}
          {groups.map((g) => (
            <div key={g} role="group" aria-label={g}>
              <div className="palette-group" aria-hidden="true">{g}</div>
              {filtered.filter((f) => f.group === g).map((item) => {
                const globalIdx = filtered.indexOf(item)
                return (
                  <button
                    id={`palette-item-${item.id}`}
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={globalIdx === idx}
                    className={`palette-item ${globalIdx === idx ? 'active' : ''} ${item.tone === 'danger' ? 'danger' : ''}`}
                    onClick={() => execute(item)}
                    onMouseMove={() => setIdx(globalIdx)}
                  >
                    <Icon name={item.icon} className="icon sm" />
                    <span className="palette-item-copy"><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>
                    <span className="pi-hint">↵</span>
                  </button>
                )
              })}
            </div>
          ))}
          {!filtered.length && <div className="palette-empty" role="status"><Icon name="search" /><strong>No matches</strong><span>Try a page name, project area, or action.</span></div>}
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
    { id: 'chat', group: 'Create', label: 'New chat', description: 'Start a scoped conversation', keywords: ['thread', 'message'], icon: 'plus', run: actions.newChat },
    { id: 'proj', group: 'Create', label: 'Create project', description: 'Add a local folder or cloud workspace', keywords: ['workspace', 'folder'], icon: 'folder', run: actions.createProject },
    { id: 'runs', group: 'Navigate', label: 'Runs & automations', description: 'Review work and approvals', keywords: ['workflows'], icon: 'clock', run: () => nav('/runs') },
    { id: 'env', group: 'Navigate', label: 'Environments', description: 'Inspect runtimes and execution readiness', keywords: ['runtime', 'harness'], icon: 'vm', run: () => nav('/environments') },
    { id: 'plugins', group: 'Navigate', label: 'Plugin store', description: 'Manage connected capabilities', icon: 'plugin', run: () => nav('/plugins') },
    { id: 'usage', group: 'Navigate', label: 'Usage & budgets', description: 'Monitor spend and limits', icon: 'chart', run: () => nav('/usage') },
    { id: 'settings', group: 'Navigate', label: 'Settings', description: 'Configure OpenSaddle', icon: 'settings', run: () => nav('/settings') },
    { id: 'admin', group: 'Navigate', label: 'Organization admin', description: 'Manage enterprise policy', icon: 'users', run: () => nav('/admin') },
    { id: 'theme', group: 'Preferences', label: 'Toggle theme', description: 'Switch the current appearance', icon: 'sun', run: actions.toggleTheme },
    { id: 'reset', group: 'Danger zone', label: 'Reset demo data', description: 'Remove local demonstration state', keywords: ['clear'], icon: 'refresh', tone: 'danger', run: actions.reset },
  ], [actions, nav])
}
