import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../data/store'
import { HARNESS_LABEL, MODEL_LABEL, RUNTIME_LABEL, simulateAgentRun, type RouteDecision } from '../../lib/simulation'
import type { RouteEstimate, RuntimeRunSummary, RuntimeClient } from '../../services/contracts'
import { evaluatePermissions } from '../../services/permissions'
import type { AgentRunBlock, CodingProvider, Harness, ModelKey, PermissionGrant, RunExecutionMode, RuntimeKind } from '../../types'
import {
  isRecoverableRuntimeRun,
  reconcileDurableRunBlock,
  runtimeRunToAgentBlock,
  selectOrphanedRuntimeRuns,
  selectThreadLinkedRuntimeRuns,
} from './recovery'
import { OperationController } from './operationController'

export interface ManagedRun {
  runId: string
  threadId: string
  messageId: string
  parentRunId?: string
  run: AgentRunBlock
  lastEvent?: import('../../services/contracts').SessionEvent
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
  preflight: (input: OperationPreflightInput) => Promise<OperationPreflightResult>
  start: (input: StartOperationInput) => Promise<StartOperationResult>
}

export interface OperationPreflightInput {
  task: string
  projectId: string
  userId: string
  agentId?: string
  grants: PermissionGrant[]
  fallbackRoute: RouteDecision
  serverRouting: boolean
  routePreferences: Parameters<RuntimeClient['estimate']>[1]
}

export interface OperationPreflightResult {
  route: RouteDecision
  estimate?: RouteEstimate
  execution: ReturnType<typeof evaluatePermissions>
}

export interface StartOperationInput {
  projectId: string
  threadId: string
  sourceMessageId?: string
  task: string
  route: RouteDecision
  agentId?: string
  parentRunId?: string
  sourceIds?: string[]
  title?: string
  agentDefinitionPath?: string
  skillPaths?: string[]
  providerSessionId?: string
  providerSessionMode?: 'resume' | 'fork'
  providerTurnId?: string
  modelKey?: ModelKey
  modelId?: string
  reasoningEffort?: string
  harnessKey?: Harness
  providerKey?: CodingProvider
  runtimeKey?: RuntimeKind
  executionMode?: RunExecutionMode
  capabilityIds?: string[]
  repo?: string
  approvalId?: string
  reviewProviderKey?: CodingProvider
  onRunUpdate?: (run: AgentRunBlock) => void
}

export type StartOperationResult =
  | { status: 'started'; runId: string; route?: RouteEstimate }
  | { status: 'simulated'; runId: string; route?: RouteEstimate }
  | { status: 'failed'; error: Error }

const PROVIDER_LABEL: Partial<Record<CodingProvider, string>> = {
  codex: 'Codex App Server', claude: 'Claude Code', cursor: 'Cursor', gemini: 'Gemini CLI',
  opencode: 'OpenCode', antigravity: 'Antigravity CLI', opensaddle: 'OpenSaddle', custom: 'Custom harness',
}

function routeFromEstimate(estimate: RouteEstimate, fallback: RouteDecision): RouteDecision {
  return {
    klass: estimate.harnessKey === 'coding' ? 'coding'
      : estimate.harnessKey === 'research' ? 'research'
      : estimate.harnessKey === 'browser' ? 'browser'
      : fallback.klass === 'ops' ? 'ops' : 'chat',
    modelKey: estimate.modelKey,
    harnessKey: estimate.harnessKey,
    runtimeKey: estimate.runtimeKey,
    reasons: estimate.reasons,
    cost: estimate.cost,
  }
}

function modelLabel(route: RouteEstimate | undefined, fallback: ModelKey): string {
  const provider = route?.providerKey
  return route?.nativeModelDefault && provider && provider !== 'auto'
    ? `${PROVIDER_LABEL[provider] ?? 'Harness'} default`
    : MODEL_LABEL[route?.modelKey ?? fallback]
}

function harnessLabel(route: RouteEstimate | undefined, fallback: Harness): string {
  const provider = route?.providerKey
  return (route?.harnessKey ?? fallback) === 'coding' && provider && provider !== 'auto'
    ? PROVIDER_LABEL[provider] ?? HARNESS_LABEL[route?.harnessKey ?? fallback]
    : HARNESS_LABEL[route?.harnessKey ?? fallback]
}

const RunRegistryContext = createContext<RunRegistryApi | null>(null)

export function RunRegistryProvider({ children }: { children: ReactNode }) {
  const {
    data,
    services, connection,
    threadHistoryHydrated,
    createChat,
    appendMessage,
    updateMessage,
    adoptChatContinuation,
    toast,
  } = useStore()
  const [runs, setRuns] = useState<Record<string, ManagedRun>>({})
  const controller = useRef(new OperationController())
  const dataRef = useRef(data)
  const recoveringRuns = useRef(new Set<string>())
  const validatedStoredRuns = useRef(new Set<string>())
  dataRef.current = data

  const track = useCallback((input: TrackRunInput) => {
    if (!services?.runtime || controller.current.has(input.runId)) return
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

    controller.current.attach({
      runId: input.runId,
      initialRun: input.initialRun,
      initialText: input.initialText,
      subscribe: services.runtime.subscribe.bind(services.runtime),
      onUpdate: ({ run: next, previousRun: previous = input.initialRun, text, lastEvent: event, eventCount }) => {
      if (!event) return
      if (next.providerSessionId
        && (next.providerSessionId !== previous.providerSessionId || next.providerTurnId !== previous.providerTurnId)) {
        const provider = next.providerKey
        if (provider === 'codex' || provider === 'claude' || provider === 'cursor' || provider === 'gemini') {
          adoptChatContinuation(input.threadId, next.providerSessionId, next.providerTurnId, provider)
        }
      }
      const routingNote = `Server · ${next.model} · ${next.harness} · ${next.runtime}`
      updateMessage(input.messageId, event.type === 'agent.output.delta' ? { text, run: next, routingNote } : { run: next, routingNote })
      setRuns((current) => ({
        ...current,
        [input.runId]: {
          runId: input.runId,
          threadId: input.threadId,
          messageId: input.messageId,
          parentRunId: input.parentRunId ?? next.parentRunId,
          run: next,
          lastEvent: event,
          eventCount,
        },
      }))
      },
      onUnavailable: (error, snapshot) => {
        const degraded = { ...snapshot.run, statusText: 'Connection lost · reconnecting' }
        controller.current.replaceRun(input.runId, degraded)
        updateMessage(input.messageId, { run: degraded })
        setRuns((current) => current[input.runId] ? {
          ...current,
          [input.runId]: { ...current[input.runId], run: degraded },
        } : current)
        toast('Run connection unavailable', error.message)
      },
    })
  }, [adoptChatContinuation, services, toast, updateMessage])

  // Reattach durable runs after refresh or navigation. The runtime reconciles
  // the complete event snapshot before continuing the live stream.
  useEffect(() => {
    const runtime = services?.runtime
    if (!runtime) return
    const candidates = data.messages.filter((message) =>
      message.run
      && !message.run.done
      && message.run.id !== 'pending'
      && !controller.current.has(message.run.id)
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
          if (message.run && message.runtimeRunId) {
            const durableRun = durableById.get(message.runtimeRunId)
            if (!durableRun || durableRun.threadId !== message.chatId) continue
            const reconciled = reconcileDurableRunBlock(message.run, durableRun)
            if (
              reconciled.parentRunId !== message.run.parentRunId
              || reconciled.title !== message.run.title
              || reconciled.statusText !== message.run.statusText
              || reconciled.done !== message.run.done
              || reconciled.runtimeAttached !== message.run.runtimeAttached
              || reconciled.providerSessionId !== message.run.providerSessionId
              || reconciled.providerTurnId !== message.run.providerTurnId
            ) {
              updateMessage(message.id, { run: reconciled })
            }
            if (isRecoverableRuntimeRun(durableRun) && !controller.current.has(durableRun.runId)) {
              track({
                runId: durableRun.runId,
                threadId: message.chatId,
                messageId: message.id,
                initialRun: reconciled,
                initialText: message.text,
                parentRunId: durableRun.parentRunId,
              })
            }
            continue
          }
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
    const current = controller.current.get(runId)?.run
    if (current && !current.done) {
      const stopping = { ...current, statusText: 'Stopping', done: false }
      controller.current.replaceRun(runId, stopping)
      setRuns((items) => items[runId] ? { ...items, [runId]: { ...items[runId], run: stopping } } : items)
      const messageId = runs[runId]?.messageId
      if (messageId) updateMessage(messageId, { run: stopping })
    }
    // Stay subscribed until the server's canonical terminal event.
    // Cancellation can flush final output, usage, tool results, and closure
    // evidence after the mutation response has already been returned.
  }, [runs, services, updateMessage])

  const updateManagedRun = useCallback((runId: string, mutate: (run: AgentRunBlock) => AgentRunBlock) => {
    const current = controller.current.get(runId)?.run
    if (!current) return
    const next = mutate(current)
    controller.current.replaceRun(runId, next)
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

  const preflight = useCallback(async (input: OperationPreflightInput): Promise<OperationPreflightResult> => {
    const execution = evaluatePermissions(input.grants, {
      userId: input.userId,
      agentId: input.agentId,
      resourceKind: 'project',
      resourceId: input.projectId,
      action: 'execute',
    })
    if (!input.serverRouting) return { route: input.fallbackRoute, execution }
    if (!services?.runtime) throw new Error('OpenSaddle runtime is unavailable')
    const estimate = await services.runtime.estimate(input.task, input.routePreferences)
    return { route: routeFromEstimate(estimate, input.fallbackRoute), estimate, execution }
  }, [services])

  const start = useCallback(async (input: StartOperationInput): Promise<StartOperationResult> => {
    const pendingRun: AgentRunBlock = {
      id: 'pending',
      parentRunId: input.parentRunId,
      kind: input.route.klass === 'ops' ? 'ops' : input.route.klass === 'browser' ? 'browser' : input.route.klass === 'research' ? 'research' : 'coding',
      executionMode: input.executionMode,
      title: input.title ?? 'Agent run', model: MODEL_LABEL[input.route.modelKey], reasoningEffort: input.reasoningEffort,
      harness: HARNESS_LABEL[input.route.harnessKey], runtime: RUNTIME_LABEL[input.route.runtimeKey],
      statusText: 'Planning', done: false, tools: [], plan: [], artifacts: [],
    }
    const placeholder = appendMessage({
      chatId: input.threadId, role: 'assistant', text: '',
      routingNote: `Auto · ${pendingRun.model} · ${pendingRun.harness} · ${pendingRun.runtime}`,
      run: pendingRun,
    }, { persist: !services?.runtime })

    if (!services?.runtime) {
      const error = new Error('OpenSaddle runtime is unavailable')
      updateMessage(placeholder.id, {
        text: `OpenSaddle could not start this run: ${error.message}`,
        run: { ...pendingRun, statusText: error.message, done: true, failure: {
          kind: 'runtime', title: 'Runtime unavailable', message: error.message,
          recovery: 'Restore the connection and start a new run.', retryable: true,
        } },
      })
      return { status: 'failed', error }
    }

    try {
      const started = await services.runtime.startRun({
        projectId: input.projectId, threadId: input.threadId, sourceMessageId: input.sourceMessageId,
        assistantMessageId: placeholder.id, task: input.task, agentId: input.agentId,
        parentRunId: input.parentRunId, sourceIds: input.sourceIds,
        agentDefinitionPath: input.agentDefinitionPath, skillPaths: input.skillPaths,
        providerSessionId: input.providerSessionId, providerSessionMode: input.providerSessionMode,
        providerTurnId: input.providerTurnId, modelKey: input.modelKey, modelId: input.modelId,
        reasoningEffort: input.reasoningEffort, harnessKey: input.harnessKey, providerKey: input.providerKey,
        runtimeKey: input.runtimeKey, executionMode: input.executionMode, capabilityIds: input.capabilityIds,
        repo: input.repo, approvalId: input.approvalId, reviewProviderKey: input.reviewProviderKey,
      })
      const mockMode = started.mode === 'mock' || started.mode === 'mock_with_repo'
      if (mockMode && connection.mode !== 'demo') {
        throw new Error('Connected OpenSaddle returned a simulated run; no authoritative operation was started')
      }
      const actualRoute = started.route
      const actualRuntime = actualRoute?.runtimeKey ?? input.route.runtimeKey
      const liveRun: AgentRunBlock = {
        ...pendingRun,
        id: started.runId,
        providerKey: actualRoute?.providerKey ?? input.providerKey,
        model: modelLabel(actualRoute, input.route.modelKey),
        reasoningEffort: actualRoute?.reasoningEffort ?? input.reasoningEffort,
        harness: harnessLabel(actualRoute, input.route.harnessKey),
        runtime: RUNTIME_LABEL[actualRuntime],
        statusText: (started.mode ?? (connection.mode === 'demo' ? 'mock' : 'starting')).replace('_', ' '),
        cost: actualRoute?.cost ?? input.route.cost,
      }
      updateMessage(placeholder.id, {
        runtimeRunId: started.runId,
        routingNote: `${actualRoute ? 'Server' : connection.mode === 'demo' ? 'Demo' : 'Connected'} · ${liveRun.model} · ${liveRun.harness} · ${liveRun.runtime}`,
        run: liveRun,
      })
      if (mockMode) {
        await simulateAgentRun(input.task, input.route, (run) => {
          const simulated = { ...run, id: started.runId, parentRunId: input.parentRunId, title: pendingRun.title, executionMode: input.executionMode }
          updateMessage(placeholder.id, { text: run.output ?? '', run: simulated })
          input.onRunUpdate?.(simulated)
        })
        return { status: 'simulated', runId: started.runId, route: started.route }
      }
      track({ runId: started.runId, threadId: input.threadId, messageId: placeholder.id, initialRun: liveRun, initialText: placeholder.text })
      return { status: 'started', runId: started.runId, route: started.route }
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      updateMessage(placeholder.id, {
        text: `I couldn’t start the agent because its execution environment is unavailable. ${error.message}`,
        run: { ...pendingRun, statusText: error.message, done: true, failure: {
          kind: 'runtime', title: 'Run could not start', message: error.message,
          recovery: 'Restore the runtime connection and try again.', retryable: true,
        } },
      })
      return { status: 'failed', error }
    }
  }, [appendMessage, connection.mode, services, track, updateMessage])

  const getForThread = useCallback(
    (threadId: string) => Object.values(runs).filter((run) => run.threadId === threadId),
    [runs],
  )

  useEffect(() => () => {
    controller.current.dispose()
  }, [])

  const value = useMemo<RunRegistryApi>(
    () => ({ runs, track, stop, pause, resume, retry, steer, queue, updateQueue, respond, getForThread, preflight, start }),
    [getForThread, pause, preflight, queue, respond, resume, retry, runs, start, steer, stop, track, updateQueue],
  )
  return <RunRegistryContext.Provider value={value}>{children}</RunRegistryContext.Provider>
}

export function useRunRegistry() {
  const value = useContext(RunRegistryContext)
  if (!value) throw new Error('useRunRegistry must be used inside RunRegistryProvider')
  return value
}
