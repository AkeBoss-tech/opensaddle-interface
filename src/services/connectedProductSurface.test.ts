import assert from 'node:assert/strict'
import test from 'node:test'
import type { ServiceBundle } from '.'
import { usesConnectedProductSurface } from '.'

// LOCAL-PROJECT-EMPTY-START-1: removing the offline scaffold cannot displace the v2 connected product.
test('v2-only remote service remains on the connected product surface', () => {
  const services = { controlPlane: { connected: true, v2Capabilities: true } } as ServiceBundle
  assert.equal(usesConnectedProductSurface(services), true)
  assert.equal(usesConnectedProductSurface({ controlPlane: { connected: false, v2Capabilities: true } } as ServiceBundle), false)
})
