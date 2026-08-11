import type { RuntimeClient } from '../../../services/contracts'

/** Read-only transport for the reviewed governed-delivery read model. */
export interface GovernedDeliveryReadTransport {
  snapshot(operationId: string): Promise<unknown>
  subscribe(operationId: string, onSnapshot: (document: unknown) => void, onError?: (error: Error) => void): () => void
}

export interface DeliveryRuntimeControls {
  cancel(runId: string): Promise<void>
  intervene(runId: string, guidance: string): Promise<void>
}

/**
 * Reuses the integrated runtime command surface. It does not define delivery
 * endpoints or grant proposal, approval, publication, or receipt authority.
 */
export function createDeliveryRuntimeControls(
  runtime: Pick<RuntimeClient, 'cancel' | 'steer'>,
): DeliveryRuntimeControls {
  return Object.freeze({
    cancel: (runId: string) => runtime.cancel(runId),
    intervene: (runId: string, guidance: string) => runtime.steer(runId, guidance),
  })
}
