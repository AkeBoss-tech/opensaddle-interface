import assert from 'node:assert/strict'
import test from 'node:test'
import { creationAction, isProjectDetailsValid } from '../src/features/onboarding/addProjectFlow.ts'

test('cloud projects create directly and skip the scan step', () => {
  assert.equal(creationAction('cloud', ''), 'create')
  assert.equal(isProjectDetailsValid('cloud', 'Research plan', ''), true)
})

test('local projects require a folder before advancing to the scan step', () => {
  assert.equal(creationAction('local', ''), null)
  assert.equal(isProjectDetailsValid('local', 'Checkout', ''), false)
  assert.equal(creationAction('local', '/work/checkout'), 'scan')
})

test('cancelling at any step yields no entity creation action', () => {
  assert.equal(creationAction('cloud', '', true), null)
  assert.equal(creationAction('local', '/work/checkout', true), null)
})
