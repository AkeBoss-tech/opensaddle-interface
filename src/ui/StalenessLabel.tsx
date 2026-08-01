import { formatRelativeTime } from './substrateFormatting'

export interface StalenessLabelProps {
  fetchedAt: number
  degraded?: boolean
}

export function StalenessLabel({ fetchedAt, degraded = false }: StalenessLabelProps) {
  return (
    <span className={`os-staleness-label${degraded ? ' is-degraded' : ''}`}>
      <span>{formatRelativeTime(fetchedAt)}</span>
      {degraded && <span>Provider unreachable · cached data</span>}
    </span>
  )
}
