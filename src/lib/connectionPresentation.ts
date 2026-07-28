import type { ConnectionProfile, ServiceBundle } from '../services'

export interface ConnectionPresentation {
  label: string
  title: string
  connected: boolean
}

export function connectionPresentation(input: {
  connection: ConnectionProfile
  controlPlane: ServiceBundle['controlPlane'] | null
  desktop: boolean
}): ConnectionPresentation {
  const { connection, controlPlane, desktop } = input
  if (controlPlane?.connected) {
    const label = controlPlane.mode === 'company' ? 'Cloud' : 'Local'
    return {
      label,
      title: `${label} control plane · ${controlPlane.modelProvider ?? 'native harnesses'} · ${controlPlane.storage ?? 'server'}`,
      connected: true,
    }
  }

  if (!controlPlane) {
    return {
      label: 'Connecting…',
      title: desktop ? 'Starting the local OpenSaddle server' : `Connecting to ${connection.baseUrl}`,
      connected: false,
    }
  }

  if (connection.mode === 'remote') {
    return {
      label: 'Reconnecting…',
      title: `Waiting for ${connection.baseUrl}`,
      connected: false,
    }
  }

  return {
    label: 'Offline',
    title: 'Browser cache · no control plane configured',
    connected: false,
  }
}
