import { MockRuntimeClient } from './mockRuntime'
import type { GitComparisonResult, GitStatusResult, RuntimeClient, RouteEstimate, RuntimeRunSummary, SessionEvent } from './contracts'
import type { CodingProvider, Harness, ModelKey, RunExecutionMode, RuntimeKind } from '../types'
import { createOrderedEventEmitter } from './orderedEvents'

export function shouldStopRunReconciliation(responseStatus: number, runStatus?: string): boolean {
  return responseStatus === 404
    || responseStatus === 410
    || runStatus === 'completed'
    || runStatus === 'failed'
    || runStatus === 'cancelled'
}

/**
 * Talks to a local OpenSaddle daemon when available; falls back to mock simulation.
 */
export class OpenSaddleRuntimeClient implements RuntimeClient {
  private baseUrl: string
  private fallback: RuntimeClient
  private token?: string
  private getUserId: () => string
  private allowFallback: boolean

  constructor(
    baseUrl: string,
    fallback: RuntimeClient = new MockRuntimeClient(),
    options: {
      token?: string
      getUserId?: () => string
      allowFallback?: boolean
    } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fallback = fallback
    this.token = options.token
    this.getUserId = options.getUserId ?? (() => 'user-ad')
    this.allowFallback = options.allowFallback ?? true
  }

  private headers(json = false): Record<string, string> {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      'X-OpenSaddle-User': this.getUserId(),
    }
  }

  private async responseError(res: Response): Promise<Error> {
    try {
      const body = await res.json() as { detail?: string; error?: string; message?: string; reason?: string }
      return new Error(body.detail ?? body.reason ?? body.message ?? body.error ?? `OpenSaddle HTTP ${res.status}`)
    } catch {
      return new Error(`OpenSaddle HTTP ${res.status}`)
    }
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
        signal: AbortSignal.timeout(1200),
      })
      return res.ok
    } catch {
      return false
    }
  }

  private async ensureGitRepository(projectId: string, repo: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/repositories`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ repository_id: projectId, root: repo }),
    })
    if (!response.ok) throw await this.responseError(response)
  }

  async estimate(task: string, prefs?: {
    projectId?: string
    routingPref?: string
    modelKey?: ModelKey
    modelId?: string
    reasoningEffort?: string
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
  }): Promise<RouteEstimate> {
    if (!(await this.healthy())) {
      if (this.allowFallback) return this.fallback.estimate(task, prefs)
      throw new Error(`OpenSaddle control plane unavailable at ${this.baseUrl}`)
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/routes/estimate`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          task,
          project_id: prefs?.projectId,
          routing_pref: prefs?.routingPref ?? 'quality',
          model_key: prefs?.modelKey,
          model_id: prefs?.modelId,
          harness_key: prefs?.harnessKey,
          provider_key: prefs?.providerKey,
          runtime_key: prefs?.runtimeKey,
        }),
      })
      if (!res.ok) throw await this.responseError(res)
      const data = await res.json() as {
        model_key: ModelKey
        model_id?: string
        native_model_default?: boolean
        harness_key: Harness
        provider_key?: CodingProvider
        runtime_key: RuntimeKind
        reasons: string[]
        cost: string
        alternatives?: Array<{ model_key: ModelKey; harness_key: Harness; score: number }>
      }
      return {
        modelKey: data.model_key,
        modelId: data.model_id,
        nativeModelDefault: data.native_model_default,
        harnessKey: data.harness_key,
        providerKey: data.provider_key,
        runtimeKey: data.runtime_key,
        reasons: data.reasons,
        cost: data.cost,
        alternatives: data.alternatives?.map((a) => ({
          modelKey: a.model_key,
          harnessKey: a.harness_key,
          score: a.score,
        })),
      }
    } catch (error) {
      if (this.allowFallback && error instanceof TypeError) return this.fallback.estimate(task, prefs)
      throw error
    }
  }

  async startRun(input: {
    projectId: string
    threadId?: string
    sourceMessageId?: string
    assistantMessageId?: string
    task: string
    agentId?: string
    parentRunId?: string
    sourceIds?: string[]
    providerSessionId?: string
    providerSessionMode?: 'resume' | 'fork'
    providerTurnId?: string
    modelKey?: ModelKey
    modelId?: string
    reasoningEffort?: string
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
    executionMode?: RunExecutionMode
    capabilityIds?: string[]
    repo?: string
    approvalId?: string
    reviewProviderKey?: CodingProvider
  }): Promise<{
    runId: string
    sessionId: string
    threadId?: string
    sourceMessageId?: string
    assistantMessageId?: string
    mode?: string
    route?: RouteEstimate
  }> {
    if (!(await this.healthy())) {
      if (this.allowFallback) return this.fallback.startRun(input)
      throw new Error(`OpenSaddle control plane unavailable at ${this.baseUrl}`)
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/runs`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          project_id: input.projectId,
          thread_id: input.threadId,
          source_message_id: input.sourceMessageId,
          assistant_message_id: input.assistantMessageId,
          task: input.task,
          agent_id: input.agentId,
          parent_run_id: input.parentRunId,
          source_ids: input.sourceIds,
          provider_session_id: input.providerSessionId,
          provider_session_mode: input.providerSessionMode,
          provider_turn_id: input.providerTurnId,
          model_key: input.modelKey,
          model_id: input.modelId,
          reasoning_effort: input.reasoningEffort,
          harness_key: input.harnessKey,
          provider_key: input.providerKey,
          runtime_key: input.runtimeKey,
          execution_mode: input.executionMode,
          capability_ids: input.capabilityIds,
          repo: input.repo,
          approval_id: input.approvalId,
          review_provider_key: input.reviewProviderKey,
        }),
      })
      if (!res.ok) throw await this.responseError(res)
      const data = await res.json() as {
        run_id: string
        session_id: string
        thread_id?: string
        source_message_id?: string
        assistant_message_id?: string
        mode?: string
        route?: ApiRouteEstimate
        estimate?: ApiRouteEstimate
      }
      return {
        runId: data.run_id,
        sessionId: data.session_id,
        threadId: data.thread_id,
        sourceMessageId: data.source_message_id,
        assistantMessageId: data.assistant_message_id,
        mode: data.mode,
        route: routeFromApi(data.route ?? data.estimate),
      }
    } catch (error) {
      if (this.allowFallback && error instanceof TypeError) return this.fallback.startRun(input)
      throw error
    }
  }

  async listRuns(): Promise<RuntimeRunSummary[]> {
    if (!(await this.healthy())) return []
    const response = await fetch(`${this.baseUrl}/api/runs`, { headers: this.headers() })
    if (!response.ok) throw await this.responseError(response)
    const rows = await response.json() as Array<{
      run_id: string
      session_id: string
      project_id: string
      thread_id?: string
      source_message_id?: string
      assistant_message_id?: string
      task: string
      agent_id?: string
      parent_run_id?: string
      queued_after_run_id?: string
      status: RuntimeRunSummary['status']
      attached?: boolean
      route: ApiRouteEstimate
      provider_session_id?: string
      provider_session_mode?: 'resume' | 'fork'
      provider_turn_id?: string
      execution_mode?: RuntimeRunSummary['executionMode']
      created_at: number | string
      updated_at: number | string
      error?: string
      last_event_type?: RuntimeRunSummary['lastEventType']
    }>
    return rows.map((run) => ({
      runId: run.run_id,
      sessionId: run.session_id,
      projectId: run.project_id,
      threadId: run.thread_id,
      sourceMessageId: run.source_message_id,
      assistantMessageId: run.assistant_message_id,
      task: run.task,
      agentId: run.agent_id,
      parentRunId: run.parent_run_id,
      queuedAfterRunId: run.queued_after_run_id,
      status: run.status,
      attached: run.attached,
      route: routeFromApi(run.route) ?? {
        modelKey: 'sonnet',
        harnessKey: 'chat',
        runtimeKey: 'local',
        reasons: ['Recovered from the local OpenSaddle runtime'],
        cost: '$0.00',
      },
      providerSessionId: run.provider_session_id,
      providerSessionMode: run.provider_session_mode,
      providerTurnId: run.provider_turn_id,
      executionMode: run.execution_mode,
      createdAt: timestampFromApi(run.created_at),
      updatedAt: timestampFromApi(run.updated_at),
      error: run.error,
      lastEventType: run.last_event_type,
    }))
  }

  async resolveDiff(
    runId: string,
    filePath: string,
    hunkIndex: number,
    decision: 'accepted' | 'rejected',
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/runs/${runId}/diff`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ file_path: filePath, hunk_index: hunkIndex, decision }),
    })
    if (!response.ok) throw await this.responseError(response)
  }

  async listOpenRouterFreeModels(): Promise<Array<{ id: string; name: string; contextLength?: number }>> {
    const response = await fetch(`${this.baseUrl}/api/models/openrouter/free`, { headers: this.headers() })
    if (!response.ok) throw await this.responseError(response)
    const body = await response.json() as {
      models?: Array<{ id: string; name: string; contextLength?: number }>
    }
    return body.models ?? []
  }

  async generateSite(input: { projectId: string; prompt: string }) {
    const response = await fetch(`${this.baseUrl}/api/sites/generate`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ project_id: input.projectId, prompt: input.prompt }),
    })
    if (!response.ok) throw await this.responseError(response)
    const body = await response.json() as {
      draft: {
        name: string
        description: string
        slug: string
        accent: string
        pages: Array<{
          id: string
          title: string
          body: string
          eyebrow?: string
          ctaLabel?: string
          ctaUrl?: string
          agentRail: boolean
          sections?: Array<{ id: string; title: string; body: string }>
        }>
      }
    }
    return body.draft
  }

  async gitStatus(projectId: string, repo: string): Promise<GitStatusResult> {
    await this.ensureGitRepository(projectId, repo)
    const response = await fetch(`${this.baseUrl}/api/repositories/${encodeURIComponent(projectId)}/status`, {
      headers: this.headers(),
    })
    if (!response.ok) throw await this.responseError(response)
    const body = await response.json() as {
      repository: string
      branch: string | null
      detached: boolean
      head: string | null
      upstream: string | null
      ahead: number
      behind: number
      clean: boolean
      additions: number
      deletions: number
      files: Array<{
        path: string
        original_path?: string
        index: string
        worktree: string
        staged: boolean
        modified: boolean
        untracked: boolean
      }>
      diff_files: Array<{ path: string; additions: number | null; deletions: number | null; binary: boolean }>
    }
    return {
      repository: body.repository,
      branch: body.branch,
      detached: body.detached,
      head: body.head,
      upstream: body.upstream,
      ahead: body.ahead,
      behind: body.behind,
      clean: body.clean,
      additions: body.additions,
      deletions: body.deletions,
      files: body.files.map((file) => ({
        path: file.path,
        originalPath: file.original_path,
        index: file.index,
        worktree: file.worktree,
        staged: file.staged,
        modified: file.modified,
        untracked: file.untracked,
      })),
      diffFiles: body.diff_files,
    }
  }

  async gitCompare(projectId: string, repo: string, base: string, head?: string): Promise<GitComparisonResult> {
    await this.ensureGitRepository(projectId, repo)
    const query = new URLSearchParams({ base, ...(head ? { head } : {}) })
    const response = await fetch(
      `${this.baseUrl}/api/repositories/${encodeURIComponent(projectId)}/compare?${query}`,
      { headers: this.headers() },
    )
    if (!response.ok) throw await this.responseError(response)
    const body = await response.json() as {
      repository: string
      base: string
      head: string
      merge_base: string
      additions: number
      deletions: number
      files: GitComparisonResult['files']
      patch: string
      truncated: boolean
    }
    return {
      repository: body.repository,
      base: body.base,
      head: body.head,
      mergeBase: body.merge_base,
      additions: body.additions,
      deletions: body.deletions,
      files: body.files,
      patch: body.patch,
      truncated: body.truncated,
    }
  }

  async gitCreateBranch(input: {
    projectId: string
    repo: string
    branch: string
    startPoint?: string
    approvalId?: string
  }): Promise<{ repository: string; branch: string; startPoint: string; summary: string }> {
    await this.ensureGitRepository(input.projectId, input.repo)
    const response = await fetch(`${this.baseUrl}/api/repositories/${encodeURIComponent(input.projectId)}/branches`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        name: input.branch,
        start_point: input.startPoint,
        checkout: true,
      }),
    })
    if (!response.ok) throw await this.responseError(response)
    return {
      repository: input.repo,
      branch: input.branch,
      startPoint: input.startPoint ?? 'HEAD',
      summary: `Switched to new branch '${input.branch}'`,
    }
  }

  async gitCommit(input: {
    projectId: string
    repo: string
    message: string
    paths?: string[]
    includeAll?: boolean
    approvalId?: string
  }): Promise<{ repository: string; commit: string; summary: string }> {
    await this.ensureGitRepository(input.projectId, input.repo)
    const status = await this.gitStatus(input.projectId, input.repo)
    const paths = input.paths?.length
      ? input.paths
      : input.includeAll ? status.files.map((file) => file.path) : []
    if (paths.length) {
      const staged = await fetch(`${this.baseUrl}/api/repositories/${encodeURIComponent(input.projectId)}/stage`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({ paths, expected_head: status.head }),
      })
      if (!staged.ok) throw await this.responseError(staged)
    }
    const response = await fetch(`${this.baseUrl}/api/repositories/${encodeURIComponent(input.projectId)}/commit`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        message: input.message,
        expected_head: status.head,
      }),
    })
    if (!response.ok) throw await this.responseError(response)
    const body = await response.json() as { head: string; output: string }
    return { repository: input.repo, commit: body.head, summary: body.output }
  }

  async gitPush(input: {
    projectId: string
    repo: string
    remote?: string
    branch?: string
    approvalId: string
  }): Promise<{ repository: string; remote: string; branch: string; summary: string }> {
    await this.ensureGitRepository(input.projectId, input.repo)
    const response = await fetch(`${this.baseUrl}/api/repositories/${encodeURIComponent(input.projectId)}/push`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        remote: input.remote,
        branch: input.branch,
      }),
    })
    if (!response.ok) throw await this.responseError(response)
    return await response.json() as { repository: string; remote: string; branch: string; summary: string }
  }

  async gitCreatePullRequest(input: {
    projectId: string
    repo: string
    title: string
    body: string
    base: string
    head?: string
    draft?: boolean
    approvalId: string
  }): Promise<{
    repository: string
    number: number
    url: string
    title: string
    state: string
    base: string
    head: string
  }> {
    await this.ensureGitRepository(input.projectId, input.repo)
    const status = input.head ? undefined : await this.gitStatus(input.projectId, input.repo)
    const head = input.head ?? status?.branch
    if (!head) throw new Error('A branch is required to create a pull request')
    const response = await fetch(`${this.baseUrl}/api/repositories/${encodeURIComponent(input.projectId)}/pull-requests`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        base: input.base,
        head,
        draft: input.draft,
        idempotency_key: input.approvalId,
      }),
    })
    if (!response.ok) throw await this.responseError(response)
    const body = await response.json() as {
      number: number
      url: string
      title: string
      state: string
      baseRefName?: string
      headRefName?: string
    }
    return {
      repository: input.repo,
      number: body.number,
      url: body.url,
      title: body.title,
      state: body.state,
      base: body.baseRefName ?? input.base,
      head: body.headRefName ?? head,
    }
  }

  subscribe(runId: string, onEvent: (event: SessionEvent) => void): () => void {
    const url = `${this.baseUrl}/api/runs/${runId}/events`
    const controller = new AbortController()
    let fallbackStop: (() => void) | null = null
    let receivedEvents = 0
    let snapshotCursor = 0
    // The authoritative Python run store numbers durable events from one.
    // Other event sources can retain the reconciler's zero-based default.
    const emit = createOrderedEventEmitter(
      (event) => {
        receivedEvents += 1
        snapshotCursor = event.sequence
        onEvent(event)
      },
      1,
    )

    void (async () => {
      if (!(await this.healthy())) {
        if (this.allowFallback) fallbackStop = this.fallback.subscribe(runId, onEvent)
        return
      }
      try {
        // Reconcile durable events in parallel with SSE. This closes the small
        // attach race for very fast local models and survives proxy buffering.
        void (async () => {
          while (!controller.signal.aborted) {
            try {
              const snapshot = await fetch(`${this.baseUrl}/api/runs/${runId}?after_sequence=${snapshotCursor}`, {
                headers: this.headers(),
                signal: controller.signal,
              })
              if (shouldStopRunReconciliation(snapshot.status)) return
              if (snapshot.ok) {
                const run = await snapshot.json() as {
                  status?: string
                  events?: SessionEvent[]
                }
                for (const event of run.events ?? []) emit(event)
                if (shouldStopRunReconciliation(snapshot.status, run.status)) return
              }
            } catch {
              if (controller.signal.aborted) return
            }
            await new Promise((resolve) => window.setTimeout(resolve, 350))
          }
        })()
        const res = await fetch(url, {
          headers: this.headers(),
          signal: controller.signal,
        })
        if (!res.ok) throw await this.responseError(res)
        if (!res.body) throw new Error('Run event stream has no body')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const data = frame.split('\n').find((line) => line.startsWith('data: '))
            if (!data) continue
            try {
              emit(JSON.parse(data.slice(6)) as SessionEvent)
            } catch {
              // Ignore malformed frames without dropping the stream.
            }
          }
        }
        // A very fast local run can finish while the browser is attaching to
        // SSE. Reconcile once from durable state so no final deltas are lost.
        if (!controller.signal.aborted) {
          const snapshot = await fetch(`${this.baseUrl}/api/runs/${runId}?after_sequence=${snapshotCursor}`, {
            headers: this.headers(),
            signal: controller.signal,
          })
          if (snapshot.ok) {
            const run = await snapshot.json() as { events?: SessionEvent[] }
            for (const event of run.events ?? []) emit(event)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && receivedEvents === 0 && this.allowFallback && error instanceof TypeError) {
          fallbackStop = this.fallback.subscribe(runId, onEvent)
        }
      } finally {
        // The reconciliation loop is intentionally detached so it can race
        // the SSE attach. Always stop it when that stream exits or rejects.
        controller.abort()
      }
    })()

    return () => {
      controller.abort()
      fallbackStop?.()
    }
  }

  async cancel(runId: string): Promise<void> {
    if (await this.healthy()) {
      try {
        const res = await fetch(`${this.baseUrl}/api/runs/${runId}/cancel`, {
          method: 'POST',
          headers: this.headers(),
        })
        if (!res.ok) throw await this.responseError(res)
        return
      } catch (error) {
        if (!this.allowFallback || !(error instanceof TypeError)) throw error
      }
    }
    return this.fallback.cancel(runId)
  }

  async pause(runId: string): Promise<void> {
    if (!(await this.healthy())) return this.fallback.pause(runId)
    const res = await fetch(`${this.baseUrl}/api/runs/${runId}/pause`, {
      method: 'POST',
      headers: this.headers(),
    })
    if (!res.ok) throw await this.responseError(res)
  }

  async resume(runId: string): Promise<void> {
    if (!(await this.healthy())) return this.fallback.resume(runId)
    const res = await fetch(`${this.baseUrl}/api/runs/${runId}/resume`, {
      method: 'POST',
      headers: this.headers(),
    })
    if (!res.ok) throw await this.responseError(res)
  }

  async retry(runId: string): Promise<{
    runId: string
    sessionId: string
    threadId?: string
    sourceMessageId?: string
    assistantMessageId?: string
    parentRunId?: string
    route?: RouteEstimate
  }> {
    if (!(await this.healthy())) return this.fallback.retry(runId)
    const res = await fetch(`${this.baseUrl}/api/runs/${runId}/retry`, {
      method: 'POST',
      headers: this.headers(),
    })
    if (!res.ok) throw await this.responseError(res)
    const payload = await res.json() as {
      run_id: string
      session_id: string
      thread_id?: string
      source_message_id?: string
      assistant_message_id?: string
      parent_run_id?: string
      route?: RouteEstimate
    }
    return {
      runId: payload.run_id,
      sessionId: payload.session_id,
      threadId: payload.thread_id,
      sourceMessageId: payload.source_message_id,
      assistantMessageId: payload.assistant_message_id,
      parentRunId: payload.parent_run_id,
      route: payload.route,
    }
  }

  async steer(runId: string, text: string): Promise<void> {
    if (!(await this.healthy())) return this.fallback.steer(runId, text)
    const res = await fetch(`${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/steer`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw await this.responseError(res)
  }

  async queue(runId: string, text: string): Promise<{
    runId: string
    sessionId: string
    threadId?: string
    sourceMessageId?: string
    assistantMessageId?: string
    parentRunId?: string
    queuedAfterRunId?: string
    route?: RouteEstimate
  }> {
    if (!(await this.healthy())) return this.fallback.queue(runId, text)
    const res = await fetch(`${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/queue`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw await this.responseError(res)
    const payload = await res.json() as {
      run_id: string
      session_id: string
      thread_id?: string
      source_message_id?: string
      assistant_message_id?: string
      parent_run_id?: string
      queued_after_run_id?: string
      route?: RouteEstimate
    }
    return {
      runId: payload.run_id,
      sessionId: payload.session_id,
      threadId: payload.thread_id,
      sourceMessageId: payload.source_message_id,
      assistantMessageId: payload.assistant_message_id,
      parentRunId: payload.parent_run_id,
      queuedAfterRunId: payload.queued_after_run_id,
      route: payload.route,
    }
  }

  async updateQueue(runId: string, text: string): Promise<void> {
    if (!(await this.healthy())) return this.fallback.updateQueue(runId, text)
    const res = await fetch(`${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/queue`, {
      method: 'PATCH',
      headers: this.headers(true),
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw await this.responseError(res)
  }

  async respondToRequest(runId: string, requestId: string, response: {
    approved?: boolean
    scope?: 'once' | 'session'
    text?: string
    answers?: Record<string, string[]>
    form?: Record<string, unknown>
  }): Promise<void> {
    if (!(await this.healthy())) return this.fallback.respondToRequest(runId, requestId, response)
    const res = await fetch(
      `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/requests/${encodeURIComponent(requestId)}/respond`,
      {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(response),
      },
    )
    if (!res.ok) throw await this.responseError(res)
  }

  async requestApproval(input: {
    projectId: string
    agentId?: string
    action: string
  }): Promise<{ id: string; status: 'pending' | 'approved' | 'denied' | 'consumed' }> {
    const res = await fetch(`${this.baseUrl}/api/approvals`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        project_id: input.projectId,
        agent_id: input.agentId,
        action: input.action,
      }),
    })
    if (!res.ok) throw await this.responseError(res)
    return await res.json() as { id: string; status: 'pending' | 'approved' | 'denied' | 'consumed' }
  }

  async resolveApproval(approvalId: string, allow: boolean): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/approvals/${encodeURIComponent(approvalId)}/resolve`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ allow }),
    })
    if (!res.ok) throw await this.responseError(res)
  }
}
type ApiRouteEstimate = Omit<Partial<RouteEstimate>, 'alternatives'> & {
  model_key?: RouteEstimate['modelKey']
  model_id?: string
  reasoning_effort?: string
  native_model_default?: boolean
  harness_key?: RouteEstimate['harnessKey']
  provider_key?: RouteEstimate['providerKey']
  runtime_key?: RouteEstimate['runtimeKey']
  alternatives?: Array<{
    modelKey?: RouteEstimate['modelKey']
    model_key?: RouteEstimate['modelKey']
    harnessKey?: RouteEstimate['harnessKey']
    harness_key?: RouteEstimate['harnessKey']
    score: number
  }>
}

function routeFromApi(route: ApiRouteEstimate | undefined): RouteEstimate | undefined {
  if (!route) return undefined
  const modelKey = route.modelKey ?? route.model_key
  const harnessKey = route.harnessKey ?? route.harness_key
  const runtimeKey = route.runtimeKey ?? route.runtime_key
  if (!modelKey || !harnessKey || !runtimeKey) return undefined
  return {
    modelKey,
    modelId: route.modelId ?? route.model_id,
    reasoningEffort: route.reasoningEffort ?? route.reasoning_effort,
    nativeModelDefault: route.nativeModelDefault ?? route.native_model_default,
    harnessKey,
    providerKey: route.providerKey ?? route.provider_key,
    runtimeKey,
    reasons: route.reasons ?? [],
    cost: route.cost ?? '$0.00',
    alternatives: route.alternatives?.map((alternative) => ({
      modelKey: alternative.modelKey ?? alternative.model_key ?? modelKey,
      harnessKey: alternative.harnessKey ?? alternative.harness_key ?? harnessKey,
      score: alternative.score,
    })),
  }
}

function timestampFromApi(value: number | string): number {
  if (typeof value === 'number') return value
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Date.now()
}
