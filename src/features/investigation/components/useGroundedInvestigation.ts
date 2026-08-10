import { useEffect, useMemo, useState } from 'react'
import { type HumanPlanDraft, type InvestigationSnapshot } from '../domain'
import { HttpInvestigationTransport, InvestigationController } from '../services'
import { fetchOperationProposal, proposalCostInput, type OperationProposalPresentation } from './operationProposal'

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
}): GroundedInvestigationSession | null {
  const controller = useMemo(() => new InvestigationController(
    new HttpInvestigationTransport(input.baseUrl, () => input.userId, input.token),
  ), [input.baseUrl, input.token, input.userId])
  const [snapshot, setSnapshot] = useState<InvestigationSnapshot>({ lifecycle: { phase: 'idle' } })
  const [proposal, setProposal] = useState<OperationProposalPresentation>()
  const [proposalLoading, setProposalLoading] = useState(false)
  const [proposalError, setProposalError] = useState<string>()

  useEffect(() => {
    if (!input.investigationId) {
      setSnapshot({ lifecycle: { phase: 'idle' } })
      return
    }
    const unsubscribe = controller.subscribe(input.investigationId, setSnapshot)
    void controller.reconnect(input.investigationId).catch(() => undefined)
    return unsubscribe
  }, [controller, input.investigationId])

  const projection = snapshot.projection
  useEffect(() => {
    if (!projection?.operationProposal.proposalId) {
      setProposal(undefined)
      setProposalError(undefined)
      setProposalLoading(false)
      return
    }
    let cancelled = false
    setProposalLoading(true)
    setProposalError(undefined)
    void fetchOperationProposal(input.baseUrl, input.userId, input.token, projection)
      .then((value) => { if (!cancelled) setProposal(value) })
      .catch((error) => { if (!cancelled) { setProposal(undefined); setProposalError(error instanceof Error ? error.message : 'Operation proposal is unavailable') } })
      .finally(() => { if (!cancelled) setProposalLoading(false) })
    return () => { cancelled = true }
  }, [input.baseUrl, input.token, input.userId, projection])

  if (!input.investigationId) return null
  const investigationId = input.investigationId
  return {
    snapshot,
    proposal,
    proposalLoading,
    proposalError,
    retry: async () => { await controller.retry(investigationId) },
    cancel: async () => { await controller.cancel(investigationId) },
    reconnect: async () => { await controller.reconnect(investigationId) },
    savePlan: async (draft) => {
      const current = controller.projection(investigationId)
      if (!current || !proposal) throw new Error('A registered action must be bound before preparing a dry-run proposal')
      await controller.savePlanDraft(investigationId, {
        expectedVersion: current.planVersion,
        title: draft.title,
        objective: draft.objective,
        steps: draft.steps,
        assumptions: draft.assumptions,
        registeredActionId: proposal.registeredActionId,
        registeredActionVersion: proposal.registeredActionVersion,
        costEstimate: proposalCostInput(proposal),
      })
    },
  }
}
