import assert from 'node:assert/strict'
import test from 'node:test'
import { connectedResourcesHref } from './commandCenterRoutes'

test('connected-resource navigation binds the exact active Run and Project', () => {
  assert.equal(
    connectedResourcesHref('run/granted', 'project connected'),
    '/review?run=run%2Fgranted&project=project+connected',
  )
})
