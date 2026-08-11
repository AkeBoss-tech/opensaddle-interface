import type { ActionabilityState } from '../types'

export type StateBadgeTone = 'danger' | 'accent' | 'warning' | 'info' | 'success'

export const STATE_BADGE_TONE: Record<ActionabilityState, StateBadgeTone> = {
  blocked: 'danger',
  actionable: 'accent',
  claimed: 'warning',
  'in-progress': 'info',
  done: 'success',
}

export function formatRelativeTime(fetchedAt: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - fetchedAt)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'as of just now'
  if (minutes < 60) return `as of ${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `as of ${hours}h ago`

  return `as of ${Math.floor(hours / 24)}d ago`
}
