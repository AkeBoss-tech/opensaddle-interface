import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../data/store'
import { applyRunEvent } from '../../lib/runEvents'
import type { SessionEvent } from '../../services/contracts'
import type { AgentRunBlock } from '../../types'
import { appendTranscript, eventText } from './transcript'

export interface ManagedRun {
  runId: string
  threadId: string
  messageId: string
  parentRunId?: string
  run: AgentRunBlock
  lastEvent?: SessionEvent
  eventCount: number
}

interface TrackRunInput {
  runId: string
  threadId: string
  messageId: string
  initialRun: AgentRunBlock
  initialText?: string
  parentRunId?: string
}

interface RunRegistryApi {
  runs: Record<string, ManagedRun>
  track: (input: TrackRunInput) => void
  stop: (runId: string) => Promise<void>
  getForThread: (threadId: string) => ManagedRun[]
}

const RunRegistryContext = createContext<RunRegistryApi | null>(null)

export function RunRegistryProvider({ children }: { children: ReactNode }) {
  const { data, services, updateMessage } = useStore()
  const [runs, setRuns] = useState<Record<string, ManagedRun>>({})
  const subscriptions = useRef(new Map<string, () => void>())
  const textByRun = useRef(new Map<string, string>())
  const runById = useRef(new Map<string, AgentRunBlock>())

  const release = useCallback((runId: string) => {
    subscriptions.current.get(runId)?.()
    subscriptions.current.delete(runId)
    textByRun.current.delete(runId)
  }, [])

  const track = useCallback((input: TrackRunInput) => {
    if (!services?.runtime || subscriptions.current.has(input.runId)) return

    runById.current.set(input.runId, input.initialRun)
    textByRun.current.set(input.runId, input.initialText ?? '')
    setRuns((current) => ({
      ...current,
      [input.runId]: {
        runId: input.runId,
        threadId: input.threadId,
        messageId: input.messageId,
        parentRunId: input.parentRunId ?? input.initialRun.parentRunId,
        run: input.initialRun,
        eventCount: current[input.runId]?.eventCount ?? 0,
      },
    }))

    const unsubscribe = services.runtime.subscribe(input.runId, (event) => {
      const previous = runById.current.get(input.runId) ?? input.initialRun
      if (event.sequence <= (previous.lastSequence ?? -1)) return

      const delta = event.type === 'agent.output.delta' ? eventText(event.payload) : ''
      const text = delta
        ? appendTranscript(textByRun.current.get(input.runId) ?? '', delta)
        : textByRun.current.get(input.runId) ?? ''
      if (delta) textByRun.current.set(input.runId, text)

      const next = applyRunEvent(previous, event)
      runById.current.set(input.runId, next)
      updateMessage(input.messageId, delta ? { text, run: next } : { run: next })
      setRuns((current) => ({
        ...current,
        [input.runId]: {
          runId: input.runId,
          threadId: input.threadId,
          messageId: input.messageId,
          parentRunId: input.parentRunId ?? next.parentRunId,
          run: next,
          lastEvent: event,
          eventCount: (current[input.runId]?.eventCount ?? 0) + 1,
        },
      }))

      if (event.type === 'agent.completed' || event.type === 'agent.failed' || event.type === 'session.closed') {
        release(input.runId)
      }
    })
    subscriptions.current.set(input.runId, unsubscribe)
  }, [release, services, updateMessage])

  // Reattach durable runs after refresh or navigation. The runtime reconciles
  // the complete event snapshot before continuing the live stream.
  useEffect(() => {
    if (!services?.runtime) return
    for (const message of data.messages) {
      if (!message.run || message.run.done || message.run.id === 'pending') continue
      track({
        runId: message.run.id,
        threadId: message.chatId,
        messageId: message.id,
        initialRun: message.run,
        initialText: message.text,
        parentRunId: message.run.parentRunId,
      })
    }
  }, [data.messages, services, track])

  const stop = useCallback(async (runId: string) => {
    release(runId)
    await services?.runtime.cancel(runId)
    const current = runById.current.get(runId)
    if (current && !current.done) {
      const stopped = { ...current, statusText: 'Stopped', done: true }
      runById.current.set(runId, stopped)
      setRuns((items) => items[runId] ? { ...items, [runId]: { ...items[runId], run: stopped } } : items)
      const messageId = runs[runId]?.messageId
      if (messageId) updateMessage(messageId, { run: stopped })
    }
  }, [release, runs, services, updateMessage])

  const getForThread = useCallback(
    (threadId: string) => Object.values(runs).filter((run) => run.threadId === threadId),
    [runs],
  )

  useEffect(() => () => {
    for (const unsubscribe of subscriptions.current.values()) unsubscribe()
    subscriptions.current.clear()
  }, [])

  const value = useMemo<RunRegistryApi>(() => ({ runs, track, stop, getForThread }), [getForThread, runs, stop, track])
  return <RunRegistryContext.Provider value={value}>{children}</RunRegistryContext.Provider>
}

export function useRunRegistry() {
  const value = useContext(RunRegistryContext)
  if (!value) throw new Error('useRunRegistry must be used inside RunRegistryProvider')
  return value
}
