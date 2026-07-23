import { MockRuntimeClient } from './mockRuntime'
import type { RuntimeClient, RouteEstimate, SessionEvent } from './contracts'
import type { CodingProvider, Harness, ModelKey, RuntimeKind } from '../types'

/**
 * Talks to a local OpenSaddle daemon when available; falls back to mock simulation.
 */
export class OpenSaddleRuntimeClient implements RuntimeClient {
  private baseUrl: string
  private fallback: RuntimeClient
  private token?: string
  private getUserId: () => string
  private allowFallback: boolean

  constructor(
    baseUrl: string,
    fallback: RuntimeClient = new MockRuntimeClient(),
    options: {
      token?: string
      getUserId?: () => string
      allowFallback?: boolean
    } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fallback = fallback
    this.token = options.token
    this.getUserId = options.getUserId ?? (() => 'user-ad')
    this.allowFallback = options.allowFallback ?? true
  }

  private headers(json = false): Record<string, string> {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      'X-OpenSaddle-User': this.getUserId(),
    }
  }

  private async responseError(res: Response): Promise<Error> {
    try {
      const body = await res.json() as { error?: string; message?: string; reason?: string }
      return new Error(body.reason ?? body.message ?? body.error ?? `OpenSaddle HTTP ${res.status}`)
    } catch {
      return new Error(`OpenSaddle HTTP ${res.status}`)
    }
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(1200),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async estimate(task: string, prefs?: {
    projectId?: string
    routingPref?: string
    modelKey?: ModelKey
    modelId?: string
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
  }): Promise<RouteEstimate> {
    if (!(await this.healthy())) {
      if (this.allowFallback) return this.fallback.estimate(task, prefs)
      throw new Error(`OpenSaddle control plane unavailable at ${this.baseUrl}`)
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/routes/estimate`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          task,
          project_id: prefs?.projectId,
          routing_pref: prefs?.routingPref ?? 'quality',
          model_key: prefs?.modelKey,
          model_id: prefs?.modelId,
          harness_key: prefs?.harnessKey,
          provider_key: prefs?.providerKey,
          runtime_key: prefs?.runtimeKey,
        }),
      })
      if (!res.ok) throw await this.responseError(res)
      const data = await res.json() as {
        model_key: ModelKey
        model_id?: string
        native_model_default?: boolean
        harness_key: Harness
        provider_key?: CodingProvider
        runtime_key: RuntimeKind
        reasons: string[]
        cost: string
        alternatives?: Array<{ model_key: ModelKey; harness_key: Harness; score: number }>
      }
      return {
        modelKey: data.model_key,
        modelId: data.model_id,
        nativeModelDefault: data.native_model_default,
        harnessKey: data.harness_key,
        providerKey: data.provider_key,
        runtimeKey: data.runtime_key,
        reasons: data.reasons,
        cost: data.cost,
        alternatives: data.alternatives?.map((a) => ({
          modelKey: a.model_key,
          harnessKey: a.harness_key,
          score: a.score,
        })),
      }
    } catch (error) {
      if (this.allowFallback && error instanceof TypeError) return this.fallback.estimate(task, prefs)
      throw error
    }
  }

  async startRun(input: {
    projectId: string
    task: string
    agentId?: string
    modelKey?: ModelKey
    modelId?: string
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
    repo?: string
    approvalId?: string
    reviewProviderKey?: CodingProvider
  }): Promise<{ runId: string; sessionId: string; mode?: string; route?: RouteEstimate }> {
    if (!(await this.healthy())) {
      if (this.allowFallback) return this.fallback.startRun(input)
      throw new Error(`OpenSaddle control plane unavailable at ${this.baseUrl}`)
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/runs`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          project_id: input.projectId,
          task: input.task,
          agent_id: input.agentId,
          model_key: input.modelKey,
          model_id: input.modelId,
          harness_key: input.harnessKey,
          provider_key: input.providerKey,
          runtime_key: input.runtimeKey,
          repo: input.repo,
          approval_id: input.approvalId,
          review_provider_key: input.reviewProviderKey,
        }),
      })
      if (!res.ok) throw await this.responseError(res)
      const data = await res.json() as {
        run_id: string
        session_id: string
        mode?: string
        route?: RouteEstimate
      }
      return { runId: data.run_id, sessionId: data.session_id, mode: data.mode, route: data.route }
    } catch (error) {
      if (this.allowFallback && error instanceof TypeError) return this.fallback.startRun(input)
      throw error
    }
  }

  async resolveDiff(
    runId: string,
    filePath: string,
    hunkIndex: number,
    decision: 'accepted' | 'rejected',
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/runs/${runId}/diff`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ file_path: filePath, hunk_index: hunkIndex, decision }),
    })
    if (!response.ok) throw await this.responseError(response)
  }

  async listOpenRouterFreeModels(): Promise<Array<{ id: string; name: string; contextLength?: number }>> {
    const response = await fetch(`${this.baseUrl}/api/models/openrouter/free`, { headers: this.headers() })
    if (!response.ok) throw await this.responseError(response)
    const body = await response.json() as {
      models?: Array<{ id: string; name: string; contextLength?: number }>
    }
    return body.models ?? []
  }

  async generateSite(input: { projectId: string; prompt: string }) {
    const response = await fetch(`${this.baseUrl}/api/sites/generate`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ project_id: input.projectId, prompt: input.prompt }),
    })
    if (!response.ok) throw await this.responseError(response)
    const body = await response.json() as {
      draft: {
        name: string
        description: string
        slug: string
        accent: string
        pages: Array<{
          id: string
          title: string
          body: string
          eyebrow?: string
          ctaLabel?: string
          ctaUrl?: string
          agentRail: boolean
          sections?: Array<{ id: string; title: string; body: string }>
        }>
      }
    }
    return body.draft
  }

  subscribe(runId: string, onEvent: (event: SessionEvent) => void): () => void {
    const url = `${this.baseUrl}/api/runs/${runId}/events`
    const controller = new AbortController()
    let fallbackStop: (() => void) | null = null
    let lastSequence = -1
    const emit = (event: SessionEvent) => {
      if (event.sequence <= lastSequence) return
      lastSequence = event.sequence
      onEvent(event)
    }

    void (async () => {
      if (!(await this.healthy())) {
        if (this.allowFallback) fallbackStop = this.fallback.subscribe(runId, onEvent)
        return
      }
      try {
        // Reconcile durable events in parallel with SSE. This closes the small
        // attach race for very fast local models and survives proxy buffering.
        void (async () => {
          while (!controller.signal.aborted) {
            try {
              const snapshot = await fetch(`${this.baseUrl}/api/runs/${runId}`, {
                headers: this.headers(),
                signal: controller.signal,
              })
              if (snapshot.ok) {
                const run = await snapshot.json() as {
                  status?: string
                  events?: SessionEvent[]
                }
                for (const event of run.events ?? []) emit(event)
                if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return
              }
            } catch {
              if (controller.signal.aborted) return
            }
            await new Promise((resolve) => window.setTimeout(resolve, 350))
          }
        })()
        const res = await fetch(url, {
          headers: this.headers(),
          signal: controller.signal,
        })
        if (!res.ok) throw await this.responseError(res)
        if (!res.body) throw new Error('Run event stream has no body')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const data = frame.split('\n').find((line) => line.startsWith('data: '))
            if (!data) continue
            try {
              emit(JSON.parse(data.slice(6)) as SessionEvent)
            } catch {
              // Ignore malformed frames without dropping the stream.
            }
          }
        }
        // A very fast local run can finish while the browser is attaching to
        // SSE. Reconcile once from durable state so no final deltas are lost.
        if (!controller.signal.aborted) {
          const snapshot = await fetch(`${this.baseUrl}/api/runs/${runId}`, {
            headers: this.headers(),
            signal: controller.signal,
          })
          if (snapshot.ok) {
            const run = await snapshot.json() as { events?: SessionEvent[] }
            for (const event of run.events ?? []) emit(event)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && lastSequence < 0 && this.allowFallback && error instanceof TypeError) {
          fallbackStop = this.fallback.subscribe(runId, onEvent)
        }
      }
    })()

    return () => {
      controller.abort()
      fallbackStop?.()
    }
  }

  async cancel(runId: string): Promise<void> {
    if (await this.healthy()) {
      try {
        const res = await fetch(`${this.baseUrl}/api/runs/${runId}/cancel`, {
          method: 'POST',
          headers: this.headers(),
        })
        if (!res.ok) throw await this.responseError(res)
        return
      } catch (error) {
        if (!this.allowFallback || !(error instanceof TypeError)) throw error
      }
    }
    return this.fallback.cancel(runId)
  }

  async requestApproval(input: {
    projectId: string
    agentId?: string
    action: string
  }): Promise<{ id: string; status: 'pending' | 'approved' | 'denied' | 'consumed' }> {
    const res = await fetch(`${this.baseUrl}/api/approvals`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        project_id: input.projectId,
        agent_id: input.agentId,
        action: input.action,
      }),
    })
    if (!res.ok) throw await this.responseError(res)
    return await res.json() as { id: string; status: 'pending' | 'approved' | 'denied' | 'consumed' }
  }

  async resolveApproval(approvalId: string, allow: boolean): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/approvals/${encodeURIComponent(approvalId)}/resolve`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ allow }),
    })
    if (!res.ok) throw await this.responseError(res)
  }
}
