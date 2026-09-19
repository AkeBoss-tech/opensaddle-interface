export interface ConnectorTarget { connector: string; secret_ref: string; display_name: string }
export interface ManagedConnection extends ConnectorTarget {
  connection_id: string
  project_id: string
  status: 'active' | 'revoked'
  revision: number
  credential_version: number
  created_at: string
  updated_at: string
}
export interface ManagedConnectionList {
  schema_version: 'opensaddle.connector-connections.v1'
  project_id: string
  viewer_role: 'owner'
  targets: ConnectorTarget[]
  connections: ManagedConnection[]
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid connection response')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw Error('Invalid connection response')
  return value
}
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw Error('Invalid connection revision')
  return Number(value)
}
function target(value: unknown): ConnectorTarget {
  const row = record(value)
  return { connector: text(row.connector), secret_ref: text(row.secret_ref), display_name: text(row.display_name) }
}
function connection(value: unknown, projectId: string): ManagedConnection {
  const row = record(value)
  if (row.project_id !== projectId || !['active', 'revoked'].includes(String(row.status))) throw Error('Connection authority changed')
  return { ...target(row), connection_id: text(row.connection_id), project_id: projectId, status: row.status as ManagedConnection['status'], revision: version(row.revision), credential_version: version(row.credential_version), created_at: text(row.created_at), updated_at: text(row.updated_at) }
}

/** Core owns secrets and dispatch authority; this client retains metadata only. */
export class ManagedConnectorConnectionsClient {
  private baseUrl: string
  private user: () => string
  private token?: string
  constructor(baseUrl: string, user: () => string, token?: string) { this.baseUrl = baseUrl; this.user = user; this.token = token }
  identity() { return this.user() }
  private async request(projectId: string, suffix = '', body?: unknown): Promise<unknown> {
    const identity = this.identity()
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v2/projects/${encodeURIComponent(projectId)}/connector-connections${suffix}`, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'X-OpenSaddle-User': identity, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    // Never render upstream error bodies: a credential submission must not echo its input.
    if (response.status === 403 || response.status === 401) throw Error('Only a current project owner can manage these connections. Reload after signing in.')
    if (response.status === 409) throw Error('The connection changed. Reload before trying again.')
    if (!response.ok) throw Error('Connection request failed. Reload to check its state before trying again.')
    const value: unknown = await response.json()
    if (identity !== this.identity()) throw Error('Connection account changed')
    return value
  }
  async list(projectId: string): Promise<ManagedConnectionList> {
    const value = record(await this.request(projectId))
    if (value.schema_version !== 'opensaddle.connector-connections.v1' || value.project_id !== projectId || value.viewer_role !== 'owner' || !Array.isArray(value.targets) || value.targets.length > 100 || !Array.isArray(value.connections) || value.connections.length > 100) throw Error('Invalid connection list')
    const connections = value.connections.map(row => connection(row, projectId))
    if (new Set(connections.map(row => row.connection_id)).size !== connections.length) throw Error('Invalid connection list')
    return { schema_version: value.schema_version, project_id: projectId, viewer_role: 'owner', targets: value.targets.map(target), connections }
  }
  async create(projectId: string, input: ConnectorTarget & { api_key: string }): Promise<ManagedConnection> {
    return connection(await this.request(projectId, '', input), projectId)
  }
  async revoke(projectId: string, id: string, revision: number): Promise<ManagedConnection> {
    const result = connection(await this.request(projectId, `/${encodeURIComponent(id)}/revoke`, { expected_revision: revision }), projectId)
    if (result.connection_id !== id || result.status !== 'revoked') throw Error('Invalid connection revocation')
    return result
  }
}
