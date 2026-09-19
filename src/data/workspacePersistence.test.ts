import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, migrateWorkspace } from './workspacePersistence'
import { createEmptyWorkspace } from './emptyWorkspace'
import { createSeedData, STORAGE_KEY } from './seed'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

// LOCAL-PROJECT-EMPTY-START-1: a fresh install cannot present invented product records.
test('fresh workspace is structurally complete and contains no sample entities', () => {
  const loaded = loadWorkspace(new MemoryStorage())
  assert.deepEqual(loaded.data, createEmptyWorkspace())
  for (const key of ['members', 'projects', 'chats', 'messages', 'agents', 'services', 'tasks'] as const) {
    assert.deepEqual(loaded.data[key], [])
  }
  assert.equal(loaded.data.activeProjectId, '')
})

// LOCAL-PROJECT-EMPTY-START-1: malformed missing arrays migrate to emptiness, not seeded records.
test('migration preserves authored records and does not seed missing collections', () => {
  const authored = { ...createEmptyWorkspace(), projects: [{ id: 'real-project', name: 'Real project', parentId: null, description: '', iconColor: '#000', knowledgeCount: 0, serviceCount: 0, childCount: 0, autoConfidence: 0, lineage: ['Real project'] }], members: undefined }
  const migrated = migrateWorkspace(authored)
  assert.equal(migrated.projects[0]?.id, 'real-project')
  assert.deepEqual(migrated.members, [])
})

// LOCAL-PROJECT-EMPTY-START-1: legacy sample UI is quarantined without deleting authored bytes.
test('legacy mixed workspace becomes empty while its exact authored bytes remain recoverable', () => {
  const storage = new MemoryStorage()
  const legacy = createSeedData()
  legacy.messages.push({ id: 'authored', chatId: legacy.chats[0].id, role: 'user', createdAt: 123, text: 'USER-AUTHORED-BYTES' })
  const raw = JSON.stringify(legacy)
  storage.setItem(STORAGE_KEY, raw)
  const loaded = loadWorkspace(storage)
  assert.deepEqual(loaded.data.projects, [])
  assert.deepEqual(loaded.data.members, [])
  assert.match(loaded.notice ?? '', /preserved in recovery/)
  assert.equal(loaded.recoveries.length, 1)
  assert.equal(storage.getItem(loaded.recoveries[0].storageKey), raw)
  assert.match(storage.getItem(loaded.recoveries[0].storageKey) ?? '', /USER-AUTHORED-BYTES/)
})
