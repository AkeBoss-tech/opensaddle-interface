import type { ArtifactRef } from '../types'
import { StateBadge } from './StateBadge'
import { StalenessLabel } from './StalenessLabel'

export interface ArtifactCardProps {
  artifact: ArtifactRef
  onActivate?: (artifact: ArtifactRef) => void
}

function providerGlyph(provider: string): string {
  return provider.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()
}

export function ArtifactCard({ artifact, onActivate }: ArtifactCardProps) {
  return (
    <button
      type="button"
      className="os-artifact-card"
      onClick={() => onActivate?.(artifact)}
      aria-label={`Open ${artifact.provider} ${artifact.kind}: ${artifact.title}`}
    >
      <span className="os-artifact-card__source" aria-hidden="true">{providerGlyph(artifact.provider)}</span>
      <span className="os-artifact-card__content">
        <span className="os-artifact-card__header">{artifact.provider} · {artifact.kind}</span>
        <strong title={artifact.title}>{artifact.title}</strong>
        <span className="os-artifact-card__footer">
          <StateBadge state={artifact.state} />
          <StalenessLabel fetchedAt={artifact.fetchedAt} degraded={artifact.degraded} />
        </span>
      </span>
    </button>
  )
}
