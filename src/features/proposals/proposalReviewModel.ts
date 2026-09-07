import type { KrailProposalApproval } from '../../services/contracts'

/** A replayed approval can be durable yet expired, so never treat its 2xx response as current authority. */
export function isApprovalCurrent(approval: KrailProposalApproval, now = Date.now()) {
  const expiry = new Date(approval.expiresAt).getTime()
  return Number.isFinite(expiry) && expiry > now
}

/** Bound display of server-declared effect parameters without rendering an unbounded JSON blob. */
export function effectBoundsSummary(bounds: Record<string, unknown>) {
  return Object.entries(bounds).slice(0, 8).map(([key, value]) => {
    const text = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : Array.isArray(value) ? `${value.length} item${value.length === 1 ? '' : 's'}` : value === null ? 'none' : 'structured value'
    return `${key}: ${text.length > 160 ? `${text.slice(0, 157)}…` : text}`
  }).join(' · ') || 'No bounds declared'
}

export function fullEffectBounds(bounds: Record<string, unknown>) {
  try {
    const text = JSON.stringify(bounds, null, 2)
    return text.length <= 16_384 ? { reviewable: true as const, text } : { reviewable: false as const, text: '' }
  } catch { return { reviewable: false as const, text: '' } }
}

/** Microunits are exact integer transport units; retain them alongside base currency. */
export function formatMicrounits(amount: number, currency: string) {
  return `${(amount / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${currency} (${amount.toLocaleString()} microunits)`
}
