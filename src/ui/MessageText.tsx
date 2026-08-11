import type { EntityReference } from '../types'
import { EntityRef } from './EntityRef'
import { getMessageTextSegments } from './messageSegments'

export function MessageText({ text, references, onActivate }: { text: string; references?: EntityReference[]; onActivate?: (reference: EntityReference) => void }) {
  return <p className="os-message-text">{getMessageTextSegments(text, references).map((segment, index) => segment.type === 'text'
    ? <span key={`text-${index}`}>{segment.value}</span>
    : <EntityRef key={`reference-${index}-${segment.reference.kind}:${segment.reference.id}`} {...segment.reference} variant="inline" onActivate={() => onActivate?.(segment.reference)} />
  )}</p>
}
