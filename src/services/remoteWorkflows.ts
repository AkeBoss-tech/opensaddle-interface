import type {
  WorkflowClient,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowTimelineEvent,
} from './contracts'

type DomainWorkflow = {
  workflow_id: string
  name: string
  status: 'active' | 'paused'
  version: number
  concurrency_limit: number
  trigger: Record<string, unknown>
  task: Record<string, unknown>
  budget_policy: Record<string, unknown>
  permission_policy: Record<string, unknown>
  approval_policy: Record<string, unknown>
  created_at: string
  updated_at: string
}

type DomainExecution = {
  execution_id: string
  workflow_id: string
  workflow_version: number
  status: WorkflowExecution['status']
  trigger_key?: string | null
  trigger_payload: Record<string, unknown>
  retry_of_execution_id?: string | null
  attempt: number
  worker_id?: string | null
  cancellation_reason?: string | null
  result?: Record<string, unknown> | null
  queued_at: string
  started_at?: string | null
  finished_at?: string | null
}

function timestamp(value?: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function workflow(value: DomainWorkflow): WorkflowDefinition {
  return {
    workflowId: value.workflow_id,
    name: value.name,
    status: value.status,
    version: value.version,
    concurrencyLimit: value.concurrency_limit,
    trigger: value.trigger,
    task: value.task,
    budgetPolicy: value.budget_policy,
    permissionPolicy: value.permission_policy,
    approvalPolicy: value.approval_policy,
    createdAt: timestamp(value.created_at) ?? Date.now(),
    updatedAt: timestamp(value.updated_at) ?? Date.now(),
  }
}

function execution(value: DomainExecution): WorkflowExecution {
  return {
    executionId: value.execution_id,
    workflowId: value.workflow_id,
    workflowVersion: value.workflow_version,
    status: value.status,
    triggerKey: value.trigger_key ?? undefined,
    triggerPayload: value.trigger_payload,
    retryOfExecutionId: value.retry_of_execution_id ?? undefined,
    attempt: value.attempt,
    workerId: value.worker_id ?? undefined,
    cancellationReason: value.cancellation_reason ?? undefined,
    result: value.result ?? undefined,
    queuedAt: timestamp(value.queued_at) ?? Date.now(),
    startedAt: timestamp(value.started_at),
    finishedAt: timestamp(value.finished_at),
  }
}

export class RemoteWorkflowClient implements WorkflowClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string

  constructor(baseUrl: string, getUserId: () => string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getUserId = getUserId
    this.token = token
  }

  private headers(json = false): Record<string, string> {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      'X-OpenSaddle-User': this.getUserId(),
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(Boolean(init?.body)), ...init?.headers },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {
        detail?: string
        error?: string
        message?: string
      } | null
      throw new Error(body?.detail ?? body?.message ?? body?.error ?? `OpenSaddle HTTP ${response.status}`)
    }
    return await response.json() as T
  }

  async list(): Promise<WorkflowDefinition[]> {
    const response = await this.request<{ workflows?: DomainWorkflow[] }>('/api/workflows')
    return (response.workflows ?? []).map(workflow)
  }

  async executions(input: {
    workflowId?: string
    statuses?: WorkflowExecution['status'][]
    limit?: number
  } = {}): Promise<WorkflowExecution[]> {
    const query = new URLSearchParams()
    if (input.workflowId) query.set('workflow_id', input.workflowId)
    for (const status of input.statuses ?? []) query.append('status', status)
    if (input.limit) query.set('limit', String(input.limit))
    const response = await this.request<{ executions?: DomainExecution[] }>(
      `/api/workflow-executions${query.size ? `?${query}` : ''}`,
    )
    return (response.executions ?? []).map(execution)
  }

  async pause(workflowId: string): Promise<WorkflowDefinition> {
    return workflow(await this.request<DomainWorkflow>(
      `/api/workflows/${encodeURIComponent(workflowId)}/pause`,
      { method: 'POST' },
    ))
  }

  async resume(workflowId: string): Promise<WorkflowDefinition> {
    return workflow(await this.request<DomainWorkflow>(
      `/api/workflows/${encodeURIComponent(workflowId)}/resume`,
      { method: 'POST' },
    ))
  }

  async trigger(workflowId: string): Promise<WorkflowExecution> {
    return execution(await this.request<DomainExecution>(
      `/api/workflows/${encodeURIComponent(workflowId)}/trigger`,
      { method: 'POST', body: JSON.stringify({ payload: {} }) },
    ))
  }

  async cancel(executionId: string, reason = 'Cancelled from the OpenSaddle Work inbox'): Promise<WorkflowExecution> {
    return execution(await this.request<DomainExecution>(
      `/api/workflow-executions/${encodeURIComponent(executionId)}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ))
  }

  async retry(executionId: string): Promise<WorkflowExecution> {
    return execution(await this.request<DomainExecution>(
      `/api/workflow-executions/${encodeURIComponent(executionId)}/retry`,
      { method: 'POST', body: JSON.stringify({}) },
    ))
  }

  async timeline(executionId: string): Promise<WorkflowTimelineEvent[]> {
    const response = await this.request<{
      timeline?: Array<{
        timeline_id: number
        event_type: string
        data: Record<string, unknown>
        recorded_at: string
      }>
    }>(`/api/workflow-executions/${encodeURIComponent(executionId)}/timeline`)
    return (response.timeline ?? []).map((event) => ({
      timelineId: event.timeline_id,
      eventType: event.event_type,
      data: event.data,
      recordedAt: timestamp(event.recorded_at) ?? Date.now(),
    }))
  }
}
