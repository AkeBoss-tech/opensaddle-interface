import { useEffect, useMemo, useState } from 'react'
import { type HumanPlanDraft, type InvestigationSnapshot } from '../domain'
import { HttpInvestigationTransport, InvestigationController } from '../services'
import { fetchOperationProposal, proposalCostInput, type OperationProposalPresentation } from './operationProposal'
import {
  proposalBindingKey,
  selectBoundInvestigationSnapshot,
  selectBoundProposalState,
  type KeyedInvestigationSnapshot,
  type KeyedProposalState,
} from './sessionState'

export interface GroundedInvestigationSession {
  snapshot: InvestigationSnapshot
  proposal?: OperationProposalPresentation
  proposalLoading: boolean
  proposalError?: string
  retry: () => Promise<void>
  cancel: () => Promise<void>
  reconnect: () => Promise<void>
  savePlan: (draft: Omit<HumanPlanDraft, 'schemaVersion' | 'authoredBy'>) => Promise<void>
}

export function useGroundedInvestigation(input: {
  investigationId: string | null
  baseUrl: string
  userId: string
  token?: string
  expectedThreadId: string | null
  expectedProjectId: string | null
}): GroundedInvestigationSession | null {
  const controller = useMemo(() => new InvestigationController(
    new HttpInvestigationTransport(input.baseUrl, () => input.userId, input.token),
  ), [input.baseUrl, input.token, input.userId])
  const [snapshotState, setSnapshotState] = useState<KeyedInvestigationSnapshot>({ investigationId: null, snapshot: { lifecycle: { phase: 'idle' } } })
  const [proposalState, setProposalState] = useState<KeyedProposalState>({ bindingKey: null, loading: false })

  useEffect(() => {
    if (!input.investigationId || !input.expectedThreadId || !input.expectedProjectId) {
      setSnapshotState({ investigationId: null, snapshot: { lifecycle: { phase: 'idle' } } })
      return
    }
    const investigationId = input.investigationId
    let active = true
    const publish = (snapshot: InvestigationSnapshot) => {
      if (active) setSnapshotState({ investigationId, snapshot })
    }
    const unsubscribe = controller.subscribe(investigationId, publish)
    void controller.reconnect(investigationId)
      .then((projection) => publish({ lifecycle: { phase: 'settled', projection }, projection }))
      .catch(() => undefined)
    return () => { active = false; unsubscribe() }
  }, [controller, input.expectedProjectId, input.expectedThreadId, input.investigationId])

  const requestedInvestigationId = input.investigationId
  const snapshot = requestedInvestigationId
    ? selectBoundInvestigationSnapshot({
        investigationId: requestedInvestigationId,
        expectedThreadId: input.expectedThreadId,
        expectedProjectId: input.expectedProjectId,
      }, snapshotState)
    : { lifecycle: { phase: 'idle' } } as InvestigationSnapshot
  const projection = snapshot.projection
  const bindingKey = proposalBindingKey(projection)
  useEffect(() => {
    if (!projection?.operationProposal.proposalId || !bindingKey) {
      setProposalState({ bindingKey: null, loading: false })
      return
    }
    let cancelled = false
    setProposalState({ bindingKey, loading: true })
    void fetchOperationProposal(input.baseUrl, input.userId, input.token, projection)
      .then((value) => { if (!cancelled) setProposalState({ bindingKey, proposal: value, loading: false }) })
      .catch((error) => { if (!cancelled) setProposalState({ bindingKey, loading: false, error: error instanceof Error ? error.message : 'Operation proposal is unavailable' }) })
    return () => { cancelled = true }
  }, [bindingKey, input.baseUrl, input.token, input.userId, projection])

  const presentedProposal = selectBoundProposalState(projection, proposalState)
  if (!requestedInvestigationId) return null
  const investigationId = requestedInvestigationId
  const publishProjection = async (request: Promise<NonNullable<InvestigationSnapshot['projection']>>) => {
    const next = await request
    setSnapshotState({ investigationId, snapshot: { lifecycle: { phase: 'settled', projection: next }, projection: next } })
  }
  return {
    snapshot,
    proposal: presentedProposal.proposal,
    proposalLoading: presentedProposal.loading,
    proposalError: presentedProposal.error,
    retry: async () => { await publishProjection(controller.retry(investigationId)) },
    cancel: async () => { await publishProjection(controller.cancel(investigationId)) },
    reconnect: async () => { await publishProjection(controller.reconnect(investigationId)) },
    savePlan: async (draft) => {
      const current = controller.projection(investigationId)
      const currentProposal = selectBoundProposalState(current, proposalState).proposal
      if (!current || !currentProposal) throw new Error('A registered action must be bound before preparing a dry-run proposal')
      await publishProjection(controller.savePlanDraft(investigationId, {
        expectedVersion: current.planVersion,
        title: draft.title,
        objective: draft.objective,
        steps: draft.steps,
        assumptions: draft.assumptions,
        registeredActionId: currentProposal.registeredActionId,
        registeredActionVersion: currentProposal.registeredActionVersion,
        costEstimate: proposalCostInput(currentProposal),
      }))
    },
  }
}
