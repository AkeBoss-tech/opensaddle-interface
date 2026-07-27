const MAX_TRANSCRIPT_CHARS = 200_000

/**
 * Merge provider output into one durable transcript.
 *
 * Providers vary between token deltas, line deltas, cumulative snapshots, and
 * repeated final messages. This keeps valid whitespace while removing the
 * overlap those formats produce when mixed with snapshot reconciliation.
 */
export function appendTranscript(current: string, incoming: string): string {
  if (!incoming) return current
  if (!current) return incoming.slice(-MAX_TRANSCRIPT_CHARS)
  if (current.endsWith(incoming)) return current
  if (incoming.startsWith(current)) return incoming.slice(-MAX_TRANSCRIPT_CHARS)

  const maxOverlap = Math.min(current.length, incoming.length)
  let overlap = 0
  for (let size = maxOverlap; size > 0; size--) {
    if (current.endsWith(incoming.slice(0, size))) {
      overlap = size
      break
    }
  }

  return `${current}${incoming.slice(overlap)}`.slice(-MAX_TRANSCRIPT_CHARS)
}

export function eventText(payload: Record<string, unknown>): string {
  for (const key of ['text', 'delta', 'content', 'output'] as const) {
    const value = payload[key]
    if (typeof value === 'string') return value
  }
  return ''
}
