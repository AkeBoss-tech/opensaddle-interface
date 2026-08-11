import type { InvestigationProjection, InvestigationSnapshot } from '../domain'
import type { OperationProposalPresentation } from './operationProposal'

export interface InvestigationSessionIdentity {
  investigationId: string
  expectedThreadId: string | null
  expectedProjectId: string | null
}

export interface KeyedInvestigationSnapshot {
  investigationId: string | null
  snapshot: InvestigationSnapshot
}

export interface KeyedProposalState {
  bindingKey: string | null
  proposal?: OperationProposalPresentation
  loading: boolean
  error?: string
}

export interface PresentedProposalState {
  proposal?: OperationProposalPresentation
  loading: boolean
  error?: string
}

function requestingSnapshot(): InvestigationSnapshot {
  return { lifecycle: { phase: 'requesting', operation: 'reconnect' } }
}

export function unavailableIdentitySnapshot(): InvestigationSnapshot {
  return {
    lifecycle: {
      phase: 'failed',
      failure: {
        code: 'unavailable',
        message: 'Investigation is unavailable for this Thread or project',
        retryable: false,
      },
    },
  }
}

/** Fences state synchronously while React effects switch controller subscriptions. */
export function selectBoundInvestigationSnapshot(
  identity: InvestigationSessionIdentity,
  state: KeyedInvestigationSnapshot,
): InvestigationSnapshot {
  if (!identity.expectedThreadId || !identity.expectedProjectId) return unavailableIdentitySnapshot()
  if (state.investigationId !== identity.investigationId) return requestingSnapshot()
  const lifecycleProjection = state.snapshot.lifecycle.phase === 'failed'
    ? state.snapshot.lifecycle.lastProjection
    : undefined
  const projection = state.snapshot.projection ?? lifecycleProjection
  if (!projection) return state.snapshot
  if (
    projection.investigationId !== identity.investigationId
    || projection.outcomeThreadId !== identity.expectedThreadId
    || projection.projectId !== identity.expectedProjectId
  ) return unavailableIdentitySnapshot()
  return state.snapshot
}

export function proposalBindingKey(projection?: InvestigationProjection): string | null {
  const proposal = projection?.operationProposal
  if (!projection || !proposal?.proposalId || !proposal.protectedInputDigest || !projection.planDigest) return null
  if (proposal.protectedInputDigest !== projection.planDigest) return null
  return JSON.stringify([
    projection.investigationId,
    projection.outcomeThreadId,
    projection.projectId,
    projection.planVersion,
    proposal.proposalId,
    proposal.protectedInputDigest,
    projection.planDigest,
  ])
}

export function operationProposalMatchesProjection(
  proposal: OperationProposalPresentation,
  projection: InvestigationProjection,
): boolean {
  return proposal.proposalId === projection.operationProposal.proposalId
    && proposal.projectId === projection.projectId
    && proposal.protectedInputDigest === projection.operationProposal.protectedInputDigest
    && proposal.protectedInputDigest === projection.planDigest
    && proposal.correlationIds.includes(projection.investigationId)
    && proposal.correlationIds.includes(projection.outcomeThreadId)
}

/** Never returns proposal, loading, or error state from a previous binding. */
export function selectBoundProposalState(
  projection: InvestigationProjection | undefined,
  state: KeyedProposalState,
): PresentedProposalState {
  const bindingKey = proposalBindingKey(projection)
  if (!bindingKey) return { loading: false }
  if (state.bindingKey !== bindingKey) return { loading: true }
  if (state.proposal && projection && !operationProposalMatchesProjection(state.proposal, projection)) return { loading: true }
  return { proposal: state.proposal, loading: state.loading, error: state.error }
}
