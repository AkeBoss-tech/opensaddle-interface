import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../data/store'
import { entityResolver, type EntityDisplay } from '../services/entityResolver'
import type { EntityKind } from '../types'

export interface EntityRefProps {
  kind: EntityKind
  id: string
  variant?: 'inline' | 'block'
  hint?: { label: string; avatarUrl?: string; state?: EntityDisplay['state'] }
  onActivate?: (kind: EntityKind, id: string) => void
}

const GLYPHS: Record<EntityKind, string> = { user: '@', agent: '✦', artifact: '↗', thread: '#', run: '◌', skill: '/', project: '□' }

export function EntityRef({ kind, id, variant = 'inline', hint, onActivate }: EntityRefProps) {
  const { data } = useStore()
  const hinted = useMemo(() => hint ? { ...hint, kind, id } : undefined, [hint, id, kind])
  const [entity, setEntity] = useState<EntityDisplay | undefined>(() => hinted ?? entityResolver.resolveLocal(data, kind, id))
  const [preview, setPreview] = useState(false)
  useEffect(() => {
    setEntity(hinted ?? entityResolver.resolveLocal(data, kind, id))
  }, [data, hinted, id, kind])
  useEffect(() => {
    if (!preview) return
    void entityResolver.resolve(data, kind, id).then((result) => setEntity(result ?? hinted))
  }, [data, hinted, id, kind, preview])
  const label = entity?.label ?? hint?.label ?? id
  const unresolved = !entity && !hint
  return <span className={`os-entity-ref os-entity-ref--${variant} os-entity-ref--${kind} ${unresolved ? 'is-unresolved' : ''}`}>
    <button type="button" aria-label={`${kind}: ${label}`} title={unresolved ? `Unavailable ${kind}: ${id}` : undefined} onFocus={() => setPreview(true)} onBlur={() => setPreview(false)} onMouseEnter={() => setPreview(true)} onMouseLeave={() => setPreview(false)} onClick={() => onActivate?.(kind, id)}>
      <span aria-hidden="true">{GLYPHS[kind]}</span>{label}
    </button>
    {preview && <span className="os-entity-preview" role="tooltip"><strong>{label}</strong><small>{entity?.description ?? (unresolved ? `Unavailable ${kind} · ${id}` : kind)}</small></span>}
  </span>
}
