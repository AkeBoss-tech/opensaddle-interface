import type {
  CreateInvestigationInput,
  InvestigationProjection,
  ReconcileInvestigationInput,
  SavePlanDraftInput,
} from '../domain'

export interface InvestigationTransport {
  create(input: CreateInvestigationInput, signal?: AbortSignal): Promise<InvestigationProjection>
  get(investigationId: string, signal?: AbortSignal): Promise<InvestigationProjection>
  retry(investigationId: string, signal?: AbortSignal): Promise<InvestigationProjection>
  cancel(investigationId: string, signal?: AbortSignal): Promise<InvestigationProjection>
  reconcile(investigationId: string, input: ReconcileInvestigationInput, signal?: AbortSignal): Promise<InvestigationProjection>
  savePlan(investigationId: string, input: SavePlanDraftInput, signal?: AbortSignal): Promise<InvestigationProjection>
}
