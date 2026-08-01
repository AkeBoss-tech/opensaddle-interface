import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../data/store'
import { entityResolver } from '../services/entityResolver'
import type { EntityKind, EntityReference } from '../types'
import '../styles/entity.css'

export interface EntityPickerProps {
  kinds: EntityKind[]
  projectId?: string
  query: string
  onSelect: (ref: EntityReference) => void
  onDismiss?: () => void
}

export function EntityPicker({ kinds, projectId, query, onSelect, onDismiss }: EntityPickerProps) {
  const { data } = useStore()
  const results = useMemo(() => entityResolver.search(data, kinds, query, projectId), [data, kinds, projectId, query])
  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [query, results.length])
  const choose = (index: number) => { const item = results[index]; if (item) onSelect(item) }
  const handleKey = (event: KeyboardEvent | React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onDismiss?.() }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.min(value + 1, results.length - 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)) }
    if (event.key === 'Enter') { event.preventDefault(); choose(active) }
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKey(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })
  return <div className="os-entity-picker" role="listbox" aria-label="Entity suggestions" onKeyDown={handleKey} tabIndex={-1}>
    {results.length ? kinds.map((kind) => {
      const group = results.filter((item) => item.kind === kind)
      return group.length ? <section key={kind}><span>{kind}s</span>{group.map((item) => {
        const index = results.indexOf(item)
        return <button key={`${item.kind}:${item.id}`} type="button" role="option" aria-selected={active === index} className={active === index ? 'is-active' : ''} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}><b>{item.kind === 'agent' ? '✦' : item.kind === 'skill' ? '/' : '@'}</b><i><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</i></button>
      })}</section> : null
    }) : <p>No matching entities</p>}
  </div>
}
