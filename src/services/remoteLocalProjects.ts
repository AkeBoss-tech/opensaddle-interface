import type {
  HarnessCapability,
  LocalProjectClient,
  LocalSessionSummary,
  ManagedArtifactArchive,
  ProjectArtifactManifest,
  ProjectFileEntry,
} from './contracts'

export class RemoteLocalProjectClient implements LocalProjectClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string

  constructor(baseUrl: string, getUserId: () => string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getUserId = getUserId
    this.token = token
  }

  private headers(): Record<string, string> {
    return {
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      'X-OpenSaddle-User': this.getUserId(),
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...init?.headers },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {
        error?: string
        message?: string
        reason?: string
      } | null
      throw new Error(body?.reason ?? body?.message ?? body?.error ?? `OpenSaddle HTTP ${response.status}`)
    }
    return await response.json() as T
  }

  harnessCapabilities(): Promise<{ generatedAt: string; harnesses: HarnessCapability[] }> {
    return this.request('/api/harness-capabilities')
  }

  refreshHarnessCapabilities(): Promise<{ generatedAt: string; harnesses: HarnessCapability[] }> {
    return this.request('/api/harness-capabilities/refresh', { method: 'POST' })
  }

  async localSessions(provider?: LocalSessionSummary['provider']): Promise<LocalSessionSummary[]> {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : ''
    const result = await this.request<{ sessions: LocalSessionSummary[] }>(`/api/local-sessions${query}`)
    return result.sessions
  }

  listFiles(projectId: string, input: { path?: string; limit?: number } = {}) {
    const query = new URLSearchParams()
    if (input.path) query.set('path', input.path)
    if (input.limit) query.set('limit', String(input.limit))
    return this.request<{
      root: string
      path: string
      entries: ProjectFileEntry[]
      truncated: boolean
    }>(`${this.projectPath(projectId, 'files')}${query.size ? `?${query}` : ''}`)
  }

  statFile(projectId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<ProjectFileEntry & { root: string; readable: boolean }>(
      `${this.projectPath(projectId, 'file/stat')}?${query}`,
    )
  }

  readFile(projectId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<{
      root: string
      path: string
      content: string
      bytes: number
      truncated: boolean
    }>(`${this.projectPath(projectId, 'file')}?${query}`)
  }

  writeManagedArtifact(projectId: string, input: { path: string; content: string }) {
    return this.request<{ root: string; path: string; bytes: number; modifiedAt: number }>(
      this.projectPath(projectId, 'managed-artifact'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    )
  }

  archiveManagedArtifact(projectId: string, path: string) {
    return this.request<{ root: string; path: string; archivedPath: string; archivedAt: number }>(
      this.projectPath(projectId, 'managed-artifact/archive'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      },
    )
  }

  async listManagedArchives(projectId: string) {
    const response = await this.request<{ archives: ManagedArtifactArchive[] }>(
      this.projectPath(projectId, 'managed-artifact/archive'),
    )
    return response.archives
  }

  restoreManagedArtifact(projectId: string, archivedPath: string) {
    return this.request<{ root: string; path: string; archivedPath: string; restoredAt: number }>(
      this.projectPath(projectId, 'managed-artifact/restore'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived_path: archivedPath }),
      },
    )
  }

  searchFiles(projectId: string, queryText: string, limit?: number) {
    const query = new URLSearchParams({ q: queryText })
    if (limit) query.set('limit', String(limit))
    return this.request<{
      root: string
      query: string
      matches: Array<{ path: string; line: number; column: number; preview: string }>
      scannedFiles: number
      scannedBytes: number
      truncated: boolean
    }>(`${this.projectPath(projectId, 'search')}?${query}`)
  }

  rescan(projectId: string): Promise<ProjectArtifactManifest> {
    return this.request(this.projectPath(projectId, 'rescan'), { method: 'POST' })
  }

  private projectPath(projectId: string, suffix: string): string {
    return `/api/projects/${encodeURIComponent(projectId)}/${suffix}`
  }
}
