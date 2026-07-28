import type { SessionEvent } from './contracts'

/**
 * Snapshot polling and SSE intentionally run together. Buffer by sequence so
 * whichever transport wins the race cannot cause earlier durable events to be
 * discarded.
 */
export function createOrderedEventEmitter(onEvent: (event: SessionEvent) => void) {
  const pending = new Map<number, SessionEvent>()
  const seenIds = new Set<string>()
  // The authoritative OpenSaddle run store numbers durable events from 1.
  // Mock/runtime-local streams do not pass through this reconciler.
  let nextSequence = 1

  return (event: SessionEvent) => {
    if (seenIds.has(event.event_id) || event.sequence < nextSequence) return
    seenIds.add(event.event_id)
    pending.set(event.sequence, event)

    while (pending.has(nextSequence)) {
      const next = pending.get(nextSequence)!
      pending.delete(nextSequence)
      onEvent(next)
      nextSequence += 1
    }
  }
}
