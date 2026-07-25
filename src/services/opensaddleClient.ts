import type { RuntimeClient, RouteEstimate, SessionEvent } from './contracts'
import type { CodingProvider, Harness, ModelKey, RuntimeKind } from '../types'

export const DAEMON_API_VERSION = 'v1'

export interface DaemonCapabilities {
  service: string
  capabilities: string[]
  runtime_api?: { version: string; dispatch: boolean }
}

export interface DaemonRunRequest {
  client_id?: string
  agent: { id: string }
  project: { id: string }
  runner: { id: string }
  action: DaemonAction
  permission: { action: string; resource?: string; command?: string; path?: string }
  approval_id?: string
}

/** Admission input is intentionally a small, non-content-bearing action descriptor. */
export interface DaemonAction {
  operation_id: string
  input_ref?: string
  resource_selectors: string[]
}

const ACTION_KEYS = new Set<keyof DaemonAction>(['operation_id', 'input_ref', 'resource_selectors'])

export function validateDaemonAction(action: DaemonAction): DaemonAction {
  if (!action || typeof action !== 'object' || typeof action.operation_id !== 'string' || action.operation_id.length === 0 || !Array.isArray(action.resource_selectors) || action.resource_selectors.some((selector) => typeof selector !== 'string')) {
    throw new Error('OpenSaddle action requires operation_id and string resource_selectors')
  }
  for (const key of Object.keys(action)) {
    if (!ACTION_KEYS.has(key as keyof DaemonAction)) throw new Error(`OpenSaddle action field is not allowed: ${key}`)
    if (key !== 'resource_selectors' && typeof action[key as keyof DaemonAction] !== 'string') throw new Error(`OpenSaddle action field must be a string: ${key}`)
  }
  return action
}

export interface DaemonRun {
  run_id: string
  status: string
  action_digest?: string | null
}

export interface DaemonEvent {
  event_id: string
  sequence: number
  kind: string
  payload: Record<string, unknown>
  created_at: string
}

export class DaemonUnavailableError extends Error {
  readonly code = 'DAEMON_UNAVAILABLE'
  constructor(message = 'OpenSaddle daemon unavailable; execution authority is not configured') {
    super(message)
    this.name = 'DaemonUnavailableError'
  }
}

export function validateDaemonEndpoint(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('OpenSaddle endpoint must be a valid loopback URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('OpenSaddle endpoint must be an HTTP(S) URL without credentials, query, or hash')
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('OpenSaddle endpoint must target loopback')
  }
  return url.toString().replace(/\/$/, '')
}

function eventToSessionEvent(event: DaemonEvent, runId: string): SessionEvent {
  return {
    event_id: event.event_id,
    session_id: runId,
    run_id: runId,
    sequence: event.sequence,
    timestamp: event.created_at,
    type: event.kind as SessionEvent['type'],
    payload: event.payload,
  }
}

export interface DaemonTransport {
  capabilities(): Promise<DaemonCapabilities>
  createRun(request: DaemonRunRequest): Promise<DaemonRun>
  getRun(runId: string): Promise<DaemonRun>
  cancelRun(runId: string): Promise<DaemonRun>
  listEvents(runId: string, afterSequence: number): Promise<DaemonEvent[]>
}

export function createHttpDaemonTransport(endpoint: string, token?: string, fetcher: typeof fetch = fetch): DaemonTransport {
  const baseUrl = validateDaemonEndpoint(endpoint)
  const headers = (json = false): HeadersInit => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  })
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    try {
      const response = await fetcher(`${baseUrl}${path}`, { ...init, headers: { ...headers(Boolean(init.body)), ...init.headers } })
      if (!response.ok) throw new Error(`OpenSaddle daemon HTTP ${response.status}`)
      return await response.json() as T
    } catch (error) {
      if (error instanceof TypeError || (error instanceof Error && error.message.includes('Failed to fetch'))) throw new DaemonUnavailableError()
      throw error
    }
  }
  return {
    capabilities: () => request<DaemonCapabilities>('/api/v1/capabilities'),
    createRun: (body) => {
      validateDaemonAction(body.action)
      return request<DaemonRun>('/api/v1/runs', { method: 'POST', body: JSON.stringify(body) })
    },
    getRun: (id) => request<DaemonRun>(`/api/v1/runs/${encodeURIComponent(id)}`),
    cancelRun: (id) => request<DaemonRun>(`/api/v1/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    listEvents: async (id, after) => (await request<{ events: DaemonEvent[] }>(`/api/v1/runs/${encodeURIComponent(id)}/events?after_sequence=${after}`)).events,
  }
}

/** Presentation-only client. In daemon mode, every execution operation goes through the daemon. */
export class OpenSaddleRuntimeClient implements RuntimeClient {
  private readonly fallback?: RuntimeClient
  private readonly allowFallback: boolean
  private readonly transport: DaemonTransport

  constructor(endpoint: string, fallback?: RuntimeClient, options: {
    token?: string
    allowFallback?: boolean
    /** Retained for source compatibility; daemon identity is token-bound. */
    getUserId?: () => string
    transport?: DaemonTransport
  } = {}) {
    this.transport = options.transport ?? createHttpDaemonTransport(endpoint, options.token)
    this.fallback = fallback
    this.allowFallback = options.allowFallback ?? false
  }

  private unavailable<T>(fallback: () => Promise<T>): Promise<T> {
    return this.allowFallback && this.fallback ? fallback() : Promise.reject(new DaemonUnavailableError())
  }

  async capabilities(): Promise<DaemonCapabilities> { return this.transport.capabilities() }

  async estimate(task: string, prefs?: { projectId?: string; routingPref?: string; modelKey?: ModelKey; modelId?: string; harnessKey?: Harness; providerKey?: CodingProvider; runtimeKey?: RuntimeKind }): Promise<RouteEstimate> {
    void task; void prefs
    return this.unavailable(() => this.fallback!.estimate(task, prefs))
  }

  async startRun(input: { projectId: string; task: string; agentId?: string; modelKey?: ModelKey; modelId?: string; harnessKey?: Harness; providerKey?: CodingProvider; runtimeKey?: RuntimeKind; repo?: string; approvalId?: string; reviewProviderKey?: CodingProvider }): Promise<{ runId: string; sessionId: string; mode?: string }> {
    const result = await this.transport.createRun({
      client_id: undefined,
      agent: { id: input.agentId ?? 'opensaddle-interface' },
      project: { id: input.projectId },
      runner: { id: input.providerKey ?? input.harnessKey ?? 'opensaddle' },
      // The v1 daemon is non-dispatching: pass only an opaque reference, never prompt content.
      action: { operation_id: 'run', input_ref: 'client-input:opaque', resource_selectors: input.repo ? [input.repo] : [] },
      permission: { action: 'execute', resource: input.projectId },
      approval_id: input.approvalId,
    })
    return { runId: result.run_id, sessionId: result.run_id, mode: result.status }
  }

  subscribe(runId: string, onEvent: (event: SessionEvent) => void): () => void {
    let stopped = false
    let cursor = 0
    const replay = async () => {
      try {
        while (!stopped) {
          const events = await this.transport.listEvents(runId, cursor)
          for (const event of events.sort((a, b) => a.sequence - b.sequence)) {
            if (event.sequence <= cursor) continue
            cursor = event.sequence
            onEvent(eventToSessionEvent(event, runId))
          }
          const run = await this.transport.getRun(runId)
          if (['completed', 'failed', 'cancelled', 'timed_out', 'denied'].includes(run.status)) break
          await new Promise((resolve) => setTimeout(resolve, 350))
        }
      } catch (error) {
        if (!stopped && this.allowFallback && this.fallback && error instanceof DaemonUnavailableError) this.fallback.subscribe(runId, onEvent)
      }
    }
    void replay()
    return () => { stopped = true }
  }

  async cancel(runId: string): Promise<void> {
    try { await this.transport.cancelRun(runId) }
    catch (error) { if (!(this.allowFallback && this.fallback && error instanceof DaemonUnavailableError)) throw error; await this.fallback.cancel(runId) }
  }
}
