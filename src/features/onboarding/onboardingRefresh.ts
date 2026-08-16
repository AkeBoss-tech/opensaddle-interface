import type { ProjectOnboardingChange, ProjectOnboardingState } from '../../services/contracts'

const REFRESH_BLOCKING_STATUSES = new Set([
  'running',
  'approval_required',
  'verification_failed',
  'committed',
])
const REFRESH_ALLOWED_STATE_STATUSES = new Set(['failed', 'interrupted', 'applied'])
const REFRESH_ALLOWED_RUN_STATUSES = new Set(['failed', 'interrupted', 'rejected', 'applied'])

function barrier(runId: string, status: string) {
  const label = status.replaceAll('_', ' ')
  return `Run ${runId} is ${label}. Finish or reject the active review, and apply any committed change, before refreshing discovery.`
}

export function onboardingRefreshBarrier(
  state: ProjectOnboardingState | null,
  change: ProjectOnboardingChange | null,
): string | null {
  const activeRunId = state?.activeRunId
  if (change && REFRESH_BLOCKING_STATUSES.has(change.status)) {
    return barrier(activeRunId ?? change.runId, change.status)
  }
  if (!activeRunId) return null
  if (change && change.runId !== activeRunId) {
    return barrier(activeRunId, state?.status ?? 'active')
  }
  if (!state || !REFRESH_ALLOWED_STATE_STATUSES.has(state.status)) {
    return barrier(activeRunId, state?.status ?? change?.status ?? 'active')
  }
  if (change && !REFRESH_ALLOWED_RUN_STATUSES.has(change.status)) {
    return barrier(activeRunId, change.status)
  }
  return null
}
