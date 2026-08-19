import assert from 'node:assert/strict'
import test from 'node:test'
import { connectionProfileForRuntime } from '../src/services/index.ts'

test('mock runtime starts in an explicit demo workspace', () => {
  assert.deepEqual(connectionProfileForRuntime({ runtimeMode: 'mock' }), {
    id: 'demo',
    name: 'Demo workspace',
    mode: 'demo',
    baseUrl: 'http://127.0.0.1:8765',
    allowMockFallback: true,
  })
})

test('an explicitly configured server remains authoritative in mock builds', () => {
  assert.deepEqual(connectionProfileForRuntime({
    runtimeMode: 'mock',
    configuredUrl: 'https://opensaddle.example',
    allowMockFallback: false,
  }), {
    id: 'configured-server',
    name: 'Configured OpenSaddle server',
    mode: 'remote',
    baseUrl: 'https://opensaddle.example',
    allowMockFallback: false,
  })
})

test('browser runtime defaults to the local control plane', () => {
  assert.deepEqual(connectionProfileForRuntime({ runtimeMode: 'browser' }), {
    id: 'configured-server',
    name: 'Local OpenSaddle server',
    mode: 'remote',
    baseUrl: 'http://127.0.0.1:8765',
    allowMockFallback: false,
  })
})
