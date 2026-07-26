/**
 * Typed, opt-in client for the durable OpenSaddle control-plane v2 API.
 *
 * This intentionally does not implement RuntimeClient and is not wired into
 * the application service bundle.  The legacy daemon routes use different
 * request and event contracts; callers must choose this client explicitly.
 */

export type ControlPlaneRole = 'owner' | 'admin' | 'member' | 'requester' | 'approver' | 'auditor' | 'worker'
export type SourceKind = 'uploaded_snapshot' | 'connected_revision'
export type AuthorityMode = 'source_managed' | 'opensaddle_managed' | 'hybrid'
export type ExternalHarness = 'codex' | 'claude_code' | 'other'

export interface ControlPlaneCapabilities {
  api_version: 'v2'
  durable_runs: boolean
  event_replay: boolean
  authenticated_subject: string
  connectors: string[]
}

export interface ControlPlaneProject {
  project_id: string
  created_by: string
  created_at: string
}

export interface ControlPlaneSource {
  source_id: string
  project_id: string
  source_kind: SourceKind
  revision: string
  snapshot_digest: string
  created_by: string
  created_at: string
}

export interface ControlPlanePolicy {
  policy_id: string
  policy_version: string
  policy_hash: string
  obligations: Record<string, unknown>
}

export interface ControlPlaneRun {
  run_id: string
  project_id: string
  source_ref: string
  task: string
  requested_by: string
  status: string
  policy: ControlPlanePolicy
  cancellation_requested: boolean
  created_at: string
  updated_at: string
}

export interface ControlPlaneEvent {
  event_id: string
  run_id: string
  sequence: number
  type: string
  payload: Record<string, unknown>
  timestamp: string
}

export interface ControlPlaneExternalSession {
  session_id: string
  project_id: string
  harness: ExternalHarness
  external_session_id: string
  transcript_locator: string
  workspace_locator: string | null
  authority_mode: AuthorityMode
  source_capabilities: Record<string, boolean>
  checkpoint_digest: string | null
  authority_snapshot: Record<string, unknown>
  authority_hash: string
  created_by: string
  created_at: string
  updated_at: string
}

export class ControlPlaneV2Error extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `OpenSaddle control plane HTTP ${status}`)
    this.name = 'ControlPlaneV2Error'
    this.status = status
    this.detail = detail
  }
}

export interface ControlPlaneV2ClientOptions {
  /** Supply a bearer token, trusted-proxy assertion, or other deployment auth headers. */
  getAuthHeaders?: () => HeadersInit | Promise<HeadersInit>
  fetchImplementation?: typeof fetch
}

export class ControlPlaneV2Client {
  private readonly baseUrl: string
  private readonly getAuthHeaders: () => HeadersInit | Promise<HeadersInit>
  private readonly fetchImplementation: typeof fetch

  constructor(baseUrl: string, options: ControlPlaneV2ClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getAuthHeaders = options.getAuthHeaders ?? (() => ({}))
    this.fetchImplementation = options.fetchImplementation ?? fetch
  }

  async capabilities(): Promise<ControlPlaneCapabilities> {
    return this.request('/api/v2/capabilities')
  }

  async createProject(projectId: string): Promise<ControlPlaneProject> {
    return this.request('/api/v2/projects', { method: 'POST', body: { project_id: projectId } })
  }

  async createSource(input: {
    projectId: string
    sourceKind: SourceKind
    revision: string
    snapshotDigest: string
  }): Promise<ControlPlaneSource> {
    return this.request('/api/v2/sources', {
      method: 'POST',
      body: {
        project_id: input.projectId,
        source_kind: input.sourceKind,
        revision: input.revision,
        snapshot_digest: input.snapshotDigest,
      },
    })
  }

  async createRun(input: { projectId: string; sourceId: string; task: string }): Promise<ControlPlaneRun> {
    return this.request('/api/v2/runs', {
      method: 'POST',
      body: { project_id: input.projectId, source_id: input.sourceId, task: input.task },
    })
  }

  async getRun(runId: string): Promise<ControlPlaneRun> {
    return this.request(`/api/v2/runs/${encodeURIComponent(runId)}`)
  }

  async *events(runId: string, options: { afterSequence?: number; signal?: AbortSignal } = {}): AsyncGenerator<ControlPlaneEvent> {
    const query = new URLSearchParams()
    if (options.afterSequence !== undefined) query.set('after_sequence', String(options.afterSequence))
    const suffix = query.size ? `?${query}` : ''
    const response = await this.send(`/api/v2/runs/${encodeURIComponent(runId)}/events${suffix}`, {
      headers: { Accept: 'text/event-stream' },
      signal: options.signal,
    })
    if (!response.ok) throw await this.toError(response)
    if (!response.body) throw new Error('OpenSaddle control plane returned an empty event stream')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        buffer += decoder.decode(next.value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
          if (data) yield JSON.parse(data) as ControlPlaneEvent
        }
      }
      buffer += decoder.decode()
      const data = buffer.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
      if (data) yield JSON.parse(data) as ControlPlaneEvent
    } finally {
      reader.releaseLock()
    }
  }

  async createExternalSession(input: {
    projectId: string
    harness: ExternalHarness
    externalSessionId: string
    transcriptLocator: string
    workspaceLocator?: string | null
    authorityMode: AuthorityMode
    sourceCapabilities?: Record<string, boolean>
  }): Promise<ControlPlaneExternalSession> {
    return this.request('/api/v2/external-sessions', {
      method: 'POST',
      body: {
        project_id: input.projectId,
        harness: input.harness,
        external_session_id: input.externalSessionId,
        transcript_locator: input.transcriptLocator,
        workspace_locator: input.workspaceLocator ?? null,
        authority_mode: input.authorityMode,
        source_capabilities: input.sourceCapabilities ?? {},
      },
    })
  }

  async listExternalSessions(projectId: string): Promise<ControlPlaneExternalSession[]> {
    const response = await this.request<{ project_id: string; external_sessions: ControlPlaneExternalSession[] }>(`/api/v2/projects/${encodeURIComponent(projectId)}/external-sessions`)
    return response.external_sessions
  }

  async checkpointExternalSession(input: {
    sessionId: string
    checkpointDigest: string
    authorityMode: AuthorityMode
  }): Promise<ControlPlaneExternalSession> {
    return this.request(`/api/v2/external-sessions/${encodeURIComponent(input.sessionId)}/checkpoint`, {
      method: 'POST',
      body: { checkpoint_digest: input.checkpointDigest, authority_mode: input.authorityMode },
    })
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await this.send(path, {
      method: init.method,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    })
    if (!response.ok) throw await this.toError(response)
    return await response.json() as T
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(await this.getAuthHeaders())
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    return this.fetchImplementation(`${this.baseUrl}${path}`, { ...init, headers })
  }

  private async toError(response: Response): Promise<ControlPlaneV2Error> {
    let detail: unknown
    try {
      detail = (await response.json() as { detail?: unknown }).detail
    } catch {
      detail = undefined
    }
    return new ControlPlaneV2Error(response.status, detail)
  }
}
