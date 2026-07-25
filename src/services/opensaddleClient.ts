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
  resource_selectors?: string[]
}

const ACTION_KEYS = new Set<keyof DaemonAction>(['operation_id', 'input_ref', 'resource_selectors'])
const OPERATION_REF = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]*$/
const SELECTOR_REF = /^[A-Za-z0-9][A-Za-z0-9_.:@/*-]*$/

export function validateDaemonAction(action: DaemonAction): DaemonAction {
  if (!action || typeof action !== 'object') throw new Error('OpenSaddle action manifest is required')
  for (const key of Object.keys(action)) {
    if (!ACTION_KEYS.has(key as keyof DaemonAction)) throw new Error(`OpenSaddle action field is not allowed: ${key}`)
  }
  if (typeof action.operation_id !== 'string' || action.operation_id.length < 1 || action.operation_id.length > 128 || !OPERATION_REF.test(action.operation_id)) {
    throw new Error('OpenSaddle operation_id must be a bounded opaque reference')
  }
  if (action.input_ref !== undefined && (typeof action.input_ref !== 'string' || action.input_ref.length < 1 || action.input_ref.length > 256 || !OPERATION_REF.test(action.input_ref))) {
    throw new Error('OpenSaddle input_ref must be a bounded opaque reference')
  }
  const selectors = action.resource_selectors ?? []
  if (!Array.isArray(selectors) || selectors.length > 32 || selectors.some((selector) => typeof selector !== 'string' || selector.length < 1 || selector.length > 256 || !SELECTOR_REF.test(selector))) {
    throw new Error('OpenSaddle resource_selectors must be bounded opaque references')
  }
  if (action.input_ref !== undefined && typeof action.input_ref !== 'string') throw new Error('OpenSaddle action field must be a string: input_ref')
  return { ...action, resource_selectors: selectors }
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

export interface DaemonBridge {
  capabilities(): Promise<unknown>
  createRun(request: unknown): Promise<unknown>
  getRun(runId: string): Promise<unknown>
  cancelRun(runId: string): Promise<unknown>
  listEvents(runId: string, afterSequence: number): Promise<unknown>
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
  const knownTypes: SessionEvent['type'][] = ['session.created', 'session.attached', 'agent.started', 'agent.output.delta', 'agent.input.requested', 'user.input.submitted', 'tool.requested', 'tool.completed', 'approval.requested', 'approval.resolved', 'file.changed', 'diff.updated', 'review.started', 'review.completed', 'review.failed', 'verification.started', 'verification.completed', 'agent.paused', 'agent.resumed', 'agent.completed', 'agent.failed', 'session.closed']
  return {
    event_id: event.event_id,
    session_id: runId,
    run_id: runId,
    sequence: event.sequence,
    timestamp: event.created_at,
    type: knownTypes.includes(event.kind as SessionEvent['type']) ? event.kind as SessionEvent['type'] : 'daemon.status',
    payload: event.kind === 'run.admitted' ? { ...event.payload, status: 'admitted' } : event.payload,
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
      if (!response.ok) {
        if (response.status === 503) throw new DaemonUnavailableError('OpenSaddle daemon unavailable (HTTP 503)')
        throw new Error(`OpenSaddle daemon HTTP ${response.status}`)
      }
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

/** Adapts the already-authenticated Electron IPC bridge; credentials stay in main. */
export function createIpcDaemonTransport(bridge: DaemonBridge): DaemonTransport {
  return {
    capabilities: () => bridge.capabilities() as Promise<DaemonCapabilities>,
    createRun: (request) => { validateDaemonAction(request.action); return bridge.createRun(request) as Promise<DaemonRun> },
    getRun: (runId) => bridge.getRun(runId) as Promise<DaemonRun>,
    cancelRun: (runId) => bridge.cancelRun(runId) as Promise<DaemonRun>,
    listEvents: async (runId, after) => (await bridge.listEvents(runId, after) as { events: DaemonEvent[] }).events,
  }
}

export function unavailableDaemonTransport(): DaemonTransport {
  const unavailable = async (): Promise<never> => { throw new DaemonUnavailableError() }
  return { capabilities: unavailable, createRun: unavailable, getRun: unavailable, cancelRun: unavailable, listEvents: unavailable }
}

/** Presentation-only client. In daemon mode, every execution operation goes through the daemon. */
export class OpenSaddleRuntimeClient implements RuntimeClient {
  private readonly transport: DaemonTransport

  constructor(endpoint: string, _fallback?: RuntimeClient, options: {
    token?: string
    allowFallback?: boolean
    /** Retained for source compatibility; daemon identity is token-bound. */
    getUserId?: () => string
    transport?: DaemonTransport
  } = {}) {
    this.transport = options.transport ?? createHttpDaemonTransport(endpoint, options.token)
  }

  async capabilities(): Promise<DaemonCapabilities> { return this.transport.capabilities() }

  async estimate(task: string, prefs?: { projectId?: string; routingPref?: string; modelKey?: ModelKey; modelId?: string; harnessKey?: Harness; providerKey?: CodingProvider; runtimeKey?: RuntimeKind }): Promise<RouteEstimate> {
    void task; void prefs
    throw new DaemonUnavailableError('OpenSaddle daemon does not expose client-side route estimation')
  }

  async startRun(input: { projectId: string; task: string; agentId?: string; modelKey?: ModelKey; modelId?: string; harnessKey?: Harness; providerKey?: CodingProvider; runtimeKey?: RuntimeKind; repo?: string; approvalId?: string; reviewProviderKey?: CodingProvider }): Promise<{ runId: string; sessionId: string; mode?: string }> {
    const result = await this.transport.createRun({
      client_id: undefined,
      agent: { id: input.agentId ?? 'opensaddle-interface' },
      project: { id: input.projectId },
      runner: { id: input.providerKey ?? input.harnessKey ?? 'opensaddle' },
      // The v1 daemon is non-dispatching: pass only an opaque reference, never prompt content.
      action: { operation_id: 'run', input_ref: 'client-input:opaque', resource_selectors: input.repo ? [input.repo.replace(/^\/+/, '')] : [] },
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
        if (!stopped) onEvent({ event_id: `daemon-error:${runId}`, session_id: runId, run_id: runId, sequence: cursor + 1, timestamp: new Date().toISOString(), type: 'daemon.status', payload: { status: 'unavailable', error: error instanceof Error ? error.message : String(error) } })
      }
    }
    void replay()
    return () => { stopped = true }
  }

  async cancel(runId: string): Promise<void> {
    await this.transport.cancelRun(runId)
  }
}
