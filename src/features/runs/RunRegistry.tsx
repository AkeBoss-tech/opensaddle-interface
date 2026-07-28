import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../data/store'
import { applyRunEvent } from '../../lib/runEvents'
import type { RuntimeRunSummary, SessionEvent } from '../../services/contracts'
import type { AgentRunBlock } from '../../types'
import { runtimeRunToAgentBlock, selectOrphanedRuntimeRuns } from './recovery'
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
  pause: (runId: string) => Promise<void>
  resume: (runId: string) => Promise<void>
  retry: (runId: string, threadId: string, previousRun: AgentRunBlock) => Promise<void>
  steer: (runId: string, text: string) => Promise<void>
  queue: (runId: string, text: string) => Promise<{
    runId: string
    sessionId: string
    parentRunId?: string
    queuedAfterRunId?: string
    route?: import('../../services/contracts').RouteEstimate
  }>
  respond: (runId: string, requestId: string, response: {
    approved?: boolean
    scope?: 'once' | 'session'
    text?: string
    answers?: Record<string, string[]>
  }) => Promise<void>
  getForThread: (threadId: string) => ManagedRun[]
}

const RunRegistryContext = createContext<RunRegistryApi | null>(null)

export function RunRegistryProvider({ children }: { children: ReactNode }) {
  const {
    data,
    services,
    persistenceStatus,
    threadHistoryHydrated,
    createChat,
    appendMessage,
    updateMessage,
    adoptChatContinuation,
    toast,
  } = useStore()
  const [runs, setRuns] = useState<Record<string, ManagedRun>>({})
  const subscriptions = useRef(new Map<string, () => void>())
  const textByRun = useRef(new Map<string, string>())
  const runById = useRef(new Map<string, AgentRunBlock>())
  const dataRef = useRef(data)
  const reconciledRuntime = useRef<object | null>(null)
  const recoveringRuns = useRef(new Set<string>())
  dataRef.current = data

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
      if (next.providerSessionId
        && (next.providerSessionId !== previous.providerSessionId || next.providerTurnId !== previous.providerTurnId)) {
        const provider = next.providerKey
        if (provider === 'codex' || provider === 'claude' || provider === 'cursor' || provider === 'gemini') {
          adoptChatContinuation(input.threadId, next.providerSessionId, next.providerTurnId, provider)
        }
      }
      const routingNote = `Server · ${next.model} · ${next.harness} · ${next.runtime}`
      runById.current.set(input.runId, next)
      updateMessage(input.messageId, delta ? { text, run: next, routingNote } : { run: next, routingNote })
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

      // `session.closed` is the canonical terminal boundary. Staying attached
      // through it prevents final tool, usage, and closure evidence from being
      // dropped when a provider completes several events in one burst.
      if (event.type === 'session.closed') {
        release(input.runId)
      }
    })
    subscriptions.current.set(input.runId, unsubscribe)
  }, [adoptChatContinuation, release, services, updateMessage])

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

  // A server-owned run can outlive the renderer before its optimistic
  // assistant message reaches thread storage. Once durable thread hydration is
  // complete, reconstruct any active orphan as a background-created task and
  // replay the full event snapshot into the normal conversation UI.
  useEffect(() => {
    const runtime = services?.runtime
    if (
      !runtime?.listRuns
      || persistenceStatus !== 'synced'
      || !threadHistoryHydrated
      || reconciledRuntime.current === runtime
    ) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        let durableRuns: RuntimeRunSummary[] | undefined
        let lastError: unknown
        for (let attempt = 0; attempt < 3 && !durableRuns && !cancelled; attempt += 1) {
          try {
            durableRuns = await runtime.listRuns!()
          } catch (error) {
            lastError = error
            if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 500))
          }
        }
        if (!durableRuns) throw lastError ?? new Error('The local runtime did not return durable runs')
        if (cancelled) return
        const snapshot = dataRef.current
        const represented = new Set(snapshot.messages.flatMap((message) => message.run ? [message.run.id] : []))
        const projectIds = new Set(snapshot.projects.map((project) => project.id))
        for (const durableRun of selectOrphanedRuntimeRuns(durableRuns, represented, projectIds)) {
          if (cancelled || recoveringRuns.current.has(durableRun.runId)) continue
          recoveringRuns.current.add(durableRun.runId)
          const provider = durableRun.route.providerKey
          const project = snapshot.projects.find((candidate) => candidate.id === durableRun.projectId)
          const continuation = durableRun.providerSessionId
            && (provider === 'codex' || provider === 'claude' || provider === 'cursor' || provider === 'gemini')
            ? {
              provider,
              sessionId: durableRun.providerSessionId,
              checkpointId: durableRun.providerTurnId,
              sourcePath: project?.local?.rootPath ?? `project:${durableRun.projectId}`,
              authority: 'opensaddle_managed' as const,
              mode: durableRun.providerSessionMode ?? 'resume',
            }
            : undefined
          const chat = createChat(
            durableRun.projectId,
            durableRun.task.trim().slice(0, 80) || 'Recovered local task',
            durableRun.agentId,
            continuation,
            false,
          )
          appendMessage({
            chatId: chat.id,
            role: 'user',
            text: durableRun.task,
            routingNote: 'Recovered from local runtime',
          })
          const initialRun = runtimeRunToAgentBlock(durableRun)
          const message = appendMessage({
            chatId: chat.id,
            role: 'assistant',
            text: '',
            routingNote: `Recovered · ${initialRun.model} · ${initialRun.harness} · ${initialRun.runtime}`,
            run: initialRun,
          })
          track({
            runId: durableRun.runId,
            threadId: chat.id,
            messageId: message.id,
            initialRun,
            parentRunId: durableRun.parentRunId,
          })
          represented.add(durableRun.runId)
        }
        reconciledRuntime.current = runtime
      })().catch((error: unknown) => {
        if (!cancelled) toast('Task recovery unavailable', error instanceof Error ? error.message : String(error))
      })
    }, 700)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [appendMessage, createChat, persistenceStatus, services, threadHistoryHydrated, toast, track])

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

  const updateManagedRun = useCallback((runId: string, mutate: (run: AgentRunBlock) => AgentRunBlock) => {
    const current = runById.current.get(runId)
    if (!current) return
    const next = mutate(current)
    runById.current.set(runId, next)
    setRuns((items) => items[runId] ? { ...items, [runId]: { ...items[runId], run: next } } : items)
    const messageId = runs[runId]?.messageId
    if (messageId) updateMessage(messageId, { run: next })
  }, [runs, updateMessage])

  const pause = useCallback(async (runId: string) => {
    await services?.runtime.pause(runId)
    updateManagedRun(runId, (run) => ({ ...run, statusText: 'Paused', done: false }))
  }, [services, updateManagedRun])

  const resume = useCallback(async (runId: string) => {
    await services?.runtime.resume(runId)
    updateManagedRun(runId, (run) => ({ ...run, statusText: 'Resuming from checkpoint', done: false }))
  }, [services, updateManagedRun])

  const retry = useCallback(async (runId: string, threadId: string, previousRun: AgentRunBlock) => {
    if (!services?.runtime) return
    const started = await services.runtime.retry(runId)
    const nextRun: AgentRunBlock = {
      ...previousRun,
      id: started.runId,
      parentRunId: started.parentRunId ?? runId,
      title: `${previousRun.title} · retry`,
      statusText: 'Retrying from checkpoint',
      output: undefined,
      failure: undefined,
      done: false,
      duration: undefined,
      cost: undefined,
      tools: [],
      plan: [],
      artifacts: [],
      activity: [],
      usage: undefined,
      warnings: [],
      lastSequence: undefined,
    }
    const message = appendMessage({
      chatId: threadId,
      role: 'assistant',
      text: '',
      routingNote: `Retry · ${previousRun.model} · ${previousRun.harness} · ${previousRun.runtime}`,
      run: nextRun,
    })
    track({
      runId: started.runId,
      threadId,
      messageId: message.id,
      initialRun: nextRun,
      parentRunId: nextRun.parentRunId,
    })
  }, [appendMessage, services, track])

  const steer = useCallback(async (runId: string, text: string) => {
    await services?.runtime.steer(runId, text)
  }, [services])

  const queue = useCallback(async (runId: string, text: string) => {
    if (!services?.runtime) throw new Error('OpenSaddle runtime is unavailable')
    return await services.runtime.queue(runId, text)
  }, [services])

  const respond = useCallback(async (runId: string, requestId: string, response: {
    approved?: boolean
    scope?: 'once' | 'session'
    text?: string
    answers?: Record<string, string[]>
  }) => {
    await services?.runtime.respondToRequest(runId, requestId, response)
    updateManagedRun(runId, (run) => ({
      ...run,
      inputRequest: undefined,
      statusText: response.approved === false ? 'Request denied' : 'Continuing',
    }))
  }, [services, updateManagedRun])

  const getForThread = useCallback(
    (threadId: string) => Object.values(runs).filter((run) => run.threadId === threadId),
    [runs],
  )

  useEffect(() => () => {
    for (const unsubscribe of subscriptions.current.values()) unsubscribe()
    subscriptions.current.clear()
  }, [])

  const value = useMemo<RunRegistryApi>(
    () => ({ runs, track, stop, pause, resume, retry, steer, queue, respond, getForThread }),
    [getForThread, pause, queue, respond, resume, retry, runs, steer, stop, track],
  )
  return <RunRegistryContext.Provider value={value}>{children}</RunRegistryContext.Provider>
}

export function useRunRegistry() {
  const value = useContext(RunRegistryContext)
  if (!value) throw new Error('useRunRegistry must be used inside RunRegistryProvider')
  return value
}
