import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateApplicationState, validateApplicationState, validateApplicationStateMigration, validateApplicationStateSchema } from './applicationState'

const v1 = { type: 'object', additionalProperties: false, maxProperties: 2, properties: { query: { type: 'string', maxLength: 20 }, pinned: { type: 'boolean' } }, required: ['query'] } as const
const v2 = { type: 'object', additionalProperties: false, maxProperties: 3, properties: { search: { type: 'string', maxLength: 20 }, pinned: { type: 'boolean' }, layout: { type: 'string', maxLength: 12 } }, required: ['search', 'layout'] } as const

test('signed declarative migration transforms changed state schema and validates destination', () => {
  const migration = { from_version: 1, to_version: 2, operations: [{ op: 'rename' as const, from: 'query', to: 'search' }, { op: 'set_default' as const, path: 'layout', value: 'compact' }] }
  assert.deepEqual(migrateApplicationState({ query: 'evidence', pinned: true }, v1, v2, migration), { search: 'evidence', pinned: true, layout: 'compact' })
})

test('migration rejects untrusted keys, invalid output, and undeclared operations', () => {
  assert.equal(validateApplicationState({ query: 'ok', token: 'secret' }, v1), undefined)
  assert.equal(migrateApplicationState({ query: 'evidence' }, v1, v2, { from_version: 1, to_version: 2, operations: [{ op: 'rename', from: 'query', to: 'missing' }] }), undefined)
  assert.equal(migrateApplicationState({ query: 'evidence' }, v1, v2, { from_version: 1, to_version: 2, operations: [{ op: 'eval', code: 'state' } as never] }), undefined)
})

test('schema and migrations reject inherited names and malformed signed fields', () => {
  assert.equal(validateApplicationState({}, { type: 'object', additionalProperties: false, maxProperties: 0, properties: {}, required: ['toString'] }), undefined)
  const inherited = Object.create({ query: 'inherited' })
  assert.equal(validateApplicationState(inherited, v1), undefined)
  assert.equal(migrateApplicationState({ query: 'ok' }, v1, v2, { from_version: 1, to_version: 2, operations: null }), undefined)
  assert.equal(migrateApplicationState({ query: 'ok' }, v1, v2, { from_version: 1, to_version: 2, operations: [{ op: 'drop', path: 'query', extra: true }] }), undefined)
})

test('optional schema and operation fields reject null or missing keys', () => {
  assert.equal(validateApplicationState({}, { ...v1, required: null }), undefined)
  assert.equal(migrateApplicationState({ query: 'ok' }, v1, v2, { from_version: 1, to_version: 2, operations: [{ op: 'drop' }] }), undefined)
  assert.equal(migrateApplicationState({ query: 'ok' }, v1, v2, { from_version: 1, to_version: 2, operations: [{ op: 'rename', to: 'note' }] }), undefined)
})

test('string limits count Unicode code points and numeric properties require explicit bounds', () => {
  const emojiSchema = { type: 'object', additionalProperties: false, maxProperties: 1, properties: { title: { type: 'string', maxLength: 2 } } }
  assert.deepEqual(validateApplicationState({ title: '😀😀' }, emojiSchema), { title: '😀😀' })
  assert.equal(validateApplicationState({ title: '😀😀😀' }, emojiSchema), undefined)
  assert.equal(validateApplicationStateSchema({ type: 'object', additionalProperties: false, maxProperties: 1, properties: { score: { type: 'number' } } }), undefined)
  assert.ok(validateApplicationStateSchema({ type: 'object', additionalProperties: false, maxProperties: 1, properties: { score: { type: 'number', minimum: 0, maximum: 10 } } }))
})

test('reserved names and conflicting or invalid migration destinations fail closed', () => {
  assert.equal(validateApplicationStateSchema({ type: 'object', additionalProperties: false, maxProperties: 1, properties: { constructor: { type: 'boolean' } } }), undefined)
  assert.equal(validateApplicationStateMigration({ from_version: 1, to_version: 2, operations: [{ op: 'set_default', path: 'missing', value: true }] }, v2, 2), undefined)
  assert.equal(validateApplicationStateMigration({ from_version: 1, to_version: 2, operations: [{ op: 'rename', from: 'query', to: 'search' }, { op: 'set_default', path: 'search', value: 'x' }] }, v2, 2), undefined)
  assert.equal(validateApplicationStateMigration({ from_version: 1, to_version: 2, operations: [{ op: 'set_default', path: 'layout', value: 2 }] }, v2, 2), undefined)
})
