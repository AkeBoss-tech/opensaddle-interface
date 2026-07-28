import type {
  HarnessCapability,
  LocalProjectClient,
  LocalSessionSummary,
  ManagedArtifactArchive,
  ProjectArtifactManifest,
  ProjectFileEntry,
  RegisteredLocalProject,
} from './contracts'

type Fetcher = typeof fetch

type DomainProject = {
  project_id: string
  root: string
  created_at: string
}

type DomainFileEntry = {
  path: string
  kind: 'file' | 'directory'
  size: number | null
  modified_ns: number
}

type DomainHarness = {
  id: string
  display_name: string
  installed: boolean
  executable_path?: string | null
  version?: string | null
  auth_state?: 'authenticated' | 'unauthenticated' | 'configured' | 'not_detected' | 'unknown'
  readiness?: 'ready' | 'needs_auth' | 'unknown' | 'unavailable'
  readiness_reason?: string | null
  models?: Array<{
    id: string
    display_name?: string
    description?: string | null
    is_default?: boolean
    configured?: boolean
    source?: 'account' | 'cli_alias' | 'configured'
    reasoning_efforts?: string[]
    default_reasoning_effort?: string | null
    input_modalities?: string[]
  }>
  capabilities?: {
    streaming?: boolean | null
    tool_support?: boolean | null
    mcp?: boolean | null
    skills?: boolean | null
    reasoning_efforts?: string[]
    context_limit?: number | null
    permission_modes?: string[]
  }
  login_guidance?: string | null
}

type DomainRescan = {
  project_id: string
  discoveries: Partial<Record<'instructions' | 'skills' | 'mcp_configs' | 'sites' | 'documentation', string[]>>
}

const HARNESS_ID_ALIASES: Record<string, string> = {
  'claude-code': 'claude',
}

function harnessFromDomain(value: DomainHarness): HarnessCapability {
  const authState = value.auth_state === 'configured' || value.auth_state === 'authenticated'
    ? 'configured'
    : value.auth_state === 'not_detected' || value.auth_state === 'unauthenticated'
      ? 'not_detected'
      : 'unknown'
  const availability = value.installed ? 'available' : 'missing'
  const capability = value.capabilities ?? {}
  const readiness = !value.installed
    ? 'unavailable'
    : value.readiness
      ?? (authState === 'configured'
        ? 'ready'
        : authState === 'not_detected'
          ? 'needs_auth'
          : 'unknown')
  return {
    id: HARNESS_ID_ALIASES[value.id] ?? value.id,
    label: value.display_name,
    description: value.installed
      ? `${value.display_name} discovered by the local OpenSaddle service.`
      : `${value.display_name} is not installed on this machine.`,
    kind: 'cli',
    availability,
    readiness,
    command: value.executable_path?.split('/').at(-1),
    resolvedPath: value.executable_path ?? undefined,
    version: value.version ?? undefined,
    unavailableReason: value.readiness_reason
      ?? (value.installed ? undefined : 'Executable was not found on PATH.'),
    auth: {
      state: authState,
      message: readiness === 'unavailable'
        ? value.readiness_reason ?? undefined
        : value.login_guidance ?? undefined,
      setupCommand: readiness === 'needs_auth'
        ? value.login_guidance ?? undefined
        : undefined,
    },
    models: (value.models ?? []).map((model) => ({
      id: model.id,
      configured: model.configured ?? model.source !== 'cli_alias',
      displayName: model.display_name,
      description: model.description ?? undefined,
      isDefault: model.is_default,
      source: model.source,
      reasoningEfforts: model.reasoning_efforts,
      defaultReasoningEffort: model.default_reasoning_effort ?? undefined,
      inputModalities: model.input_modalities,
    })),
    capabilities: {
      streaming: capability.streaming === true,
      tools: capability.tool_support === true,
      mcp: capability.mcp === true,
      skills: capability.skills === true,
      reasoningControls: Boolean(capability.reasoning_efforts?.length),
      reasoningEfforts: capability.reasoning_efforts,
      contextMetadata: capability.context_limit !== undefined && capability.context_limit !== null,
      cancellation: false,
      policyControls: capability.permission_modes?.length ? 'provider-defined' : 'provider-defined',
    },
  }
}

function fileEntry(value: DomainFileEntry): ProjectFileEntry {
  return {
    path: value.path,
    name: value.path.split('/').at(-1) ?? value.path,
    kind: value.kind,
    size: value.size,
    modifiedAt: Math.floor(value.modified_ns / 1_000_000),
  }
}

function artifact(path: string, kind: ProjectArtifactManifest['artifacts'][number]['kind']) {
  const parts = path.split('/')
  return {
    kind,
    path,
    name: parts.at(-1) ?? path,
    modifiedAt: null,
    location: parts.slice(0, -1).join('/') || '.',
  }
}

/** Thrown when the legacy LocalProjectClient surface has no equivalent in the
 * authoritative Python project domain. It deliberately prevents the renderer
 * from displaying a simulated archive, search result, or native session. */
export class UnsupportedAuthoritativeProjectOperationError extends Error {
  constructor(operation: string) {
    super(`${operation} is not provided by the authoritative OpenSaddle project API.`)
  }
}

/**
 * Adapter for the Python daemon's authoritative `/api/projects` resources.
 *
 * This is intentionally separate from RemoteLocalProjectClient: the legacy
 * Node sidecar returns a UI-shaped local-project API, while the Python daemon
 * returns durable project-domain records and raw file bodies.
 */
export class AuthoritativeLocalProjectClient implements LocalProjectClient {
  readonly supportsManagedArchives = false
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string
  private readonly fetchImpl: Fetcher
  private readonly roots = new Map<string, string>()

  constructor(baseUrl: string, getUserId: () => string, token?: string, fetchImpl?: Fetcher) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getUserId = getUserId
    this.token = token
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  private headers(extra: HeadersInit = {}): Headers {
    const headers = new Headers(extra)
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    headers.set('X-OpenSaddle-User', this.getUserId())
    return headers
  }

  private async error(response: Response): Promise<Error> {
    const body = await response.json().catch(() => null) as { detail?: string; error?: string; message?: string } | null
    return new Error(body?.detail ?? body?.message ?? body?.error ?? `OpenSaddle HTTP ${response.status}`)
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers(init?.headers),
    })
    if (!response.ok) throw await this.error(response)
    return await response.json() as T
  }

  private async root(projectId: string): Promise<string> {
    const cached = this.roots.get(projectId)
    if (cached) return cached
    const project = await this.request<DomainProject>(`/api/projects/${encodeURIComponent(projectId)}`)
    this.roots.set(projectId, project.root)
    return project.root
  }

  private projectPath(projectId: string, suffix = ''): string {
    return `/api/projects/${encodeURIComponent(projectId)}${suffix ? `/${suffix}` : ''}`
  }

  async registerProject(projectId: string, root: string): Promise<{ projectId: string; root: string }> {
    const project = await this.request<DomainProject>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, root }),
    })
    this.roots.set(project.project_id, project.root)
    return { projectId: project.project_id, root: project.root }
  }

  async listProjects(): Promise<RegisteredLocalProject[]> {
    const response = await this.request<{ projects?: DomainProject[] }>('/api/projects')
    return (response.projects ?? []).map((project) => {
      this.roots.set(project.project_id, project.root)
      const createdAt = Date.parse(project.created_at)
      return {
        projectId: project.project_id,
        root: project.root,
        createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      }
    })
  }

  async harnessCapabilities(): Promise<{ generatedAt: string; harnesses: HarnessCapability[] }> {
    const response = await this.request<{ harnesses?: DomainHarness[] }>('/api/harnesses')
    return { generatedAt: new Date().toISOString(), harnesses: (response.harnesses ?? []).map(harnessFromDomain) }
  }

  refreshHarnessCapabilities(): Promise<{ generatedAt: string; harnesses: HarnessCapability[] }> {
    return this.request<{ harnesses?: DomainHarness[] }>('/api/harnesses?refresh=true')
      .then((response) => ({
        generatedAt: new Date().toISOString(),
        harnesses: (response.harnesses ?? []).map(harnessFromDomain),
      }))
  }

  async localSessions(_provider?: LocalSessionSummary['provider']): Promise<LocalSessionSummary[]> {
    throw new UnsupportedAuthoritativeProjectOperationError('Native session discovery')
  }

  async listFiles(projectId: string, input: { path?: string; limit?: number } = {}) {
    const query = new URLSearchParams()
    if (input.path) query.set('path', input.path)
    const [root, result] = await Promise.all([
      this.root(projectId),
      this.request<{ path: string; items: DomainFileEntry[] }>(`${this.projectPath(projectId, 'files')}${query.size ? `?${query}` : ''}`),
    ])
    const requestedLimit = input.limit === undefined ? result.items.length : Math.max(1, input.limit)
    return {
      root,
      path: result.path,
      entries: result.items.slice(0, requestedLimit).map(fileEntry),
      truncated: result.items.length > requestedLimit,
    }
  }

  async statFile(projectId: string, path: string) {
    const [root, result] = await Promise.all([
      this.root(projectId),
      this.request<{ items: DomainFileEntry[] }>(`${this.projectPath(projectId, 'files')}?${new URLSearchParams({ path })}`),
    ])
    const item = result.items.find((candidate) => candidate.path === path)
    if (!item) throw new Error(`OpenSaddle project file was not found: ${path}`)
    const entry = fileEntry(item)
    return { root, ...entry, readable: entry.kind === 'file' }
  }

  async readFile(projectId: string, path: string) {
    const [root, response] = await Promise.all([
      this.root(projectId),
      this.fetchImpl(`${this.baseUrl}${this.projectPath(projectId, 'file')}?${new URLSearchParams({ path })}`, { headers: this.headers() }),
    ])
    if (!response.ok) throw await this.error(response)
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      root,
      path: response.headers.get('X-OpenSaddle-File-Path') ?? path,
      content: new TextDecoder().decode(bytes),
      bytes: bytes.byteLength,
      truncated: false,
    }
  }

  async writeManagedArtifact(projectId: string, input: { path: string; content: string }) {
    const [root, result] = await Promise.all([
      this.root(projectId),
      this.request<{ path: string; size: number }>(
        `${this.projectPath(projectId, 'file')}?${new URLSearchParams({ path: input.path })}`,
        { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: input.content },
      ),
    ])
    return { root, path: result.path, bytes: result.size, modifiedAt: Date.now() }
  }

  async archiveManagedArtifact(_projectId: string, _path: string): Promise<{
    root: string
    path: string
    archivedPath: string
    archivedAt: number
  }> {
    throw new UnsupportedAuthoritativeProjectOperationError('Managed artifact archive')
  }

  async listManagedArchives(_projectId: string): Promise<ManagedArtifactArchive[]> {
    throw new UnsupportedAuthoritativeProjectOperationError('Managed artifact archive listing')
  }

  async restoreManagedArtifact(_projectId: string, _archivedPath: string): Promise<{
    root: string
    path: string
    archivedPath: string
    restoredAt: number
  }> {
    throw new UnsupportedAuthoritativeProjectOperationError('Managed artifact restore')
  }

  async searchFiles(_projectId: string, _query: string, _limit?: number): Promise<{
    root: string
    query: string
    matches: Array<{ path: string; line: number; column: number; preview: string }>
    scannedFiles: number
    scannedBytes: number
    truncated: boolean
  }> {
    throw new UnsupportedAuthoritativeProjectOperationError('Project file search')
  }

  async rescan(projectId: string): Promise<ProjectArtifactManifest> {
    const [root, result] = await Promise.all([
      this.root(projectId),
      this.request<DomainRescan>(this.projectPath(projectId, 'rescan'), { method: 'POST' }),
    ])
    const artifacts = [
      ...(result.discoveries.instructions ?? []).map((path) => artifact(path, 'instruction')),
      ...(result.discoveries.skills ?? []).map((path) => artifact(path, 'skill')),
      ...(result.discoveries.documentation ?? []).map((path) => artifact(path, 'documentation')),
      ...(result.discoveries.sites ?? []).map((path) => artifact(path, 'site')),
    ]
    const counts: ProjectArtifactManifest['counts'] = { instruction: 0, skill: 0, agent: 0, documentation: 0, site: 0 }
    for (const item of artifacts) counts[item.kind] += 1
    return { root, generatedAt: Date.now(), artifacts, counts, truncated: false }
  }
}
