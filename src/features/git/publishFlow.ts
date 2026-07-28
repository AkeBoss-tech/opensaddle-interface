import type { GitStatusResult } from '../../services/contracts'

export type PublishFlowStep = 'repository' | 'commit' | 'push' | 'branch' | 'pull-request'

export function selectPublishFlowStep(input: {
  repositoryPath?: string
  status?: GitStatusResult | null
  defaultBase: string
}): PublishFlowStep {
  if (!input.repositoryPath || !input.status) return 'repository'
  if (!input.status.clean) return 'commit'
  if (input.status.ahead > 0) return 'push'
  if (!input.status.branch || input.status.branch === input.defaultBase) return 'branch'
  return 'pull-request'
}
