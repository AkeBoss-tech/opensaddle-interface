import { applyRunEvent } from '../../lib/runEvents'
import type { SessionEvent } from '../../services/contracts'
import type { AgentRunBlock } from '../../types'
import { appendTranscript, eventText } from './transcript'

export interface OperationSnapshot {
  run: AgentRunBlock
  previousRun?: AgentRunBlock
  text: string
  lastEvent?: SessionEvent
  eventCount: number
}

interface AttachOperationInput {
  runId: string
  initialRun: AgentRunBlock
  initialText?: string
  subscribe: (runId: string, onEvent: (event: SessionEvent) => void, onError?: (error: Error) => void) => () => void
  onUpdate: (snapshot: OperationSnapshot) => void
  onTerminal?: (snapshot: OperationSnapshot) => void
  onUnavailable?: (error: Error, snapshot: OperationSnapshot) => void
}

/**
 * Owns live operation attachment and the authoritative event receipt for each
 * run. State is keyed by run id so concurrent output and replay cursors cannot
 * bleed between tasks.
 */
export class OperationController {
  private snapshots = new Map<string, OperationSnapshot>()
  private subscriptions = new Map<string, () => void>()

  has(runId: string): boolean {
    return this.subscriptions.has(runId)
  }

  get(runId: string): OperationSnapshot | undefined {
    return this.snapshots.get(runId)
  }

  attach(input: AttachOperationInput): boolean {
    if (this.subscriptions.has(input.runId)) return false
    const prior = this.snapshots.get(input.runId)
    this.snapshots.set(input.runId, prior ?? {
      run: input.initialRun,
      text: input.initialText ?? '',
      eventCount: 0,
    })

    let closedBeforeAttach = false
    const unsubscribe = input.subscribe(input.runId, (event) => {
      const current = this.snapshots.get(input.runId) ?? {
        run: input.initialRun,
        text: input.initialText ?? '',
        eventCount: 0,
      }
      if (event.sequence <= (current.run.lastSequence ?? -1)) return

      const delta = event.type === 'agent.output.delta' ? eventText(event.payload) : ''
      const text = delta ? appendTranscript(current.text, delta) : current.text
      const snapshot: OperationSnapshot = {
        run: applyRunEvent(current.run, event),
        previousRun: current.run,
        text,
        lastEvent: event,
        eventCount: current.eventCount + 1,
      }
      this.snapshots.set(input.runId, snapshot)
      input.onUpdate(snapshot)

      // Only canonical terminal receipts release ownership. agent.completed
      // and agent.failed may be followed by final output, usage, or evidence.
      if (event.type === 'session.closed' || event.type === 'agent.cancelled') {
        input.onTerminal?.(snapshot)
        if (this.subscriptions.has(input.runId)) this.release(input.runId)
        else closedBeforeAttach = true
      }
    }, (error) => {
      const snapshot = this.snapshots.get(input.runId)
      if (snapshot) input.onUnavailable?.(error, snapshot)
      if (this.subscriptions.has(input.runId)) this.release(input.runId)
      else closedBeforeAttach = true
    })
    if (closedBeforeAttach) unsubscribe()
    else this.subscriptions.set(input.runId, unsubscribe)
    return true
  }

  replaceRun(runId: string, run: AgentRunBlock): OperationSnapshot | undefined {
    const current = this.snapshots.get(runId)
    if (!current) return undefined
    const next = { ...current, run }
    this.snapshots.set(runId, next)
    return next
  }

  release(runId: string): void {
    this.subscriptions.get(runId)?.()
    this.subscriptions.delete(runId)
  }

  dispose(): void {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe()
    this.subscriptions.clear()
  }
}
