import { presentAuthority, resourceRefKey } from './authority'
import type {
  EvidencePolicy,
  EvidencePolicyEffect,
  EvidencePresentation,
  EvidencePacket,
  PolicyOmission,
  PresentationCitation,
  ResourceRef,
} from './contracts'

function effectFor(policy: EvidencePolicy, citationId: string, source: ResourceRef): EvidencePolicyEffect {
  return policy.citationEffects?.[citationId]
    ?? policy.resourceEffects?.[resourceRefKey(source)]
    ?? policy.defaultEffect
}

function safeOmission(reason: PolicyOmission['reason'], count: number, position: number): PolicyOmission {
  const message = reason === 'redacted'
    ? 'Evidence was redacted before presentation.'
    : reason === 'provider_denied'
      ? 'Evidence was omitted because its provider denied access.'
      : 'Evidence was omitted by policy.'
  return { id: `omission-${position}`, reason, count, message }
}

function mergeOmissions(omissions: readonly PolicyOmission[]): PolicyOmission[] {
  const counts = new Map<PolicyOmission['reason'], number>()
  for (const omission of omissions) counts.set(omission.reason, (counts.get(omission.reason) ?? 0) + omission.count)
  return [...counts.entries()].map(([reason, count], position) => safeOmission(reason, count, position + 1))
}

/**
 * Builds a presentation-safe projection. Restricted citations, their resource
 * identifiers, dependent lineage, and conflict text are never copied through.
 */
export function applyEvidencePolicy(packet: EvidencePacket, policy: EvidencePolicy): EvidencePresentation {
  const citations: PresentationCitation[] = []
  const hiddenCitationIds = new Set<string>()
  const hiddenResourceKeys = new Set<string>()
  const hiddenReasons = new Map<string, PolicyOmission['reason']>()
  const newOmissions: PolicyOmission[] = []
  const defaultReason: PolicyOmission['reason'] = policy.defaultEffect === 'redact'
    ? 'redacted'
    : (policy.denialReason ?? 'policy_denied')

  for (const citation of packet.citations) {
    const effect = effectFor(policy, citation.id, citation.source)
    if (effect === 'allow') {
      citations.push({ ...citation, visibility: 'visible', authority: presentAuthority(citation.source.authority) })
      continue
    }

    hiddenCitationIds.add(citation.id)
    const sourceKey = resourceRefKey(citation.source)
    hiddenResourceKeys.add(sourceKey)
    const reason = effect === 'redact' ? 'redacted' : (policy.denialReason ?? 'policy_denied')
    hiddenReasons.set(sourceKey, reason)
    newOmissions.push(safeOmission(reason, 1, newOmissions.length + 1))
    if (effect === 'redact') {
      citations.push({
        id: `redacted-${citations.length + 1}`,
        visibility: 'redacted',
        title: 'Restricted evidence',
        authority: {
          label: 'Restricted',
          badge: { label: 'Restricted', tone: 'warning' },
          description: 'Evidence details are unavailable under the active policy',
        },
      })
    }
  }

  const conflicts = packet.conflicts.filter((conflict) => {
    if (!conflict.citationIds.length && policy.defaultEffect !== 'allow') {
      newOmissions.push(safeOmission(defaultReason, 1, newOmissions.length + 1))
      return false
    }
    const hiddenId = conflict.citationIds.find((id) => hiddenCitationIds.has(id))
    if (!hiddenId) return true
    const citation = packet.citations.find((candidate) => candidate.id === hiddenId)
    const reason = citation
      ? hiddenReasons.get(resourceRefKey(citation.source)) ?? 'redacted'
      : 'redacted'
    newOmissions.push(safeOmission(reason, 1, newOmissions.length + 1))
    return false
  })
  const gaps = packet.gaps.filter((gap) => {
    if (!gap.source) {
      if (policy.defaultEffect === 'allow') return true
      newOmissions.push(safeOmission(defaultReason, 1, newOmissions.length + 1))
      return false
    }
    const key = resourceRefKey(gap.source)
    if (!hiddenResourceKeys.has(key)) return true
    newOmissions.push(safeOmission(hiddenReasons.get(key) ?? 'redacted', 1, newOmissions.length + 1))
    return false
  })
  const lineage = packet.lineage.filter((edge) => {
    const fromKey = resourceRefKey(edge.from)
    const toKey = resourceRefKey(edge.to)
    const hiddenKey = hiddenResourceKeys.has(fromKey) ? fromKey : hiddenResourceKeys.has(toKey) ? toKey : undefined
    if (!hiddenKey) return true
    newOmissions.push(safeOmission(hiddenReasons.get(hiddenKey) ?? 'redacted', 1, newOmissions.length + 1))
    return false
  })
  const errors = packet.errors.filter((error) => {
    if (!error.resource) {
      if (policy.defaultEffect === 'allow') return true
      newOmissions.push(safeOmission(defaultReason, 1, newOmissions.length + 1))
      return false
    }
    const key = resourceRefKey(error.resource)
    if (!hiddenResourceKeys.has(key)) return true
    newOmissions.push(safeOmission(hiddenReasons.get(key) ?? 'redacted', 1, newOmissions.length + 1))
    return false
  })

  return {
    schemaVersion: packet.schemaVersion,
    id: packet.id,
    generatedAt: packet.generatedAt,
    citations,
    conflicts,
    gaps,
    lineage,
    omissions: mergeOmissions([...packet.policyOmissions, ...newOmissions]),
    errors,
  }
}
