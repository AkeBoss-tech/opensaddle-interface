import { deriveRoute, simulateAgentRun } from '../lib/simulation'
import type { RuntimeClient, RouteEstimate, SessionEvent } from './contracts'
import type { CodingProvider, Harness, ModelKey, RunExecutionMode, RuntimeKind } from '../types'

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export class MockRuntimeClient implements RuntimeClient {
  private listeners = new Map<string, Set<(e: SessionEvent) => void>>()
  private cancelled = new Set<string>()
  private paused = new Set<string>()

  async estimate(task: string, prefs?: {
    routingPref?: string
    modelKey?: ModelKey
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
  }): Promise<RouteEstimate> {
    const route = deriveRoute(task, prefs?.routingPref ?? 'quality', {
      model: prefs?.modelKey && prefs.modelKey !== 'auto' ? prefs.modelKey : undefined,
      harness: prefs?.harnessKey,
      runtime: prefs?.runtimeKey,
    })
    return {
      modelKey: route.modelKey,
      harnessKey: route.harnessKey,
      providerKey: prefs?.providerKey && prefs.providerKey !== 'auto'
        ? prefs.providerKey
        : (route.harnessKey === 'coding' ? 'opensaddle' : undefined),
      runtimeKey: route.runtimeKey,
      reasons: route.reasons,
      cost: route.cost,
      alternatives: [
        { modelKey: 'sonnet', harnessKey: route.harnessKey, score: 0.82 },
        { modelKey: 'gpt', harnessKey: route.harnessKey, score: 0.76 },
      ],
    }
  }

  async startRun(input: {
    projectId: string
    task: string
    agentId?: string
    parentRunId?: string
    sourceIds?: string[]
    providerSessionId?: string
    providerSessionMode?: 'resume' | 'fork'
    providerTurnId?: string
    modelKey?: ModelKey
    harnessKey?: Harness
    runtimeKey?: RuntimeKind
    executionMode?: RunExecutionMode
    repo?: string
  }): Promise<{ runId: string; sessionId: string; mode?: string }> {
    const runId = uid('run')
    const sessionId = uid('ses')
    const route = deriveRoute(input.task, 'quality', {
      model: input.modelKey,
      harness: input.harnessKey,
      runtime: input.runtimeKey,
    })

    void this.emitStream(runId, sessionId, input.task, route)
    return { runId, sessionId, mode: input.repo ? 'mock_with_repo' : 'mock' }
  }

  subscribe(runId: string, onEvent: (event: SessionEvent) => void): () => void {
    if (!this.listeners.has(runId)) this.listeners.set(runId, new Set())
    this.listeners.get(runId)!.add(onEvent)
    return () => this.listeners.get(runId)?.delete(onEvent)
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.add(runId)
    this.emit(runId, {
      event_id: uid('evt'),
      session_id: 'local',
      run_id: runId,
      sequence: 9999,
      timestamp: new Date().toISOString(),
      type: 'agent.failed',
      payload: { reason: 'cancelled' },
    })
  }

  async pause(runId: string): Promise<void> {
    this.paused.add(runId)
    this.emit(runId, {
      event_id: uid('evt'),
      session_id: 'local',
      run_id: runId,
      sequence: 9000,
      timestamp: new Date().toISOString(),
      type: 'agent.paused',
      payload: { resumable: true },
    })
  }

  async resume(runId: string): Promise<void> {
    this.paused.delete(runId)
    this.emit(runId, {
      event_id: uid('evt'),
      session_id: 'local',
      run_id: runId,
      sequence: 9001,
      timestamp: new Date().toISOString(),
      type: 'agent.resumed',
      payload: {},
    })
  }

  async retry(runId: string): Promise<{ runId: string; sessionId: string; parentRunId?: string }> {
    return { runId: uid('run'), sessionId: uid('ses'), parentRunId: runId }
  }

  async steer(runId: string, text: string): Promise<void> {
    this.emit(runId, {
      event_id: uid('evt'),
      session_id: 'local',
      run_id: runId,
      sequence: 9002,
      timestamp: new Date().toISOString(),
      type: 'user.input.submitted',
      payload: { kind: 'steer', text },
    })
  }

  async queue(runId: string, text: string): Promise<{
    runId: string
    sessionId: string
    parentRunId?: string
    queuedAfterRunId?: string
  }> {
    const queuedRunId = uid('run')
    const sessionId = uid('ses')
    const route = deriveRoute(text, 'quality')
    queueMicrotask(() => {
      this.emit(queuedRunId, {
        event_id: uid('evt'),
        session_id: sessionId,
        run_id: queuedRunId,
        sequence: 0,
        timestamp: new Date().toISOString(),
        type: 'agent.queued',
        payload: { after_run_id: runId, parent_run_id: runId },
      })
      window.setTimeout(() => {
        this.emit(queuedRunId, {
          event_id: uid('evt'),
          session_id: sessionId,
          run_id: queuedRunId,
          sequence: 1,
          timestamp: new Date().toISOString(),
          type: 'agent.dequeued',
          payload: { after_run_id: runId },
        })
        void this.emitStream(queuedRunId, sessionId, text, route)
      }, 750)
    })
    return { runId: queuedRunId, sessionId, parentRunId: runId, queuedAfterRunId: runId }
  }

  async respondToRequest(runId: string, requestId: string, response: {
    approved?: boolean
    scope?: 'once' | 'session'
    text?: string
    answers?: Record<string, string[]>
  }): Promise<void> {
    this.emit(runId, {
      event_id: uid('evt'),
      session_id: 'local',
      run_id: runId,
      sequence: 9002,
      timestamp: new Date().toISOString(),
      type: response.approved === undefined ? 'user.input.submitted' : 'approval.resolved',
      payload: { request_id: requestId, allowed: response.approved, scope: response.scope },
    })
  }

  private emit(runId: string, event: SessionEvent) {
    this.listeners.get(runId)?.forEach((fn) => fn(event))
  }

  private async emitStream(
    runId: string,
    sessionId: string,
    task: string,
    route: ReturnType<typeof deriveRoute>,
  ) {
    let seq = 0
    let emittedOutput = ''
    const push = (type: SessionEvent['type'], payload: Record<string, unknown>) => {
      if (this.cancelled.has(runId) || this.paused.has(runId)) return
      this.emit(runId, {
        event_id: uid('evt'),
        session_id: sessionId,
        run_id: runId,
        sequence: seq++,
        timestamp: new Date().toISOString(),
        type,
        payload,
      })
    }

    push('session.created', { sessionId })
    push('agent.started', { task, route })

    await new Promise<void>((resolve) => {
      void simulateAgentRun(task, route, (partial) => {
        if (partial.tools?.length) {
          const last = partial.tools[partial.tools.length - 1]!
          push('tool.completed', { tool: last })
        }
        if (partial.artifacts?.length) {
          push('diff.updated', { artifacts: partial.artifacts })
        }
        if (partial.plan) {
          const output = partial.output ?? ''
          const text = output.startsWith(emittedOutput) ? output.slice(emittedOutput.length) : output
          emittedOutput = output
          push('agent.output.delta', { plan: partial.plan, status: partial.statusText, text })
        }
        if (partial.done) {
          push('verification.completed', {
            checks: [
              { name: 'Unit tests', ok: true, duration: '1.2s' },
              { name: 'Typecheck', ok: true, duration: '0.8s' },
            ],
          })
          push('agent.completed', { run: partial })
          push('session.closed', {})
          resolve()
        }
      })
    })
  }
}
