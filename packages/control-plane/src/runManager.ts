import { randomUUID } from 'node:crypto'
import type { ControlPlaneConfig } from './config.js'
import { captureDiff, rejectDiffHunk, type CapturedDiffFile } from './diffCapture.js'
import { HarnessRegistry } from './harness/index.js'
import { ModelGateway } from './modelGateway.js'
import { RuntimeProvisioner } from './provisioner.js'
import { estimateRoute } from './router.js'
import { StateStore } from './store.js'
import type {
  AuthPrincipal,
  CodingProvider,
  Harness,
  ModelKey,
  RunEvent,
  RunEventType,
  RunRecord,
  RunDispatchTarget,
  RouteEstimate,
  RuntimeKind,
} from './types.js'

type Subscriber = (event: RunEvent) => void

export class RunManager {
  private readonly aborters = new Map<string, AbortController>()
  private readonly subscribers = new Map<string, Set<Subscriber>>()

  constructor(
    private readonly config: ControlPlaneConfig,
    private readonly store: StateStore,
    private readonly models: ModelGateway,
    private readonly provisioner: RuntimeProvisioner,
    private readonly harnesses: HarnessRegistry,
  ) {}

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
    dispatchTarget?: RunDispatchTarget
    workerId?: string
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
      task: input.task,
      route,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      events: [],
      reviewProviderKey: input.reviewProviderKey && input.reviewProviderKey !== 'auto'
        ? input.reviewProviderKey
        : undefined,
      dispatchTarget: input.dispatchTarget ?? 'cloud',
      workerId: input.workerId,
    }
    await this.store.saveRun(run)
    await this.store.appendAudit({
      id: `audit_${randomUUID().slice(0, 12)}`,
      timestamp: Date.now(),
      actorId: input.principal.userId,
      type: 'run.created',
      targetType: 'run',
      targetId: run.id,
      projectId: run.projectId,
      metadata: { harness: run.route.harnessKey, runtime: run.route.runtimeKey, dispatch_target: run.dispatchTarget, worker_id: run.workerId },
    })
    await this.emit(run, 'session.created', { route, dispatch_target: run.dispatchTarget, worker_id: run.workerId })

    if (run.dispatchTarget === 'local_worker') {
      await this.store.appendAudit({
        id: `audit_${randomUUID().slice(0, 12)}`,
        timestamp: Date.now(),
        actorId: input.principal.userId,
        type: 'run.dispatched_to_worker',
        targetType: 'run',
        targetId: run.id,
        projectId: run.projectId,
        metadata: { worker_id: run.workerId },
      })
      return run
    }

    const controller = new AbortController()
    this.aborters.set(run.id, controller)
    void this.execute(run, input.repo, input.principal, controller)
    return run
  }

  /** Claim queued browser-safe work for one connected local worker. */
  async claimWorkerDispatches(workerId: string, principal: AuthPrincipal): Promise<RunRecord[]> {
    const claimed = this.store.runs().filter((run) =>
      run.ownerId === principal.userId
      && run.dispatchTarget === 'local_worker'
      && run.workerId === workerId
      && run.status === 'queued',
    )
    for (const run of claimed) {
      run.status = 'running'
      run.updatedAt = Date.now()
      await this.emit(run, 'agent.started', { runtime: 'local_worker', worker_id: workerId, provider: 'browser-safe' })
      await this.store.saveRun(run)
    }
    return claimed
  }

  /** A worker reports only a bounded summary; durable run/audit state stays server-side. */
  async completeWorkerDispatch(input: {
    runId: string
    workerId: string
    principal: AuthPrincipal
    summary: string
    success: boolean
  }): Promise<void> {
    const run = this.store.run(input.runId)
    if (!run) throw new Error('Run not found')
    if (run.ownerId !== input.principal.userId || run.dispatchTarget !== 'local_worker' || run.workerId !== input.workerId) {
      throw new Error('Run is not assigned to this local worker')
    }
    if (run.status !== 'running' && run.status !== 'queued') throw new Error('Run is no longer dispatchable')
    if (run.status === 'queued') {
      run.status = 'running'
      await this.emit(run, 'agent.started', { runtime: 'local_worker', worker_id: input.workerId, provider: 'browser-safe' })
    }
    await this.emit(run, 'agent.output.delta', { text: input.summary.slice(0, 20_000), worker_id: input.workerId })
    run.status = input.success ? 'completed' : 'failed'
    run.error = input.success ? undefined : input.summary.slice(0, 20_000)
    run.updatedAt = Date.now()
    await this.emit(run, input.success ? 'agent.completed' : 'agent.failed', { worker_id: input.workerId, dispatch_target: 'local_worker' })
    await this.emit(run, 'session.closed', { status: run.status })
    await this.store.saveRun(run)
    await this.recordTelemetry(run, input.success)
    await this.store.appendAudit({
      id: `audit_${randomUUID().slice(0, 12)}`,
      timestamp: Date.now(),
      actorId: input.principal.userId,
      type: input.success ? 'worker.dispatch_completed' : 'worker.dispatch_failed',
      targetType: 'run',
      targetId: run.id,
      projectId: run.projectId,
      metadata: { worker_id: input.workerId },
    })
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
    if (decision === 'accepted') return
    const runtime = run.runtimeId ? this.store.runtime(run.runtimeId) : undefined
    if (!runtime?.workspacePath) throw new Error('Run workspace is unavailable')
    const event = [...run.events].reverse().find((candidate) => candidate.type === 'diff.updated')
    const files = Array.isArray(event?.payload.files) ? event.payload.files as unknown as CapturedDiffFile[] : []
    await rejectDiffHunk(runtime.workspacePath, files, filePath, hunkIndex)
    await this.emit(run, 'diff.updated', { files: await captureDiff(runtime.workspacePath) })
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
    if (run.status !== 'queued' && run.status !== 'running') return true
    run.status = 'cancelled'
    run.updatedAt = Date.now()
    this.aborters.get(runId)?.abort()
    await this.emit(run, 'agent.failed', { reason: 'cancelled' })
    await this.emit(run, 'session.closed', { status: 'cancelled' })
    await this.store.saveRun(run)
    await this.store.appendAudit({
      id: `audit_${randomUUID().slice(0, 12)}`,
      timestamp: Date.now(),
      actorId: principal.userId,
      type: 'run.cancelled',
      targetType: 'run',
      targetId: run.id,
      projectId: run.projectId,
    })
    return true
  }

  private async execute(
    run: RunRecord,
    repo: string | undefined,
    principal: AuthPrincipal,
    controller: AbortController,
  ): Promise<void> {
    try {
      run.status = 'running'
      run.updatedAt = Date.now()
      await this.store.saveRun(run)

      const runtime = await this.provisioner.provision({
        projectId: run.projectId,
        kind: run.route.runtimeKey,
        repo,
        principal,
      })
      run.runtimeId = runtime.id
      await this.emit(run, 'tool.completed', {
        tool: 'runtime.provision',
        runtime_id: runtime.id,
        provider: this.config.runtimeProvider,
      })

      const workspacePath = runtime.workspacePath ?? this.config.workspaceDir
      const emit = (type: RunEventType, payload: Record<string, unknown>) => this.emit(run, type, payload)

      if (run.route.harnessKey === 'coding') {
        const result = await this.harnesses.run({
          runId: run.id,
          sessionId: run.sessionId,
          task: run.task,
          projectId: run.projectId,
          agentId: run.agentId,
          route: run.route,
          workspacePath,
          providerId: run.route.providerKey,
          signal: controller.signal,
          emit,
        })
        if (!controller.signal.aborted) {
          await this.emit(run, 'agent.output.delta', { text: result.summary })
        }
        const files = await captureDiff(workspacePath)
        if (files.length) await this.emit(run, 'diff.updated', { files })

        if (run.reviewProviderKey && run.reviewProviderKey !== run.route.providerKey) {
          await this.emit(run, 'review.started', { provider: run.reviewProviderKey })
          try {
            const reviewRoute = { ...run.route, providerKey: run.reviewProviderKey }
            const review = await this.harnesses.run({
              runId: run.id,
              sessionId: run.sessionId,
              task: 'Review the current working-tree diff. Do not modify files. Report correctness, security, and test issues concisely.',
              projectId: run.projectId,
              agentId: run.agentId,
              route: reviewRoute,
              workspacePath,
              providerId: run.reviewProviderKey,
              signal: controller.signal,
              emit,
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
          task: run.task,
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
      run.status = 'completed'
      run.updatedAt = Date.now()
      await this.emit(run, 'agent.completed', {
        runtime_id: runtime.id,
        provider: run.route.providerKey,
      })
      await this.emit(run, 'session.closed', { status: 'completed' })
      await this.store.saveRun(run)
      await this.recordTelemetry(run, true)
    } catch (error) {
      if (controller.signal.aborted) return
      run.status = 'failed'
      run.error = error instanceof Error ? error.message : String(error)
      run.updatedAt = Date.now()
      await this.emit(run, 'agent.failed', { error: run.error })
      await this.emit(run, 'session.closed', { status: 'failed' })
      await this.store.saveRun(run)
      await this.recordTelemetry(run, false)
    } finally {
      this.aborters.delete(run.id)
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
    await this.store.appendAudit({
      id: `audit_${randomUUID().slice(0, 12)}`,
      timestamp: Date.now(),
      actorId: run.ownerId,
      type: succeeded ? 'run.completed' : 'run.failed',
      targetType: 'run',
      targetId: run.id,
      projectId: run.projectId,
      metadata: { duration_ms: Math.max(0, run.updatedAt - run.createdAt) },
    })
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
