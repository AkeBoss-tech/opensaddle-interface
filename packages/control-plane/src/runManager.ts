import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ControlPlaneConfig } from './config.js'
import {
  applyDiffHunk,
  captureDiffFromSnapshot,
  captureWorktreeSnapshot,
  rejectDiffHunk,
  type CapturedDiffFile,
} from './diffCapture.js'
import { HarnessRegistry } from './harness/index.js'
import { ModelGateway } from './modelGateway.js'
import { RuntimeProvisioner } from './provisioner.js'
import { estimateRoute } from './router.js'
import { StateStore } from './store.js'
import type {
  HarnessInteractionRequest,
  HarnessInteractionResponse,
  HarnessProfile,
} from './harness/types.js'
import type {
  AuthPrincipal,
  CodingProvider,
  Harness,
  HarnessExecutionPolicy,
  ModelKey,
  RunEvent,
  RunEventType,
  RunRecord,
  RouteEstimate,
  RuntimeKind,
} from './types.js'
import type { RunExecutionMode } from './executionModes.js'

type Subscriber = (event: RunEvent) => void
type PendingInteraction = {
  kind: HarnessInteractionRequest['kind']
  run: RunRecord
  resolve: (response: HarnessInteractionResponse) => void
  reject: (error: Error) => void
}

export class RunManager {
  private readonly aborters = new Map<string, AbortController>()
  private readonly activeRuns = new Map<string, RunRecord>()
  private readonly subscribers = new Map<string, Set<Subscriber>>()
  private readonly pendingInteractions = new Map<string, Map<string, PendingInteraction>>()
  private drainingQueue = false

  constructor(
    private readonly config: ControlPlaneConfig,
    private readonly store: StateStore,
    private readonly models: ModelGateway,
    private readonly provisioner: RuntimeProvisioner,
    private readonly harnesses: HarnessRegistry,
  ) {}

  async recoverInterruptedRuns(): Promise<number> {
    const interrupted = this.store.runs().filter((run) => run.status === 'queued' || run.status === 'running')
    for (const run of interrupted) {
      // The harness process cannot survive a control-plane restart, but its
      // workspace and provider-native session can. Treat the persisted run as
      // a paused checkpoint so the desktop can reattach and explicitly resume
      // it instead of presenting an ordinary failure and forcing a new run.
      run.status = 'paused'
      run.error = undefined
      run.updatedAt = Date.now()
      await this.emit(run, 'warning', {
        severity: 'info',
        message: 'OpenSaddle restarted while this run was active. The saved checkpoint is ready to resume.',
        reason: 'control_plane_restarted',
      })
      await this.emit(run, 'agent.paused', {
        checkpoint_sequence: run.events.length,
        runtime_id: run.runtimeId,
        reason: 'control_plane_restarted',
        resumable: true,
      })
      await this.store.saveRun(run)
    }
    await this.drainQueuedRuns()
    return interrupted.length
  }

  activeCount(): number {
    const staleBefore = Date.now() - this.config.runtimeTtlMs
    return this.store.runs().filter((run) =>
      (run.status === 'queued' || run.status === 'running') && run.updatedAt > staleBefore,
    ).length
  }

  get(runId: string): RunRecord | undefined {
    return this.store.run(runId)
  }

  list(principal: AuthPrincipal): RunRecord[] {
    const all = this.store.runs()
    return principal.roles.includes('admin') ? all : all.filter((run) => run.ownerId === principal.userId)
  }

  async start(input: {
    projectId: string
    task: string
    agentId?: string
    parentRunId?: string
    sourceIds?: string[]
    modelKey?: ModelKey
    modelId?: string
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
    routingPref?: string
    reviewProviderKey?: CodingProvider
    repo?: string
    principal: AuthPrincipal
    route?: RouteEstimate
    harnessProfile?: HarnessProfile
    providerSessionId?: string
    providerSessionMode?: 'resume' | 'fork'
    providerTurnId?: string
    executionMode?: RunExecutionMode
    executionPolicy?: HarnessExecutionPolicy
    reviewTargetPath?: string
  }): Promise<RunRecord> {
    if (this.activeCount() >= this.config.maxConcurrentRuns) {
      throw new Error(`Run capacity reached (${this.config.maxConcurrentRuns})`)
    }

    const route = input.route ?? estimateRoute(input.task, this.config, {
      ...input,
      telemetry: this.store.routeTelemetry(input.projectId),
    })
    const run: RunRecord = {
      id: `run_${randomUUID().slice(0, 12)}`,
      sessionId: `ses_${randomUUID().slice(0, 12)}`,
      projectId: input.projectId,
      ownerId: input.principal.userId,
      agentId: input.agentId,
      parentRunId: input.parentRunId,
      sourceIds: input.sourceIds,
      task: input.task,
      route,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      events: [],
      reviewProviderKey: input.reviewProviderKey && input.reviewProviderKey !== 'auto'
        ? input.reviewProviderKey
        : undefined,
      harnessProfile: input.harnessProfile,
      providerSessionId: input.providerSessionId,
      providerSessionMode: input.providerSessionMode,
      providerTurnId: input.providerTurnId,
      executionMode: input.executionMode,
      executionPolicy: input.executionPolicy,
      reviewTargetPath: input.executionMode === 'review'
        ? input.reviewTargetPath ?? input.repo
        : undefined,
    }
    await this.store.saveRun(run)
    await this.emit(run, 'session.created', {
      route,
      execution_mode: run.executionMode,
      execution_policy: run.executionPolicy,
      provider_session_id: run.providerSessionId,
      provider_session_mode: run.providerSessionMode,
      provider_turn_id: run.providerTurnId,
      parent_run_id: run.parentRunId,
      source_ids: run.sourceIds,
    })

    const controller = new AbortController()
    this.aborters.set(run.id, controller)
    this.activeRuns.set(run.id, run)
    void this.execute(run, input.repo, input.principal, controller)
    return run
  }

  async resolveDiff(
    runId: string,
    principal: AuthPrincipal,
    filePath: string,
    hunkIndex: number,
    decision: 'accepted' | 'rejected',
  ): Promise<void> {
    const run = this.store.run(runId)
    if (!run) throw new Error('Run not found')
    if (run.ownerId !== principal.userId && !principal.roles.includes('admin')) {
      throw new Error('Run belongs to another user')
    }
    const runtime = run.runtimeId ? this.store.runtime(run.runtimeId) : undefined
    if (!runtime?.workspacePath) throw new Error('Run workspace is unavailable')
    const event = [...run.events].reverse().find((candidate) => candidate.type === 'diff.updated')
    const files = Array.isArray(event?.payload.files) ? event.payload.files as unknown as CapturedDiffFile[] : []
    if (decision === 'accepted') {
      if (run.executionMode === 'review') {
        const target = runtime.sourceWorkspacePath ?? run.reviewTargetPath
        if (!target) throw new Error('Review target is unavailable')
        await applyDiffHunk(target, files, filePath, hunkIndex)
      }
      await this.emit(run, 'tool.completed', {
        tool: 'diff.hunk.accepted',
        file_path: filePath,
        hunk_index: hunkIndex,
        promoted: run.executionMode === 'review',
      })
      return
    }
    await rejectDiffHunk(runtime.workspacePath, files, filePath, hunkIndex)
    await this.emit(run, 'tool.completed', {
      tool: 'diff.hunk.rejected',
      file_path: filePath,
      hunk_index: hunkIndex,
    })
    await this.emit(run, 'diff.updated', { files: await this.captureRunDiff(run, runtime.workspacePath) })
  }

  subscribe(runId: string, subscriber: Subscriber): () => void {
    const set = this.subscribers.get(runId) ?? new Set<Subscriber>()
    set.add(subscriber)
    this.subscribers.set(runId, set)
    return () => {
      set.delete(subscriber)
      if (set.size === 0) this.subscribers.delete(runId)
    }
  }

  async cancel(runId: string, principal: AuthPrincipal): Promise<boolean> {
    const run = this.store.run(runId)
    if (!run) return false
    if (run.ownerId !== principal.userId && !principal.roles.includes('admin')) {
      throw new Error('Run belongs to another user')
    }
    if (run.status !== 'queued' && run.status !== 'waiting' && run.status !== 'running' && run.status !== 'paused') return true
    run.status = 'cancelled'
    run.updatedAt = Date.now()
    this.aborters.get(runId)?.abort()
    this.clearInteractions(runId, new Error('Run cancelled'))
    await this.emit(run, 'agent.failed', { reason: 'cancelled' })
    await this.emit(run, 'session.closed', { status: 'cancelled' })
    await this.store.saveRun(run)
    if (run.status === 'cancelled') await this.drainQueuedRuns()
    return true
  }

  async pause(runId: string, principal: AuthPrincipal): Promise<boolean> {
    const run = this.store.run(runId)
    if (!run) return false
    this.assertOwner(run, principal)
    if (run.status === 'paused') return true
    if (run.status !== 'queued' && run.status !== 'running') {
      throw new Error(`Run cannot be paused from ${run.status}`)
    }

    run.status = 'paused'
    run.updatedAt = Date.now()
    this.aborters.get(runId)?.abort()
    this.clearInteractions(runId, new Error('Run paused'))
    const runtime = run.runtimeId ? this.store.runtime(run.runtimeId) : undefined
    if (runtime?.workspacePath) {
      const files = await this.captureRunDiff(run, runtime.workspacePath).catch(() => [])
      if (files.length) await this.emit(run, 'diff.updated', { files })
    }
    await this.emit(run, 'agent.paused', {
      checkpoint_sequence: run.events.length,
      runtime_id: run.runtimeId,
      resumable: true,
    })
    await this.store.saveRun(run)
    return true
  }

  async resume(runId: string, principal: AuthPrincipal): Promise<RunRecord | undefined> {
    const run = this.store.run(runId)
    if (!run) return undefined
    this.assertOwner(run, principal)
    if (run.status !== 'paused') throw new Error(`Run cannot be resumed from ${run.status}`)
    if (this.activeCount() >= this.config.maxConcurrentRuns) {
      throw new Error(`Run capacity reached (${this.config.maxConcurrentRuns})`)
    }

    const controller = new AbortController()
    this.aborters.set(run.id, controller)
    this.activeRuns.set(run.id, run)
    run.status = 'running'
    run.updatedAt = Date.now()
    await this.emit(run, 'agent.resumed', {
      checkpoint_sequence: Math.max(0, run.events.length - 1),
      runtime_id: run.runtimeId,
    })
    void this.execute(run, undefined, principal, controller, true)
    return run
  }

  async retry(runId: string, principal: AuthPrincipal): Promise<RunRecord | undefined> {
    const previous = this.store.run(runId)
    if (!previous) return undefined
    this.assertOwner(previous, principal)
    if (previous.status === 'queued' || previous.status === 'running' || previous.status === 'paused') {
      throw new Error(`Run cannot be retried from ${previous.status}`)
    }
    const runtime = previous.runtimeId ? this.store.runtime(previous.runtimeId) : undefined
    const retryRepo = runtime?.workspacePath && existsSync(join(runtime.workspacePath, '.git'))
      ? runtime.workspacePath
      : undefined
    return await this.start({
      projectId: previous.projectId,
      task: previous.task,
      agentId: previous.agentId,
      parentRunId: previous.id,
      sourceIds: previous.sourceIds,
      route: previous.route,
      reviewProviderKey: previous.reviewProviderKey,
      repo: retryRepo,
      principal,
      harnessProfile: previous.harnessProfile,
      providerSessionId: previous.providerSessionId ?? this.providerSessionId(previous),
      providerSessionMode: 'resume',
      executionPolicy: previous.executionPolicy,
      executionMode: previous.executionMode,
      reviewTargetPath: previous.reviewTargetPath ?? runtime?.sourceWorkspacePath,
    })
  }

  async queue(runId: string, principal: AuthPrincipal, task: string): Promise<RunRecord | undefined> {
    const parent = this.activeRuns.get(runId) ?? this.store.run(runId)
    if (!parent) return undefined
    this.assertOwner(parent, principal)
    if (parent.status !== 'queued' && parent.status !== 'running') {
      throw new Error(`Run cannot accept a queued follow-up from ${parent.status}`)
    }

    let predecessor = parent
    const waiting = this.store.runs()
      .filter((candidate) => candidate.status === 'waiting')
      .sort((left, right) => left.createdAt - right.createdAt)
    while (true) {
      const next = waiting.find((candidate) => candidate.queuedAfterRunId === predecessor.id)
      if (!next) break
      predecessor = next
    }

    const queued: RunRecord = {
      id: `run_${randomUUID().slice(0, 12)}`,
      sessionId: `ses_${randomUUID().slice(0, 12)}`,
      projectId: parent.projectId,
      ownerId: parent.ownerId,
      agentId: parent.agentId,
      parentRunId: parent.id,
      queuedAfterRunId: predecessor.id,
      sourceIds: parent.sourceIds,
      task,
      route: parent.route,
      status: 'waiting',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      events: [],
      reviewProviderKey: parent.reviewProviderKey,
      harnessProfile: parent.harnessProfile,
      executionMode: parent.executionMode,
      executionPolicy: parent.executionPolicy,
      reviewTargetPath: parent.reviewTargetPath,
    }
    await this.store.saveRun(queued)
    await this.emit(queued, 'session.created', {
      route: queued.route,
      parent_run_id: queued.parentRunId,
      queued_after_run_id: queued.queuedAfterRunId,
      execution_mode: queued.executionMode,
      execution_policy: queued.executionPolicy,
    })
    await this.emit(queued, 'agent.queued', {
      after_run_id: queued.queuedAfterRunId,
      parent_run_id: queued.parentRunId,
      position: waiting.length + 1,
    })
    return queued
  }

  async steer(runId: string, principal: AuthPrincipal, text: string): Promise<boolean | undefined> {
    // Use the record currently owned by execute(). Reading a second JSON copy
    // from SQLite here lets the active turn later overwrite the steering event
    // when it saves its stale event array at completion.
    const run = this.activeRuns.get(runId) ?? this.store.run(runId)
    if (!run) return undefined
    this.assertOwner(run, principal)
    if (run.status !== 'running') throw new Error(`Run cannot be steered from ${run.status}`)
    const accepted = await this.harnesses.steer(run.route.providerKey, run.id, text)
    if (!accepted) return false
    await this.emit(run, 'user.input.submitted', {
      kind: 'steer',
      text,
      provider: run.route.providerKey,
    })
    await this.store.saveRun(run)
    return true
  }

  async respondInteraction(
    runId: string,
    requestId: string,
    principal: AuthPrincipal,
    response: HarnessInteractionResponse,
  ): Promise<boolean> {
    const requests = this.pendingInteractions.get(runId)
    const pending = requests?.get(requestId)
    if (!pending) return false
    const run = pending.run
    this.assertOwner(run, principal)
    requests?.delete(requestId)
    if (requests?.size === 0) this.pendingInteractions.delete(runId)
    if (pending.kind === 'approval') {
      await this.emit(run, 'approval.resolved', {
        request_id: requestId,
        allowed: response.approved === true,
        scope: response.scope ?? 'once',
      })
    } else {
      await this.emit(run, 'user.input.submitted', {
        request_id: requestId,
        answer_count: Object.keys(response.answers ?? {}).length,
      })
    }
    pending.resolve(response)
    return true
  }

  private assertOwner(run: RunRecord, principal: AuthPrincipal): void {
    if (run.ownerId !== principal.userId && !principal.roles.includes('admin')) {
      throw new Error('Run belongs to another user')
    }
  }

  private async execute(
    run: RunRecord,
    repo: string | undefined,
    principal: AuthPrincipal,
    controller: AbortController,
    resumed = false,
  ): Promise<void> {
    try {
      run.status = 'running'
      run.updatedAt = Date.now()
      await this.store.saveRun(run)

      const priorRuntime = resumed && run.runtimeId ? this.store.runtime(run.runtimeId) : undefined
      const runtime = priorRuntime?.status === 'running'
        ? priorRuntime
        : await this.provisioner.provision({
          projectId: run.projectId,
          kind: run.route.runtimeKey,
          repo,
          principal,
          isolateChanges: run.executionMode === 'review',
          reviewTargetPath: run.reviewTargetPath,
        })
      run.runtimeId = runtime.id
      if (!priorRuntime) {
        await this.emit(run, 'tool.completed', {
          tool: 'runtime.provision',
          runtime_id: runtime.id,
          provider: this.config.runtimeProvider,
          workspace_mode: runtime.isolatedChanges ? 'review' : 'direct',
        })
      }

      const workspacePath = runtime.workspacePath ?? this.config.workspaceDir
      if (existsSync(join(workspacePath, '.git')) && !run.workspaceBaseline) {
        run.workspaceBaseline = await captureWorktreeSnapshot(workspacePath)
        await this.store.saveRun(run)
      }
      const emit = (type: RunEventType, payload: Record<string, unknown>) => this.emit(run, type, payload)
      const task = resumed
        ? `Continue the existing task from the current workspace checkpoint. Inspect the work already present, avoid repeating completed steps, and finish what remains.\n\nOriginal task:\n${run.task}`
        : run.task

      if (run.route.harnessKey === 'coding') {
        const result = await this.harnesses.run({
          runId: run.id,
          sessionId: run.sessionId,
          task,
          projectId: run.projectId,
          agentId: run.agentId,
          route: run.route,
          workspacePath,
          providerId: run.route.providerKey,
          providerSessionId: run.providerSessionId ?? (resumed ? this.providerSessionId(run) : undefined),
          providerSessionMode: run.providerSessionMode,
          providerTurnId: run.providerTurnId,
          profile: run.harnessProfile,
          executionPolicy: run.executionPolicy,
          signal: controller.signal,
          emit,
          requestInteraction: (request) => this.requestInteraction(run, request),
        })
        if (!controller.signal.aborted && !result.outputAlreadyEmitted) {
          await this.emit(run, 'agent.output.delta', { text: result.summary })
        }
        const files = await this.captureRunDiff(run, workspacePath)
        if (files.length) await this.emit(run, 'diff.updated', { files })

        if (files.length && run.reviewProviderKey && run.reviewProviderKey !== run.route.providerKey) {
          await this.emit(run, 'review.started', { provider: run.reviewProviderKey })
          try {
            const reviewRoute = { ...run.route, providerKey: run.reviewProviderKey }
            const review = await this.harnesses.run({
              runId: run.id,
              sessionId: run.sessionId,
              task: [
                'Review only the run-scoped diff below. Do not modify files.',
                'Report correctness, security, and test issues concisely.',
                '',
                files.map((file) => file.patch).join('\n').slice(0, 200_000),
              ].join('\n'),
              projectId: run.projectId,
              agentId: run.agentId,
              route: reviewRoute,
              workspacePath,
              providerId: run.reviewProviderKey,
              executionPolicy: run.executionPolicy,
              signal: controller.signal,
              emit,
              requestInteraction: (request) => this.requestInteraction(run, request),
            })
            await this.emit(run, 'review.completed', { provider: run.reviewProviderKey, summary: review.summary })
            await this.emit(run, 'agent.output.delta', { text: `\n\nReview (${run.reviewProviderKey}):\n${review.summary}` })
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            await this.emit(run, 'review.failed', { provider: run.reviewProviderKey, error: reason })
            await this.emit(run, 'agent.output.delta', { text: `\n\nReview (${run.reviewProviderKey}) unavailable: ${reason}` })
          }
        }
      } else {
        await this.emit(run, 'agent.started', {
          model: run.route.modelKey,
          harness: run.route.harnessKey,
          runtime: run.route.runtimeKey,
          provider: 'opensaddle',
        })
        const answer = await this.models.complete({
          route: run.route,
          task,
          projectId: run.projectId,
          agentId: run.agentId,
          signal: controller.signal,
        })
        const chunks = answer.match(/.{1,120}(?:\s|$)/g) ?? [answer]
        for (const text of chunks) {
          if (controller.signal.aborted) return
          await this.emit(run, 'agent.output.delta', { text })
        }
      }

      if (controller.signal.aborted) return
      const providerSessionId = this.providerSessionId(run)
      if (providerSessionId) {
        run.providerSessionId = providerSessionId
        run.providerSessionMode = 'resume'
      }
      run.providerTurnId = this.providerTurnId(run) ?? run.providerTurnId
      run.status = 'completed'
      run.updatedAt = Date.now()
      await this.emit(run, 'agent.completed', {
        runtime_id: runtime.id,
        provider: run.route.providerKey,
        provider_session_id: run.providerSessionId,
        provider_session_mode: run.providerSessionMode,
        provider_turn_id: run.providerTurnId,
      })
      await this.emit(run, 'session.closed', { status: 'completed' })
      await this.store.saveRun(run)
      await this.recordTelemetry(run, true)
    } catch (error) {
      if (controller.signal.aborted) return
      const providerSessionId = this.providerSessionId(run)
      if (providerSessionId) {
        run.providerSessionId = providerSessionId
        run.providerSessionMode = 'resume'
      }
      run.providerTurnId = this.providerTurnId(run) ?? run.providerTurnId
      run.status = 'failed'
      run.error = error instanceof Error ? error.message : String(error)
      run.updatedAt = Date.now()
      await this.emit(run, 'agent.failed', { error: run.error })
      await this.emit(run, 'session.closed', { status: 'failed' })
      await this.store.saveRun(run)
      await this.recordTelemetry(run, false)
    } finally {
      if (this.aborters.get(run.id) === controller) this.aborters.delete(run.id)
      if (this.activeRuns.get(run.id) === run) this.activeRuns.delete(run.id)
      if (run.status !== 'paused') this.clearInteractions(run.id, new Error('Run ended'))
      await this.drainQueuedRuns()
    }
  }

  private async drainQueuedRuns(): Promise<void> {
    if (this.drainingQueue) return
    this.drainingQueue = true
    try {
      while (this.activeCount() < this.config.maxConcurrentRuns) {
        const runs = this.store.runs()
        const queued = runs
          .filter((candidate) => candidate.status === 'waiting' && candidate.queuedAfterRunId)
          .sort((left, right) => left.createdAt - right.createdAt)
          .find((candidate) => {
            const predecessor = runs.find((run) => run.id === candidate.queuedAfterRunId)
            return predecessor
              && (predecessor.status === 'completed'
                || predecessor.status === 'failed'
                || predecessor.status === 'cancelled')
          })
        if (!queued?.queuedAfterRunId) break
        const predecessor = runs.find((candidate) => candidate.id === queued.queuedAfterRunId)
        if (!predecessor) break

        queued.status = 'queued'
        queued.providerSessionId = predecessor.providerSessionId ?? this.providerSessionId(predecessor)
        queued.providerSessionMode = 'resume'
        queued.updatedAt = Date.now()
        await this.store.saveRun(queued)
        await this.emit(queued, 'agent.dequeued', {
          after_run_id: predecessor.id,
          provider_session_id: queued.providerSessionId,
        })

        const priorRuntime = predecessor.runtimeId ? this.store.runtime(predecessor.runtimeId) : undefined
        const controller = new AbortController()
        this.aborters.set(queued.id, controller)
        this.activeRuns.set(queued.id, queued)
        const queuedPrincipal: AuthPrincipal = {
          userId: queued.ownerId,
          roles: ['local', 'admin'],
          authType: 'local',
        }
        void this.execute(queued, priorRuntime?.workspacePath, queuedPrincipal, controller)
      }
    } finally {
      this.drainingQueue = false
    }
  }

  private async recordTelemetry(run: RunRecord, succeeded: boolean): Promise<void> {
    await this.store.saveRouteTelemetry({
      id: `route_${run.id}`,
      projectId: run.projectId,
      modelKey: run.route.modelKey,
      providerKey: run.route.providerKey,
      harnessKey: run.route.harnessKey,
      runtimeKey: run.route.runtimeKey,
      succeeded,
      durationMs: Math.max(0, run.updatedAt - run.createdAt),
      createdAt: Date.now(),
    })
  }

  private providerSessionId(run: RunRecord): string | undefined {
    for (const event of [...run.events].reverse()) {
      if (event.type !== 'tool.completed') continue
      const tool = typeof event.payload.tool === 'string' ? event.payload.tool : ''
      if ((tool === 'codex.thread.start' || tool === 'codex.thread.resume' || tool === 'codex.thread.fork') && typeof event.payload.thread_id === 'string') {
        return event.payload.thread_id
      }
      if ((tool === 'claude.session' || tool === 'claude.session.resume') && typeof event.payload.session_id === 'string') {
        return event.payload.session_id
      }
      if ((tool === 'cursor.session' || tool === 'cursor.session.resume') && typeof event.payload.session_id === 'string') {
        return event.payload.session_id
      }
      if ((tool === 'gemini.session' || tool === 'gemini.session.resume') && typeof event.payload.session_id === 'string') {
        return event.payload.session_id
      }
      if (event.payload.protocol === 'acp' && typeof event.payload.session_id === 'string') {
        return event.payload.session_id
      }
    }
    return undefined
  }

  private providerTurnId(run: RunRecord): string | undefined {
    for (const event of [...run.events].reverse()) {
      if (event.type !== 'tool.completed' || event.payload.tool !== 'codex.turn.completed') continue
      if (typeof event.payload.turn_id === 'string') return event.payload.turn_id
    }
    return undefined
  }

  private captureRunDiff(run: RunRecord, workspacePath: string): Promise<CapturedDiffFile[]> {
    if (!existsSync(join(workspacePath, '.git')) || !run.workspaceBaseline) return Promise.resolve([])
    return captureDiffFromSnapshot(workspacePath, run.workspaceBaseline)
  }

  private async requestInteraction(
    run: RunRecord,
    request: HarnessInteractionRequest,
  ): Promise<HarnessInteractionResponse> {
    const requests = this.pendingInteractions.get(run.id) ?? new Map<string, PendingInteraction>()
    this.pendingInteractions.set(run.id, requests)
    const response = new Promise<HarnessInteractionResponse>((resolve, reject) => {
      requests.set(request.id, { kind: request.kind, run, resolve, reject })
    })
    await this.emit(run, request.kind === 'approval' ? 'approval.requested' : 'input.requested', {
      request_id: request.id,
      method: request.method,
      prompt: request.prompt,
      detail: request.detail,
      questions: request.questions,
      available_decisions: request.availableDecisions,
      metadata: request.metadata,
    })
    return await response
  }

  private clearInteractions(runId: string, error: Error): void {
    const requests = this.pendingInteractions.get(runId)
    if (!requests) return
    this.pendingInteractions.delete(runId)
    for (const pending of requests.values()) pending.reject(error)
  }

  private async emit(run: RunRecord, type: RunEventType, payload: Record<string, unknown>): Promise<void> {
    const event: RunEvent = {
      event_id: `evt_${randomUUID().slice(0, 12)}`,
      session_id: run.sessionId,
      run_id: run.id,
      sequence: run.events.length,
      timestamp: new Date().toISOString(),
      type,
      payload,
    }
    run.events.push(event)
    run.updatedAt = Date.now()
    await this.store.saveRun(run)
    for (const subscriber of this.subscribers.get(run.id) ?? []) subscriber(event)
  }
}
