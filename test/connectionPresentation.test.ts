import assert from 'node:assert/strict'
import test from 'node:test'
import { connectionPresentation } from '../src/lib/connectionPresentation.ts'
import type { ConnectionProfile, ServiceBundle } from '../src/services/index.ts'

const localConnection: ConnectionProfile = {
  id: 'local',
  name: 'Local OpenSaddle server',
  mode: 'remote',
  baseUrl: 'http://127.0.0.1:8765',
  allowMockFallback: false,
}

test('presents browser startup as an active connection attempt', () => {
  assert.deepEqual(connectionPresentation({
    connection: localConnection,
    controlPlane: null,
    desktop: false,
  }), {
    label: 'Connecting…',
    title: 'Connecting to http://127.0.0.1:8765',
    connected: false,
  })
})

test('presents a disconnected remote bundle as recoverable', () => {
  assert.deepEqual(connectionPresentation({
    connection: localConnection,
    controlPlane: {
      connected: false,
      models: [],
    },
    desktop: false,
  }), {
    label: 'Reconnecting…',
    title: 'Waiting for http://127.0.0.1:8765',
    connected: false,
  })
})

test('presents a recovered local control plane with its durable storage', () => {
  const controlPlane: ServiceBundle['controlPlane'] = {
    connected: true,
    mode: 'local',
    models: [],
    storage: 'sqlite',
  }
  assert.deepEqual(connectionPresentation({
    connection: localConnection,
    controlPlane,
    desktop: false,
  }), {
    label: 'Local',
    title: 'Local control plane · native harnesses · sqlite',
    connected: true,
  })
})
