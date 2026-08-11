import {
  investigationFailure,
  type CreateInvestigationInput,
  type InvestigationProjection,
  type InvestigationSnapshot,
  type ReconcileInvestigationInput,
  type SavePlanDraftInput,
} from '../domain'
import type { InvestigationTransport } from './transport'

type Listener = (snapshot: InvestigationSnapshot) => void

function identity(input: CreateInvestigationInput): string {
  return JSON.stringify({
    projectId: input.projectId,
    repository: [input.repository.issuer, input.repository.resourceType, input.repository.resourceId],
    issue: [input.issue.issuer, input.issue.resourceType, input.issue.resourceId],
    query: input.query ?? null,
  })
}

function newer(next: InvestigationProjection, previous?: InvestigationProjection): boolean {
  if (!previous) return true
  if (next.attempt !== previous.attempt) return next.attempt > previous.attempt
  if (next.planVersion !== previous.planVersion) return next.planVersion > previous.planVersion
  return Date.parse(next.updatedAt) >= Date.parse(previous.updatedAt)
}

/**
 * In-memory navigation/reconnect coordinator. Authoritative investigation state
 * always comes from OpenSaddle; this controller never writes workspace state.
 */
export class InvestigationController {
  private readonly projections = new Map<string, InvestigationProjection>()
  private readonly byThread = new Map<string, string>()
  private readonly inFlightCreates = new Map<string, Promise<InvestigationProjection>>()
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly operations = new Map<string, AbortController>()
  private readonly transport: InvestigationTransport

  constructor(transport: InvestigationTransport) { this.transport = transport }

  projection(investigationId: string): InvestigationProjection | undefined {
    return this.projections.get(investigationId)
  }

  forOutcomeThread(threadId: string): InvestigationProjection | undefined {
    const investigationId = this.byThread.get(threadId)
    return investigationId ? this.projections.get(investigationId) : undefined
  }

  subscribe(investigationId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(investigationId) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(investigationId, listeners)
    const projection = this.projections.get(investigationId)
    listener(projection ? { lifecycle: { phase: 'settled', projection }, projection } : { lifecycle: { phase: 'idle' } })
    return () => listeners.delete(listener)
  }

  createOrResume(input: CreateInvestigationInput): Promise<InvestigationProjection> {
    const key = identity(input)
    const existing = this.inFlightCreates.get(key)
    if (existing) return existing
    const request = this.transport.create(input).then((projection) => this.accept(projection)).finally(() => this.inFlightCreates.delete(key))
    this.inFlightCreates.set(key, request)
    return request
  }

  reconnect(investigationId: string) { return this.perform(investigationId, 'reconnect', (signal) => this.transport.get(investigationId, signal)) }
  retry(investigationId: string) { return this.perform(investigationId, 'retry', (signal) => this.transport.retry(investigationId, signal)) }
  reconcile(investigationId: string, input: ReconcileInvestigationInput) { return this.perform(investigationId, 'reconcile', (signal) => this.transport.reconcile(investigationId, input, signal)) }
  savePlanDraft(investigationId: string, input: SavePlanDraftInput) { return this.perform(investigationId, 'plan', (signal) => this.transport.savePlan(investigationId, input, signal)) }

  async cancel(investigationId: string): Promise<InvestigationProjection> {
    this.operations.get(investigationId)?.abort()
    return this.perform(investigationId, 'cancel', (signal) => this.transport.cancel(investigationId, signal))
  }

  /** Accepts replay/reconnect updates while suppressing stale/out-of-order responses. */
  accept(projection: InvestigationProjection): InvestigationProjection {
    const previous = this.projections.get(projection.investigationId)
    if (!newer(projection, previous)) return previous ?? projection
    this.projections.set(projection.investigationId, projection)
    this.byThread.set(projection.outcomeThreadId, projection.investigationId)
    this.emit(projection.investigationId, { lifecycle: { phase: 'settled', projection }, projection })
    return projection
  }

  private async perform(
    investigationId: string,
    operation: 'retry' | 'reconcile' | 'cancel' | 'plan' | 'reconnect',
    request: (signal: AbortSignal) => Promise<InvestigationProjection>,
  ): Promise<InvestigationProjection> {
    this.operations.get(investigationId)?.abort()
    const abort = new AbortController()
    this.operations.set(investigationId, abort)
    this.emit(investigationId, { lifecycle: { phase: 'requesting', operation }, projection: this.projections.get(investigationId) })
    try {
      return this.accept(await request(abort.signal))
    } catch (error) {
      const failure = investigationFailure(error)
      this.emit(investigationId, { lifecycle: { phase: 'failed', failure, lastProjection: this.projections.get(investigationId) }, projection: this.projections.get(investigationId) })
      throw error
    } finally {
      if (this.operations.get(investigationId) === abort) this.operations.delete(investigationId)
    }
  }

  private emit(investigationId: string, snapshot: InvestigationSnapshot): void {
    for (const listener of this.listeners.get(investigationId) ?? []) listener(snapshot)
  }
}
