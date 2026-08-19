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
    kind: 'connecting',
  })
})

test('presents a disconnected remote bundle as recoverable', () => {
  assert.deepEqual(connectionPresentation({
    connection: localConnection,
    controlPlane: {
      connected: false,
      models: [],
      capabilities: [],
    },
    desktop: false,
  }), {
    label: 'Reconnecting…',
    title: 'Waiting for http://127.0.0.1:8765',
    connected: false,
    kind: 'reconnecting',
  })
})

test('presents a recovered local control plane with its durable storage', () => {
  const controlPlane: ServiceBundle['controlPlane'] = {
    connected: true,
    mode: 'local',
    models: [],
    storage: 'sqlite',
    capabilities: ['projects'],
  }
  assert.deepEqual(connectionPresentation({
    connection: localConnection,
    controlPlane,
    desktop: false,
  }), {
    label: 'Local',
    title: 'Local control plane · native harnesses · sqlite',
    connected: true,
    kind: 'connected',
  })
})

test('presents demo mode truthfully before services initialize', () => {
  assert.deepEqual(connectionPresentation({
    connection: {
      id: 'demo',
      name: 'Demo workspace',
      mode: 'demo',
      baseUrl: 'http://127.0.0.1:8765',
      allowMockFallback: true,
    },
    controlPlane: null,
    desktop: false,
  }), {
    label: 'Demo',
    title: 'Seeded sample workspace · simulated runs · browser-only state',
    connected: false,
    kind: 'demo',
  })
})
