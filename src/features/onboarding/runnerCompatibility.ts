import type { ProjectOnboardingReadiness } from '../../services/contracts'

export function runnerCompatibilityBarrier(
  readiness: ProjectOnboardingReadiness | null | undefined,
): string | null {
  if (!readiness || readiness.checks.runner_compatible) return null
  const compatibility = readiness.runnerCompatibility
  const reason = compatibility.reason
    ?? `OpenSaddle could not verify the installed runner (${compatibility.status}).`
  const missing = compatibility.missingOptions.length
    ? `Required CLI options not advertised: ${compatibility.missingOptions.join(', ')}.`
    : ''
  return [reason, missing, compatibility.upgradeGuidance ?? 'Upgrade the runner and refresh readiness.']
    .filter(Boolean)
    .join(' ')
}
