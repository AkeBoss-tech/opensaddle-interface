export interface ProjectModelBudgetChange {
  revision: number
  previous_max_reserved_cost_microunits: number | null
  max_reserved_cost_microunits: number
  configured_by: string
  recorded_at: string
}

export interface ProjectModelBudget {
  schema_version: 'opensaddle.project-model-budget.v1'
  project_id: string
  scope: 'hosted_model_routes_only'
  viewer_role: 'owner' | 'admin' | 'member' | 'requester' | 'approver' | 'auditor' | 'worker'
  can_manage: boolean
  state: 'configured' | 'unconfigured'
  max_reserved_cost_microunits: number | null
  reserved_cost_microunits: number
  revision: number
  configured_by: string | null
  updated_at: string | null
  recent_changes: ProjectModelBudgetChange[]
}

export class ProjectModelBudgetConflict extends Error {}
export class ProjectModelBudgetDenied extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid Project model budget response')
  return value as Record<string, unknown>
}
function amount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw Error('Project model budget exceeds the safe interface integer range')
  return Number(value)
}
function boundedText(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw Error('Invalid Project model budget response')
  return value
}
function parse(value: unknown, projectId: string): ProjectModelBudget {
  const row = object(value)
  if (row.schema_version !== 'opensaddle.project-model-budget.v1' || row.project_id !== projectId
      || row.scope !== 'hosted_model_routes_only' || !['configured', 'unconfigured'].includes(String(row.state)))
    throw Error('Project model budget authority changed')
  if (!['owner', 'admin', 'member', 'requester', 'approver', 'auditor', 'worker'].includes(String(row.viewer_role)) || typeof row.can_manage !== 'boolean'
      || row.can_manage !== (row.viewer_role === 'owner' || row.viewer_role === 'admin'))
    throw Error('Invalid Project model budget authority')
  const state = row.state as ProjectModelBudget['state']
  const ceiling = row.max_reserved_cost_microunits === null ? null : amount(row.max_reserved_cost_microunits)
  const revision = amount(row.revision)
  const configuredBy = row.configured_by === null ? null : boundedText(row.configured_by)
  const updatedAt = row.updated_at === null ? null : boundedText(row.updated_at)
  if ((state === 'unconfigured') !== (ceiling === null) || (state === 'unconfigured') !== (revision === 0)
      || (state === 'unconfigured') !== (configuredBy === null) || (state === 'unconfigured') !== (updatedAt === null)
      || !Array.isArray(row.recent_changes) || row.recent_changes.length !== Math.min(revision, 20)) throw Error('Invalid Project model budget response')
  const changes = row.recent_changes.map(value => {
    const entry = object(value)
    return { revision: amount(entry.revision), previous_max_reserved_cost_microunits: entry.previous_max_reserved_cost_microunits === null ? null : amount(entry.previous_max_reserved_cost_microunits),
      max_reserved_cost_microunits: amount(entry.max_reserved_cost_microunits), configured_by: boundedText(entry.configured_by), recorded_at: boundedText(entry.recorded_at) }
  })
  if (changes.some((entry, index) => entry.revision !== revision - index)) throw Error('Invalid Project model budget history')
  return { schema_version: 'opensaddle.project-model-budget.v1', project_id: projectId, scope: 'hosted_model_routes_only',
    viewer_role: row.viewer_role as ProjectModelBudget['viewer_role'], can_manage: row.can_manage,
    state, max_reserved_cost_microunits: ceiling, reserved_cost_microunits: amount(row.reserved_cost_microunits),
    revision, configured_by: configuredBy, updated_at: updatedAt, recent_changes: changes }
}

/** Hosted Core owns the current membership and performs the atomic revision check. */
export class ProjectModelBudgetClient {
  private baseUrl: string
  private user: () => string
  private token?: string
  constructor(baseUrl: string, user: () => string, token?: string) { this.baseUrl = baseUrl; this.user = user; this.token = token }
  identity() { return this.user() }
  private async request(projectId: string, body?: { max_reserved_cost_microunits: number; expected_revision: number }): Promise<ProjectModelBudget> {
    const identity = this.identity()
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v2/projects/${encodeURIComponent(projectId)}/model-budget`, {
      method: body ? 'PUT' : 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'X-OpenSaddle-User': identity, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (response.status === 401 || response.status === 403 || response.status === 404) throw new ProjectModelBudgetDenied('Current Project membership or budget authority is unavailable. Reload after signing in.')
    if (response.status === 409) throw new ProjectModelBudgetConflict('The Project budget changed. Reload before reviewing a new limit.')
    if (!response.ok) throw Error('Project budget request is uncertain. Reload before reviewing a new limit.')
    const value: unknown = await response.json()
    if (identity !== this.identity()) throw new ProjectModelBudgetDenied('Project budget account changed. Reload after signing in.')
    return parse(value, projectId)
  }
  status(projectId: string) { return this.request(projectId) }
  configure(projectId: string, maxReservedCostMicrounits: number, expectedRevision: number) {
    amount(maxReservedCostMicrounits); amount(expectedRevision)
    return this.request(projectId, { max_reserved_cost_microunits: maxReservedCostMicrounits, expected_revision: expectedRevision })
  }
}
