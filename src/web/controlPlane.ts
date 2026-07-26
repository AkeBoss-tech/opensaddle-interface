import type { AppData } from '../types'

export interface ControlPlaneHealth {
  ok: boolean
  service: string
  mode: 'local' | 'company'
  runtime_provider: string
  configured_models: string[]
  model_provider: string
  storage?: { engine?: string; workspace_documents?: number }
}

export interface ControlPlaneRuntime {
  id: string
  kind: string
  status: 'provisioning' | 'running' | 'stopped' | 'failed'
  projectId: string
  ownerId: string
  createdAt: number
  expiresAt: number
}

export interface ServerWorkspace {
  workspace: AppData
  updatedAt?: number
  documents?: number
  storage?: string
}

export interface WebConnection {
  baseUrl: string
  token?: string
  userId: string
}

export interface WorkspaceSnapshot {
  health: ControlPlaneHealth
  workspace: ServerWorkspace
  runtimes: ControlPlaneRuntime[]
}

function headers(connection: WebConnection): HeadersInit {
  return {
    'X-OpenSaddle-User': connection.userId,
    ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
  }
}

async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: string; message?: string } | null
  return new Error(body?.message ?? body?.error ?? `OpenSaddle HTTP ${response.status}`)
}

async function get<T>(connection: WebConnection, path: string, authenticated = true): Promise<T> {
  const response = await fetch(`${connection.baseUrl.replace(/\/$/, '')}${path}`, {
    headers: authenticated ? headers(connection) : undefined,
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<T>
}

/**
 * Read-only browser projection of the same workspace, artifact, and runtime
 * records used by the Electron renderer.  Nothing here is cached or written
 * in browser storage: the control plane is the source of truth.
 */
export async function loadWorkspaceSnapshot(connection: WebConnection): Promise<WorkspaceSnapshot> {
  const health = await get<ControlPlaneHealth>(connection, '/api/health', false)
  const [workspace, runtimes] = await Promise.all([
    get<ServerWorkspace>(connection, '/api/workspace'),
    get<ControlPlaneRuntime[]>(connection, '/api/runtimes'),
  ])
  return { health, workspace, runtimes }
}
