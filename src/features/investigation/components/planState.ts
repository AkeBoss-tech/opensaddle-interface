import type { InvestigationProjection } from '../domain'

export interface PlanFields {
  title: string
  objective: string
  steps: string
  assumptions: string
}

export function planFields(projection?: InvestigationProjection): PlanFields {
  const draft = projection?.planDraft
  return {
    title: draft?.title ?? 'Investigation plan',
    objective: draft?.objective ?? projection?.query ?? '',
    steps: draft?.steps.join('\n') ?? '',
    assumptions: draft?.assumptions.join('\n') ?? '',
  }
}

export function isPlanBindingInvalidated(fields: PlanFields, projection?: InvestigationProjection): boolean {
  const current = planFields(projection)
  return fields.title !== current.title
    || fields.objective !== current.objective
    || fields.steps !== current.steps
    || fields.assumptions !== current.assumptions
}
