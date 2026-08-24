import { OperationController, type OperationSnapshot } from '../../runs/operationController'
import type { SessionEvent } from '../../../services/contracts'
import type { AgentRunBlock } from '../../../types'
import {
  GovernedDeliveryValidationError,
  adaptGovernedDeliveryProjection,
  type AdaptGovernedDeliveryInput,
  type DeliveryPresentationProjection,
} from '../domain'
import type { DeliveryRuntimeControls, GovernedDeliveryReadTransport } from './transport'

export interface GovernedDeliverySnapshot {
  projection: DeliveryPresentationProjection
  eventCount: number
  lastSequence: number
  reconnectCount: number
  availability: 'connected' | 'reconnecting' | 'unavailable'
  intervention: 'none' | 'cancel_requested' | 'guidance_sent'
}

interface ConnectDeliveryInput {
  operationId: string
  transport: GovernedDeliveryReadTransport
  projectionContext?: () => Omit<AdaptGovernedDeliveryInput, 'document'>
  onUpdate: (snapshot: GovernedDeliverySnapshot) => void
  onUnavailable?: (error: Error, snapshot?: GovernedDeliverySnapshot) => void
}

interface AttachRunInput {
  runId: string
  initialRun: AgentRunBlock
  initialText?: string
  subscribe: (runId: string, onEvent: (event: SessionEvent) => void, onError?: (error: Error) => void) => () => void
  onUpdate: (snapshot: OperationSnapshot) => void
  onTerminal?: (snapshot: OperationSnapshot) => void
  onUnavailable?: (error: Error, snapshot: OperationSnapshot) => void
}

interface StoredOperation {
  snapshot: GovernedDeliverySnapshot
  eventSignatures: Map<string, string>
}

function signature(event: DeliveryPresentationProjection['lifecycle'][number]): string {
  return JSON.stringify([
    event.eventType, event.state, event.fenceEpoch, event.occurredAt,
    event.requestDigest, event.receiptId, event.omission,
  ])
}

function authoritySignature(projection: DeliveryPresentationProjection): string {
  return JSON.stringify([
    projection.admissionId,
    projection.fenceEpoch,
    projection.changeSet.repository.issuer,
    projection.changeSet.repository.resourceId,
    projection.changeSet.baseRevision,
    projection.changeSet.headRevision,
    projection.changeSet.diff.digest,
    projection.changeSet.patch.digest,
    projection.verification.evidenceDigest,
    projection.receipt.receiptDigest,
    projection.receipt.requestDigest,
  ])
}

/**
 * Coordinates the accepted delivery read model with the integrated run
 * OperationController. Reconnects retain replay cursors; duplicate snapshots
 * and lifecycle events are suppressed; conflicting same-sequence events fail
 * closed. Runtime cancellation/intervention reuse existing runtime commands.
 */
export class GovernedDeliveryController {
  private readonly runtimeOperations = new OperationController()
  private readonly operations = new Map<string, StoredOperation>()
  private readonly subscriptions = new Map<string, () => void>()
  private readonly generations = new Map<string, number>()

  get(operationId: string): GovernedDeliverySnapshot | undefined {
    return this.operations.get(operationId)?.snapshot
  }

  attachRun(input: AttachRunInput): boolean {
    return this.runtimeOperations.attach(input)
  }

  releaseRun(runId: string): void {
    this.runtimeOperations.release(runId)
  }

  reconcile(input: AdaptGovernedDeliveryInput, reconnectCount = 0): GovernedDeliverySnapshot {
    const projection = adaptGovernedDeliveryProjection(input)
    const existing = this.operations.get(projection.operationId)
    if (existing && projection.fenceEpoch < existing.snapshot.projection.fenceEpoch) return existing.snapshot

    const incomingLastSequence = projection.lifecycle
      .filter((event) => event.fenceEpoch === projection.fenceEpoch)
      .reduce((last, event) => Math.max(last, event.sequence), 0)
    if (existing && projection.fenceEpoch === existing.snapshot.projection.fenceEpoch) {
      if (incomingLastSequence < existing.snapshot.lastSequence) return existing.snapshot
      if (incomingLastSequence === existing.snapshot.lastSequence
        && authoritySignature(projection) !== authoritySignature(existing.snapshot.projection)) {
        throw new GovernedDeliveryValidationError('authority_mismatch')
      }
    }

    const signatures = new Map(existing?.eventSignatures)
    for (const event of [...projection.lifecycle].sort((left, right) => left.fenceEpoch - right.fenceEpoch || left.sequence - right.sequence)) {
      if (event.fenceEpoch > projection.fenceEpoch) throw new GovernedDeliveryValidationError('authority_mismatch')
      const key = `${event.fenceEpoch}:${event.sequence}`
      const nextSignature = signature(event)
      const previousSignature = signatures.get(key)
      if (previousSignature !== undefined && previousSignature !== nextSignature) {
        throw new GovernedDeliveryValidationError('authority_mismatch')
      }
      signatures.set(key, nextSignature)
    }
    const currentFenceEvents = [...signatures.keys()]
      .map((key) => key.split(':').map(Number))
      .filter(([fence]) => fence === projection.fenceEpoch)
    const lastSequence = currentFenceEvents.reduce((last, [, sequence]) => Math.max(last, sequence), 0)
    const snapshot = Object.freeze({
      projection,
      eventCount: signatures.size,
      lastSequence,
      reconnectCount: Math.max(reconnectCount, existing?.snapshot.reconnectCount ?? 0),
      availability: 'connected' as const,
      intervention: existing?.snapshot.intervention ?? 'none',
    })
    this.operations.set(projection.operationId, { snapshot, eventSignatures: signatures })
    return snapshot
  }

  async connect(input: ConnectDeliveryInput): Promise<boolean> {
    if (this.subscriptions.has(input.operationId)) return false
    const generation = (this.generations.get(input.operationId) ?? 0) + 1
    this.generations.set(input.operationId, generation)
    const reconnectCount = this.operations.has(input.operationId)
      ? (this.operations.get(input.operationId)?.snapshot.reconnectCount ?? 0) + 1
      : 0
    let closedBeforeAttach = false
    const apply = (document: unknown) => {
      if (this.generations.get(input.operationId) !== generation) return
      const snapshot = this.reconcile({ document, ...input.projectionContext?.() }, reconnectCount)
      if (snapshot.projection.operationId !== input.operationId) throw new GovernedDeliveryValidationError('authority_mismatch')
      input.onUpdate(snapshot)
    }
    const unavailable = (error: Error) => {
      const stored = this.operations.get(input.operationId)
      if (stored) {
        const snapshot = Object.freeze({ ...stored.snapshot, availability: 'unavailable' as const })
        this.operations.set(input.operationId, { ...stored, snapshot })
        input.onUnavailable?.(error, snapshot)
      } else {
        input.onUnavailable?.(error)
      }
      if (this.subscriptions.has(input.operationId)) this.release(input.operationId)
      else closedBeforeAttach = true
    }

    // Subscribe before fetching the snapshot. Snapshot/live races are safe
    // because reconciliation is fence/sequence keyed and conflict detecting.
    const receive = (document: unknown) => {
      try { apply(document) } catch (error) {
        unavailable(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const unsubscribe = input.transport.subscribe(input.operationId, receive, unavailable)
    if (closedBeforeAttach) unsubscribe()
    else this.subscriptions.set(input.operationId, unsubscribe)
    if (closedBeforeAttach) return false
    try {
      apply(await input.transport.snapshot(input.operationId))
      return true
    } catch (error) {
      unavailable(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }

  async reconnect(input: ConnectDeliveryInput): Promise<boolean> {
    const stored = this.operations.get(input.operationId)
    if (stored) {
      const snapshot = Object.freeze({ ...stored.snapshot, availability: 'reconnecting' as const })
      this.operations.set(input.operationId, { ...stored, snapshot })
      input.onUpdate(snapshot)
    }
    this.release(input.operationId)
    return await this.connect(input)
  }

  async cancel(operationId: string, runId: string, controls: DeliveryRuntimeControls): Promise<void> {
    await controls.cancel(runId)
    this.markIntervention(operationId, 'cancel_requested')
  }

  async intervene(operationId: string, runId: string, guidance: string, controls: DeliveryRuntimeControls): Promise<void> {
    if (!guidance.trim()) throw new GovernedDeliveryValidationError('invalid_document')
    await controls.intervene(runId, guidance)
    this.markIntervention(operationId, 'guidance_sent')
  }

  private markIntervention(operationId: string, intervention: GovernedDeliverySnapshot['intervention']): void {
    const stored = this.operations.get(operationId)
    if (!stored) return
    const snapshot = Object.freeze({ ...stored.snapshot, intervention })
    this.operations.set(operationId, { ...stored, snapshot })
  }

  release(operationId: string): void {
    this.subscriptions.get(operationId)?.()
    this.subscriptions.delete(operationId)
    this.generations.set(operationId, (this.generations.get(operationId) ?? 0) + 1)
  }

  dispose(): void {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe()
    this.subscriptions.clear()
    this.runtimeOperations.dispose()
  }
}
