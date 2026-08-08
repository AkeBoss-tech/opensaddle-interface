import { resourceRefKey } from './authority'
import type {
  EvidenceFreshness,
  EvidencePresentation,
  PresentationCitation,
  ResourceRef,
} from './contracts'
import { serializeResourceVersion } from './version'

export type EvidenceSourceRole = 'direct' | 'derived'

export function sourceRole(presentation: EvidencePresentation, source: ResourceRef): EvidenceSourceRole {
  const sourceKey = resourceRefKey(source)
  return presentation.lineage.some((edge) => resourceRefKey(edge.to) === sourceKey)
    ? 'derived'
    : 'direct'
}

export function sourceVersionLabel(source: ResourceRef): string {
  return serializeResourceVersion(source.version)
}

export function freshnessLabel(freshness: EvidenceFreshness): string {
  if (freshness.status === 'stale') return 'Stale snapshot'
  if (freshness.status === 'fresh') return 'Fresh snapshot'
  return 'Freshness unknown'
}

export function evidenceCitationStatus(
  presentation: EvidencePresentation,
  citation: PresentationCitation,
): string {
  if (citation.visibility === 'redacted') return 'Restricted by policy'
  const role = sourceRole(presentation, citation.source) === 'derived' ? 'Derived' : 'Direct'
  const cache = citation.freshness.observedAt === undefined ? 'uncached' : 'cached snapshot'
  return `${role} · ${cache} · ${freshnessLabel(citation.freshness)}`
}

export type EvidenceNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

export function nextEvidenceCitationIndex(
  current: number,
  key: EvidenceNavigationKey,
  count: number,
): number {
  if (count <= 0) return -1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown') return (current + 1 + count) % count
  return (current - 1 + count) % count
}
