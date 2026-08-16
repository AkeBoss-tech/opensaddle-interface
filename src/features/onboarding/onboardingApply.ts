import type { ProjectOnboardingChange, ProjectOnboardingState } from '../../services/contracts'

export function onboardingApplyInput({
  appliedBy,
  change,
  state,
  git,
}: {
  appliedBy: string
  change: ProjectOnboardingChange
  state: ProjectOnboardingState | null
  git: { clean: boolean; head?: string | null }
}) {
  if (!git.clean) {
    throw new Error('The registered project has uncommitted changes. Clean or stash them before replaying this onboarding commit.')
  }
  if (!git.head) throw new Error('The registered project has no Git HEAD to fast-forward from.')
  if (!change.commit) throw new Error('OpenSaddle did not return the approved onboarding commit.')
  const expectedHead = change.baseCommit ?? state?.executionHead
  if (!expectedHead) throw new Error('OpenSaddle did not return the approved base commit. Refresh this run before applying it.')
  if (git.head !== expectedHead && git.head !== change.commit) {
    throw new Error('The registered project HEAD changed after this onboarding run. Refresh KRAIL discovery before applying another change.')
  }
  return {
    appliedBy,
    expectedHead,
    expectedCommit: change.commit,
  }
}
