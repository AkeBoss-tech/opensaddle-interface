import assert from 'node:assert/strict'
import test from 'node:test'
import { connectionProfileForRuntime } from '../src/services/index.ts'

// CONNECTION-DEFAULT-1: mock transport does not imply consent to demo data.
test('mock runtime requires explicit fixture opt-in', () => {
  const normal=connectionProfileForRuntime({runtimeMode:'mock'})
  assert.equal(normal.mode,'remote')
  assert.equal(normal.allowMockFallback,false)
  const fixture=connectionProfileForRuntime({runtimeMode:'mock',allowMockFallback:true})
  assert.equal(fixture.mode,'demo')
  assert.equal(fixture.allowMockFallback,true)
  assert.equal(fixture.name,'Development fixture')
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
