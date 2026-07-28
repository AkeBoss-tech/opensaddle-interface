import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../data/store'
import { applyRunEvent } from '../../lib/runEvents'
import type { RuntimeRunSummary, SessionEvent } from '../../services/contracts'
import type { AgentRunBlock } from '../../types'
import {
  isRecoverableRuntimeRun,
  runtimeRunToAgentBlock,
  selectOrphanedRuntimeRuns,
  selectThreadLinkedRuntimeRuns,
} from './recovery'
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
    threadId?: string
    sourceMessageId?: string
    assistantMessageId?: string
    parentRunId?: string
    queuedAfterRunId?: string
    route?: import('../../services/contracts').RouteEstimate
  }>
  updateQueue: (runId: string, text: string) => Promise<void>
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
  const recoveringRuns = useRef(new Set<string>())
  const validatedStoredRuns = useRef(new Set<string>())
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

    let closedBeforeAttach = false
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

      // Stay attached through the server's canonical terminal event so final
      // output, usage, tool results, and closure evidence are not dropped.
      // Cancelled runs terminate at `agent.cancelled`; completed and failed
      // provider sessions terminate at `session.closed`.
      if (event.type === 'session.closed' || event.type === 'agent.cancelled') {
        if (subscriptions.current.has(input.runId)) release(input.runId)
        else closedBeforeAttach = true
      }
    })
    if (closedBeforeAttach) unsubscribe()
    else subscriptions.current.set(input.runId, unsubscribe)
  }, [adoptChatContinuation, release, services, updateMessage])

  // Reattach durable runs after refresh or navigation. The runtime reconciles
  // the complete event snapshot before continuing the live stream.
  useEffect(() => {
    const runtime = services?.runtime
    if (!runtime) return
    const candidates = data.messages.filter((message) =>
      message.run
      && !message.run.done
      && message.run.id !== 'pending'
      && !subscriptions.current.has(message.run.id)
      && !validatedStoredRuns.current.has(message.run.id))
    if (!candidates.length) return

    if (!runtime.listRuns) {
      for (const message of candidates) {
        validatedStoredRuns.current.add(message.run!.id)
        track({
          runId: message.run!.id,
          threadId: message.chatId,
          messageId: message.id,
          initialRun: message.run!,
          initialText: message.text,
          parentRunId: message.run!.parentRunId,
        })
      }
      return
    }

    let cancelled = false
    void runtime.listRuns().then((durableRuns) => {
      if (cancelled) return
      const durableById = new Map(durableRuns.map((run) => [run.runId, run]))
      for (const message of candidates) {
        const storedRun = message.run!
        validatedStoredRuns.current.add(storedRun.id)
        const durable = durableById.get(storedRun.id)
        if (!durable) {
          updateMessage(message.id, {
            run: {
              ...storedRun,
              statusText: 'Run record unavailable',
              done: true,
              failure: {
                kind: 'interrupted',
                title: 'This local run is no longer available',
                message: 'The cached conversation referenced a run that is not present in the local OpenSaddle service.',
                recovery: 'Start a new run from this message if you want to continue.',
                retryable: false,
              },
            },
          })
          continue
        }
        const initialRun = runtimeRunToAgentBlock(durable)
        if (!isRecoverableRuntimeRun(durable)) {
          updateMessage(message.id, { run: initialRun })
          continue
        }
        track({
          runId: durable.runId,
          threadId: message.chatId,
          messageId: message.id,
          initialRun,
          initialText: message.text,
          parentRunId: durable.parentRunId,
        })
      }
    }).catch(() => {
      // Keep cached state intact when the local service is temporarily
      // unavailable. A later service instance will trigger reconciliation.
    })
    return () => {
      cancelled = true
    }
  }, [data.messages, services, track, updateMessage])

  // A server-owned run can begin outside the current renderer. Continuously
  // adopt it into its declared durable thread, or recover a legacy active run
  // into a new task, then replay the full event snapshot into conversation UI.
  useEffect(() => {
    const runtime = services?.runtime
    if (
      !runtime?.listRuns
      || !threadHistoryHydrated
    ) return
    let cancelled = false
    let refreshing = false
    let reportedFailure = false
    const reconcile = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const durableRuns: RuntimeRunSummary[] = await runtime.listRuns!()
        if (cancelled) return
        const snapshot = dataRef.current
        const represented = new Set(snapshot.messages.flatMap((message) => [
          ...(message.run ? [message.run.id] : []),
          ...(message.runtimeRunId ? [message.runtimeRunId] : []),
        ]))
        const threadIds = new Set(snapshot.chats.map((chat) => chat.id))
        const projectIds = new Set(snapshot.projects.map((project) => project.id))
        const durableById = new Map(durableRuns.map((run) => [run.runId, run]))

        // Thread hydration intentionally stores only durable provider output
        // and the runtime identity. Reconstruct the interactive run card from
        // the authoritative runtime snapshot, then replay its complete event
        // history into the same message.
        for (const message of snapshot.messages) {
          if (
            message.run
            || !message.runtimeRunId
          ) continue
          const durableRun = durableById.get(message.runtimeRunId)
          if (!durableRun || durableRun.threadId !== message.chatId) continue
          recoveringRuns.current.add(durableRun.runId)
          const initialRun = runtimeRunToAgentBlock(durableRun)
          const routingNote = `Server · ${initialRun.model} · ${initialRun.harness} · ${initialRun.runtime}`
          updateMessage(message.id, { run: initialRun, routingNote })
          track({
            runId: durableRun.runId,
            threadId: message.chatId,
            messageId: message.id,
            initialRun,
            initialText: message.text,
            parentRunId: durableRun.parentRunId,
          })
        }

        for (const durableRun of selectThreadLinkedRuntimeRuns(durableRuns, represented, threadIds)) {
          if (cancelled || recoveringRuns.current.has(durableRun.runId) || !durableRun.threadId) continue
          recoveringRuns.current.add(durableRun.runId)
          const initialRun = runtimeRunToAgentBlock(durableRun)
          const message = appendMessage({
            id: durableRun.assistantMessageId,
            chatId: durableRun.threadId,
            role: 'assistant',
            text: '',
            runtimeRunId: durableRun.runId,
            routingNote: `Server · ${initialRun.model} · ${initialRun.harness} · ${initialRun.runtime}`,
            run: initialRun,
          }, { persist: !durableRun.assistantMessageId })
          track({
            runId: durableRun.runId,
            threadId: durableRun.threadId,
            messageId: message.id,
            initialRun,
            parentRunId: durableRun.parentRunId,
          })
          represented.add(durableRun.runId)
        }
        for (const durableRun of selectOrphanedRuntimeRuns(durableRuns, represented, projectIds).filter((run) => !run.threadId)) {
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
        reportedFailure = false
      } catch (error) {
        if (!cancelled && !reportedFailure) {
          reportedFailure = true
          toast('Task recovery unavailable', error instanceof Error ? error.message : String(error))
        }
      } finally {
        refreshing = false
      }
    }
    const kickoff = window.setTimeout(() => void reconcile(), 700)
    const timer = window.setInterval(() => void reconcile(), 2_500)
    return () => {
      cancelled = true
      window.clearTimeout(kickoff)
      window.clearInterval(timer)
    }
  }, [appendMessage, createChat, services, threadHistoryHydrated, toast, track, updateMessage])

  const stop = useCallback(async (runId: string) => {
    await services?.runtime.cancel(runId)
    const current = runById.current.get(runId)
    if (current && !current.done) {
      const stopped = { ...current, statusText: 'Stopped', done: true }
      runById.current.set(runId, stopped)
      setRuns((items) => items[runId] ? { ...items, [runId]: { ...items[runId], run: stopped } } : items)
      const messageId = runs[runId]?.messageId
      if (messageId) updateMessage(messageId, { run: stopped })
    }
    // Stay subscribed until the server's canonical terminal event.
    // Cancellation can flush final output, usage, tool results, and closure
    // evidence after the mutation response has already been returned.
  }, [runs, services, updateMessage])

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
      id: started.assistantMessageId,
      chatId: threadId,
      role: 'assistant',
      text: '',
      runtimeRunId: started.runId,
      routingNote: `Retry · ${previousRun.model} · ${previousRun.harness} · ${previousRun.runtime}`,
      run: nextRun,
    }, { persist: !started.assistantMessageId })
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

  const updateQueue = useCallback(async (runId: string, text: string) => {
    if (!services?.runtime) throw new Error('OpenSaddle runtime is unavailable')
    await services.runtime.updateQueue(runId, text)
    updateManagedRun(runId, (run) => ({ ...run, queuedTask: text }))
  }, [services, updateManagedRun])

  const respond = useCallback(async (runId: string, requestId: string, response: {
    approved?: boolean
    scope?: 'once' | 'session'
    text?: string
    answers?: Record<string, string[]>
  }) => {
    await services?.runtime.respondToRequest(runId, requestId, response)
    // The runtime emits the durable approval.resolved/user.input.submitted
    // event before this request returns. Let that authoritative event update
    // the message instead of overwriting its decision status optimistically.
  }, [services])

  const getForThread = useCallback(
    (threadId: string) => Object.values(runs).filter((run) => run.threadId === threadId),
    [runs],
  )

  useEffect(() => () => {
    for (const unsubscribe of subscriptions.current.values()) unsubscribe()
    subscriptions.current.clear()
  }, [])

  const value = useMemo<RunRegistryApi>(
    () => ({ runs, track, stop, pause, resume, retry, steer, queue, updateQueue, respond, getForThread }),
    [getForThread, pause, queue, respond, resume, retry, runs, steer, stop, track, updateQueue],
  )
  return <RunRegistryContext.Provider value={value}>{children}</RunRegistryContext.Provider>
}

export function useRunRegistry() {
  const value = useContext(RunRegistryContext)
  if (!value) throw new Error('useRunRegistry must be used inside RunRegistryProvider')
  return value
}
