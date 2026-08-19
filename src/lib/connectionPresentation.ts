import type { ConnectionProfile, ServiceBundle } from '../services'

export interface ConnectionPresentation {
  label: string
  title: string
  connected: boolean
  kind: 'connected' | 'demo' | 'connecting' | 'reconnecting'
}

export function connectionPresentation(input: {
  connection: ConnectionProfile
  controlPlane: ServiceBundle['controlPlane'] | null
  desktop: boolean
}): ConnectionPresentation {
  const { connection, controlPlane, desktop } = input
  if (connection.mode === 'demo') {
    return {
      label: 'Demo',
      title: 'Seeded sample workspace · simulated runs · browser-only state',
      connected: false,
      kind: 'demo',
    }
  }
  if (controlPlane?.connected) {
    const label = controlPlane.mode === 'company' ? 'Cloud' : 'Local'
    return {
      label,
      title: `${label} control plane · ${controlPlane.modelProvider ?? 'native harnesses'} · ${controlPlane.storage ?? 'server'}`,
      connected: true,
      kind: 'connected',
    }
  }

  if (!controlPlane) {
    return {
      label: 'Connecting…',
      title: desktop ? 'Starting the local OpenSaddle server' : `Connecting to ${connection.baseUrl}`,
      connected: false,
      kind: 'connecting',
    }
  }

  if (connection.mode === 'remote') {
    return {
      label: 'Reconnecting…',
      title: `Waiting for ${connection.baseUrl}`,
      connected: false,
      kind: 'reconnecting',
    }
  }

  return { label: 'Demo', title: 'Seeded sample workspace · simulated runs · browser-only state', connected: false, kind: 'demo' }
}
