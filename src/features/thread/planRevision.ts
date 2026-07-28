export interface PlanRevision {
  steps: string[]
  prompt: string
}

export function buildPlanRevision(draft: string): PlanRevision | undefined {
  const steps = draft
    .split('\n')
    .map((step) => step.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean)
    .slice(0, 12)
    .map((step) => step.slice(0, 240))
  if (!steps.length) return undefined
  return {
    steps,
    prompt: `Revise the active task plan to follow these steps:\n${steps.map((step) => `- ${step}`).join('\n')}`,
  }
}
