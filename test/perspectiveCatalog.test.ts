import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILTIN_PERSPECTIVES,
  COMPILED_BUILTIN_PERSPECTIVES,
  compilePerspectiveCatalog,
} from '../src/perspectives/catalog.ts'

test('compiled catalog enables only perspectives with every required capability', () => {
  assert.deepEqual(BUILTIN_PERSPECTIVES.map(({ id, version }) => ({ id, version })), [
    { id: 'opensaddle.developer', version: '1.0.0' },
    { id: 'opensaddle.designer', version: '1.0.0' },
    { id: 'opensaddle.research-manager', version: '1.0.0' },
  ])

  assert.equal(COMPILED_BUILTIN_PERSPECTIVES[0]?.availability.status, 'enabled')
  assert.deepEqual(COMPILED_BUILTIN_PERSPECTIVES[1]?.availability, {
    status: 'capability-unavailable',
    missingCapabilities: ['projection.design-canvas.v1'],
  })
  assert.deepEqual(COMPILED_BUILTIN_PERSPECTIVES[2]?.availability, {
    status: 'capability-unavailable',
    missingCapabilities: ['projection.research-brief.v1'],
  })
})

test('compiled catalog rejects duplicate perspective ids', () => {
  assert.throws(
    () => compilePerspectiveCatalog(
      [BUILTIN_PERSPECTIVES[0], BUILTIN_PERSPECTIVES[0]],
      new Set(['projection.trace-evidence.v1', 'projection.kanban.v1']),
    ),
    /Duplicate perspective id/,
  )
})
