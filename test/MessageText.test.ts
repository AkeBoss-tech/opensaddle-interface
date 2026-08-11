import assert from 'node:assert/strict'
import test from 'node:test'
import { getMessageTextSegments } from '../src/ui/messageSegments.ts'

test('appends an entity chip when its label is absent from the message text', () => {
  const segments = getMessageTextSegments('Ship it.', [{ kind: 'agent', id: 'a-1', label: '@Ada' }])

  assert.deepEqual(segments, [
    { type: 'text', value: 'Ship it.' },
    { type: 'reference', reference: { kind: 'agent', id: 'a-1', label: '@Ada' } },
  ])
})

test('substitutes every occurrence of a duplicate label inline', () => {
  const segments = getMessageTextSegments('@Ada reviewed with @Ada.', [{ kind: 'agent', id: 'a-1', label: '@Ada' }])

  assert.equal(segments.filter((segment) => segment.type === 'reference').length, 2)
  assert.deepEqual(segments.filter((segment) => segment.type === 'text').map((segment) => segment.value), [' reviewed with ', '.'])
})

test('matches labels containing regular-expression special characters literally', () => {
  const segments = getMessageTextSegments('Ask @build+(v2)? now.', [{ kind: 'agent', id: 'a-1', label: '@build+(v2)?' }])

  assert.equal(segments[1]?.type, 'reference')
  assert.equal(segments[1]?.type === 'reference' && segments[1].reference.label, '@build+(v2)?')
})
