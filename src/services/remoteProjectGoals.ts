import type { ProjectGoal, ProjectGoalClient } from './contracts'

interface GoalWire {
  goal_id: string
  project_id: string
  version: number
  revision: number
  objective: string
  acceptance_criteria: string[]
  status: ProjectGoal['status']
  policy_receipt: Record<string, unknown>
  root_thread_id?: string | null
  supervisor_run_id?: string | null
  evidence: Array<Record<string, unknown>>
  created_at: string
  updated_at: string
  available_actions?: ProjectGoal['availableActions']
}

export class GoalRevisionConflictError extends Error {
  readonly currentRevision?: number
  constructor(currentRevision?: number) { super('This objective changed on the server. Your draft has been kept.'); this.currentRevision = currentRevision }
}

function project(value: GoalWire): ProjectGoal {
  return {
    goalId: value.goal_id,
    projectId: value.project_id,
    version: value.version,
    revision: value.revision,
    objective: value.objective,
    acceptanceCriteria: value.acceptance_criteria,
    status: value.status,
    policyReceipt: value.policy_receipt,
    rootThreadId: value.root_thread_id ?? undefined,
    supervisorRunId: value.supervisor_run_id ?? undefined,
    evidence: value.evidence,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    availableActions: value.available_actions ?? { start: false, pause: false, resume: false, stop: false },
  }
}

export class RemoteProjectGoalClient implements ProjectGoalClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string
  private readonly v2: boolean

  constructor(
    baseUrl: string,
    getUserId: () => string,
    token?: string,
    v2 = false,
  ) {
    this.baseUrl = baseUrl
    this.getUserId = getUserId
    this.token = token
    this.v2 = v2
  }

  private path(projectId: string, action = '') {
    const suffix = action ? `/${action}` : ''
    return `${this.baseUrl.replace(/\/$/, '')}/${this.v2 ? 'api/v2' : 'api'}/projects/${encodeURIComponent(projectId)}/goal${suffix}`
  }

  private async request(projectId: string, action = '', init?: RequestInit): Promise<ProjectGoal> {
    const response = await fetch(this.path(projectId, action), {
      ...init,
      headers: {
        'X-OpenSaddle-User': this.getUserId(),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...init?.headers,
      },
    })
    if (response.status === 404 && !init) throw new Error('PROJECT_GOAL_NOT_FOUND')
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string | { message?: string; current_revision?: number }; current_revision?: number } | null
      if (response.status === 409 && this.v2) {
        const detail = body?.detail
        throw new GoalRevisionConflictError(body?.current_revision ?? (typeof detail === 'object' ? detail.current_revision : undefined))
      }
      throw new Error(typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? `OpenSaddle HTTP ${response.status}`)
    }
    return project(await response.json() as GoalWire)
  }

  async get(projectId: string) {
    try { return await this.request(projectId) } catch (error) {
      if (error instanceof Error && error.message === 'PROJECT_GOAL_NOT_FOUND') return null
      throw error
    }
  }

  set(projectId: string, input: { objective: string; acceptanceCriteria: string[] }) {
    return this.request(projectId, '', {
      method: this.v2 ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective: input.objective, acceptance_criteria: input.acceptanceCriteria }),
    })
  }

  revise(projectId: string, input: { expectedRevision: number; objective: string; acceptanceCriteria: string[] }) {
    return this.request(projectId, '', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: input.expectedRevision, objective: input.objective, acceptance_criteria: input.acceptanceCriteria }),
    })
  }

  start(projectId: string, input: { harness: string; modelId?: string; reasoningEffort?: string; idempotencyKey: string }) {
    return this.request(projectId, 'start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        harness: input.harness, model_id: input.modelId,
        reasoning_effort: input.reasoningEffort, idempotency_key: input.idempotencyKey,
      }),
    })
  }

  private mutate(projectId: string, action: 'pause' | 'resume' | 'stop', revision: number) {
    return this.request(projectId, action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_revision: revision }),
    })
  }

  pause(projectId: string, revision: number) { return this.mutate(projectId, 'pause', revision) }
  resume(projectId: string, revision: number) { return this.mutate(projectId, 'resume', revision) }
  stop(projectId: string, revision: number) { return this.mutate(projectId, 'stop', revision) }
}
