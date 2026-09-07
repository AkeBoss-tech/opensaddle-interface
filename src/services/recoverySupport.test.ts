import assert from 'node:assert/strict'
import test from 'node:test'
import { negotiateRunRecovery } from './recoverySupport'

test('v2 capability success does not enable the incompatible legacy recovery poller', () => {
  assert.deepEqual(negotiateRunRecovery(false, true), {
    available: false,
    reason: 'Conversation task recovery is not advertised by this v2 control plane.',
  })
})

test('legacy health support preserves conversation recovery', () => {
  assert.deepEqual(negotiateRunRecovery(true, false), { available: true })
})
