import type { CommandCenterClient, CommandCenterSnapshot, ProjectGoalStatus } from './contracts'

type WireSnapshot = {
  generated_at: string
  priority: null | {
    project_id: string
    goal_id?: string
    goal_revision?: number
    objective: string
    acceptance_criteria?: string[]
    status?: ProjectGoalStatus | 'unknown'
    updated_at?: string
  }
  section_status?: { priority?: { state?: 'available' | 'empty' | 'ambiguous' | 'unavailable'; reason?: string | null } }
  attention_items?: Array<{
    id: string
    kind: 'approval' | 'run'
    project_id: string
    run_id?: string
    approval_id?: string
    proposal_id?: string | null
    record_digest?: string | null
    title: string
    detail?: string
    reason?: string
    requested_action?: string
    urgency?: string
    updated_at?: string
    available_actions?: string[]
  }>
  active_runs?: Array<{ run_id: string; project_id: string; task?: string; status: string; updated_at?: string }>
  projects?: Array<{
    project_id: string
    status: 'active' | 'blocked' | 'paused' | 'done' | 'unknown'
    objective?: string
    next_action?: string
    latest_activity?: string
    updated_at?: string
  }>
  outcomes?: Array<{
    id: string
    project_id: string
    run_id?: string
    title: string
    summary?: string
    verified: boolean
    completed_at: string
  }>
  unavailable_sections?: CommandCenterSnapshot['unavailableSections']
}

export class RemoteCommandCenterClient implements CommandCenterClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string

  constructor(
    baseUrl: string,
    getUserId: () => string,
    token?: string,
  ) {
    this.baseUrl = baseUrl
    this.getUserId = getUserId
    this.token = token
  }

  async get(): Promise<CommandCenterSnapshot> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v2/command-center`, {
      headers: {
        'X-OpenSaddle-User': this.getUserId(),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(detail?.detail ?? `Command Center request failed (${response.status})`)
    }
    const value = await response.json() as WireSnapshot
    return {
      generatedAt: value.generated_at,
      priority: value.priority ? {
        projectId: value.priority.project_id,
        goalId: value.priority.goal_id,
        goalRevision: value.priority.goal_revision,
        objective: value.priority.objective,
        acceptanceCriteria: value.priority.acceptance_criteria ?? [],
        status: value.priority.status ?? 'unknown',
        updatedAt: value.priority.updated_at,
      } : null,
      priorityStatus: {
        state: value.section_status?.priority?.state ?? (value.unavailable_sections?.includes('priority') ? 'unavailable' : value.priority ? 'available' : 'empty'),
        reason: value.section_status?.priority?.reason ?? undefined,
      },
      attentionItems: (value.attention_items ?? []).map((item) => ({
        id: item.id, kind: item.kind, projectId: item.project_id, runId: item.run_id,
        approvalId: item.approval_id, proposalId: item.proposal_id ?? undefined, recordDigest: item.record_digest ?? undefined, title: item.title, detail: item.detail ?? '',
        reason: item.reason ?? '', requestedAction: item.requested_action ?? '',
        urgency: item.urgency, updatedAt: item.updated_at,
        availableActions: item.available_actions ?? [],
      })),
      activeRuns: (value.active_runs ?? []).map((run) => ({
        runId: run.run_id, projectId: run.project_id, task: run.task,
        status: run.status, updatedAt: run.updated_at,
      })),
      projects: (value.projects ?? []).map((project) => ({
        projectId: project.project_id, status: project.status, objective: project.objective,
        nextAction: project.next_action, latestActivity: project.latest_activity,
        updatedAt: project.updated_at,
      })),
      outcomes: (value.outcomes ?? []).map((outcome) => ({
        id: outcome.id, projectId: outcome.project_id, runId: outcome.run_id,
        title: outcome.title, summary: outcome.summary, verified: outcome.verified,
        completedAt: outcome.completed_at,
      })),
      unavailableSections: value.unavailable_sections ?? [],
    }
  }
}
