import type { ServiceBundle } from '../../services'

export function supportsGovernedProjectOnboarding(
  services: Pick<ServiceBundle, 'controlPlane' | 'localProjects'> | null | undefined,
): boolean {
  const client = services?.localProjects
  return Boolean(
    services?.controlPlane.connected
    && services.controlPlane.mode === 'local'
    && services.controlPlane.capabilities.includes('project_onboarding')
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
