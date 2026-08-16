export const REQUIRED_OPENSADDLE_CAPABILITY = 'project_onboarding'
export const REQUIRED_PROJECT_ONBOARDING_CONTRACT = 'opensaddle.project-onboarding/v1'

export type SidecarHealth = 'compatible' | 'incompatible' | 'absent'

export function classifySidecarHealth(payload: unknown): Exclude<SidecarHealth, 'absent'> {
  if (!payload || typeof payload !== 'object') return 'incompatible'
  const health = payload as {
    service?: unknown
    mode?: unknown
    capabilities?: unknown
    contracts?: unknown
  }
  const contracts = health.contracts && typeof health.contracts === 'object'
    ? health.contracts as Record<string, unknown>
    : null
  return health.service === 'opensaddle'
    && health.mode === 'local'
    && Array.isArray(health.capabilities)
    && health.capabilities.includes(REQUIRED_OPENSADDLE_CAPABILITY)
    && contracts?.project_onboarding === REQUIRED_PROJECT_ONBOARDING_CONTRACT
    ? 'compatible'
    : 'incompatible'
}

export function incompatibleSidecarMessage(url: string, configured: boolean): string {
  const remediation = configured
    ? 'Stop or upgrade that daemon, or set OPENSADDLE_URL to a free loopback port.'
    : 'OpenSaddle Desktop will start its bundled backend on a separate loopback port.'
  return `An incompatible OpenSaddle daemon is listening at ${url}; it does not advertise ${REQUIRED_OPENSADDLE_CAPABILITY} at ${REQUIRED_PROJECT_ONBOARDING_CONTRACT}. ${remediation}`
}
