import { MockRuntimeClient } from './mockRuntime'
import type { RuntimeClient, RouteEstimate, SessionEvent } from './contracts'
import type { Harness, ModelKey, RuntimeKind } from '../types'

/**
 * Talks to a local OpenSaddle daemon when available; falls back to mock simulation.
 */
export class OpenSaddleRuntimeClient implements RuntimeClient {
  private baseUrl: string
  private fallback: RuntimeClient

  constructor(baseUrl: string, fallback: RuntimeClient = new MockRuntimeClient()) {
    this.baseUrl = baseUrl
    this.fallback = fallback
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(800) })
      return res.ok
    } catch {
      return false
    }
  }

  async estimate(task: string, prefs?: { routingPref?: string }): Promise<RouteEstimate> {
    if (!(await this.healthy())) return this.fallback.estimate(task, prefs)
    try {
      const res = await fetch(`${this.baseUrl}/api/routes/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, routing_pref: prefs?.routingPref ?? 'quality' }),
      })
      if (!res.ok) return this.fallback.estimate(task, prefs)
      const data = await res.json() as {
        model_key: ModelKey
        harness_key: Harness
        runtime_key: RuntimeKind
        reasons: string[]
        cost: string
        alternatives?: Array<{ model_key: ModelKey; harness_key: Harness; score: number }>
      }
      return {
        modelKey: data.model_key,
        harnessKey: data.harness_key,
        runtimeKey: data.runtime_key,
        reasons: data.reasons,
        cost: data.cost,
        alternatives: data.alternatives?.map((a) => ({
          modelKey: a.model_key,
          harnessKey: a.harness_key,
          score: a.score,
        })),
      }
    } catch {
      return this.fallback.estimate(task, prefs)
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
    if (!(await this.healthy())) return this.fallback.startRun(input)
    try {
      const res = await fetch(`${this.baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: input.projectId,
          task: input.task,
          agent_id: input.agentId,
          model_key: input.modelKey,
          harness_key: input.harnessKey,
          runtime_key: input.runtimeKey,
        }),
      })
      if (!res.ok) return this.fallback.startRun(input)
      const data = await res.json() as { run_id: string; session_id: string }
      return { runId: data.run_id, sessionId: data.session_id }
    } catch {
      return this.fallback.startRun(input)
    }
  }

  subscribe(runId: string, onEvent: (event: SessionEvent) => void): () => void {
    const url = `${this.baseUrl}/api/runs/${runId}/events`
    let closed = false
    let source: EventSource | null = null

    void (async () => {
      if (!(await this.healthy())) {
        this.fallback.subscribe(runId, onEvent)
        return
      }
      try {
        source = new EventSource(url)
        source.onmessage = (msg) => {
          if (closed) return
          try {
            onEvent(JSON.parse(msg.data) as SessionEvent)
          } catch { /* ignore */ }
        }
        source.onerror = () => {
          source?.close()
          if (!closed) this.fallback.subscribe(runId, onEvent)
        }
      } catch {
        this.fallback.subscribe(runId, onEvent)
      }
    })()

    return () => {
      closed = true
      source?.close()
    }
  }

  async cancel(runId: string): Promise<void> {
    if (await this.healthy()) {
      try {
        await fetch(`${this.baseUrl}/api/runs/${runId}/cancel`, { method: 'POST' })
        return
      } catch { /* fall through */ }
    }
    return this.fallback.cancel(runId)
  }
}
