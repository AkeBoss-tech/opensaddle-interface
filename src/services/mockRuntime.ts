import { deriveRoute, simulateAgentRun } from '../lib/simulation'
import type { RuntimeClient, RouteEstimate, SessionEvent } from './contracts'
import type { Harness, ModelKey, RuntimeKind } from '../types'

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export class MockRuntimeClient implements RuntimeClient {
  private listeners = new Map<string, Set<(e: SessionEvent) => void>>()
  private cancelled = new Set<string>()

  async estimate(task: string, prefs?: { routingPref?: string }): Promise<RouteEstimate> {
    const route = deriveRoute(task, prefs?.routingPref ?? 'quality')
    return {
      modelKey: route.modelKey,
      harnessKey: route.harnessKey,
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
    modelKey?: ModelKey
    harnessKey?: Harness
    runtimeKey?: RuntimeKind
  }): Promise<{ runId: string; sessionId: string }> {
    const runId = uid('run')
    const sessionId = uid('ses')
    const route = deriveRoute(input.task, 'quality', {
      model: input.modelKey,
      harness: input.harnessKey,
      runtime: input.runtimeKey,
    })

    void this.emitStream(runId, sessionId, input.task, route)
    return { runId, sessionId }
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
    const push = (type: SessionEvent['type'], payload: Record<string, unknown>) => {
      if (this.cancelled.has(runId)) return
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
          push('agent.output.delta', { plan: partial.plan, statusText: partial.statusText })
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
