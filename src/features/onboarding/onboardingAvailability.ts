import type { ServiceBundle } from '../../services'

export const GOVERNED_PROJECT_ONBOARDING_CONTRACT = 'opensaddle.project-onboarding/v1'

export function supportsGovernedProjectOnboarding(
  services: Pick<ServiceBundle, 'controlPlane' | 'localProjects'> | null | undefined,
): boolean {
  const client = services?.localProjects
  return Boolean(
    services?.controlPlane.connected
    && services.controlPlane.mode === 'local'
    && services.controlPlane.capabilities.includes('project_onboarding')
    && services.controlPlane.contracts?.project_onboarding === GOVERNED_PROJECT_ONBOARDING_CONTRACT
    && client?.registerProject
    && client.onboardingState
    && client.onboardingReadiness
    && client.prepareOnboarding
    && client.startOnboardingRecommendation
    && client.onboardingChange
    && client.onboardingDiff
    && client.approveOnboardingChange
    && client.rejectOnboardingChange
    && client.applyOnboardingCommit,
  )
}
