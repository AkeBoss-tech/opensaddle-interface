import type { EntityReference } from '../types'
import { EntityRef } from './EntityRef'

type MessageTextSegment =
  | { type: 'text'; value: string }
  | { type: 'reference'; reference: EntityReference }

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Splits prose into text and inline entity references without parsing HTML. */
export function getMessageTextSegments(text: string, references: EntityReference[] = []): MessageTextSegment[] {
  const referencesByLabel = new Map<string, EntityReference[]>()
  for (const reference of references) {
    if (reference.label) referencesByLabel.set(reference.label, [...(referencesByLabel.get(reference.label) ?? []), reference])
  }
  const labels = [...referencesByLabel.keys()].sort((left, right) => right.length - left.length)
  if (!labels.length) return [{ type: 'text', value: text }]

  const matcher = new RegExp(labels.map(escapeRegExp).join('|'), 'g')
  const segments: MessageTextSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(matcher)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push({ type: 'text', value: text.slice(cursor, index) })
    for (const reference of referencesByLabel.get(match[0]) ?? []) segments.push({ type: 'reference', reference })
    cursor = index + match[0].length
  }
  if (cursor < text.length || !segments.length) segments.push({ type: 'text', value: text.slice(cursor) })

  const matchedLabels = new Set(segments.filter((segment) => segment.type === 'reference').map((segment) => segment.reference.label))
  for (const reference of references) {
    if (!matchedLabels.has(reference.label)) segments.push({ type: 'reference', reference })
  }
  return segments
}

export function MessageText({ text, references, onActivate }: { text: string; references?: EntityReference[]; onActivate?: (reference: EntityReference) => void }) {
  return <p className="os-message-text">{getMessageTextSegments(text, references).map((segment, index) => segment.type === 'text'
    ? <span key={`text-${index}`}>{segment.value}</span>
    : <EntityRef key={`reference-${index}-${segment.reference.kind}:${segment.reference.id}`} {...segment.reference} variant="inline" onActivate={() => onActivate?.(segment.reference)} />
  )}</p>
}
