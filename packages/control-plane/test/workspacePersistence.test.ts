import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureWorkspaceRecovery,
  listWorkspaceRecoveries,
  loadWorkspace,
  readWorkspaceRecovery,
} from '../../../src/data/workspacePersistence.ts'
import { DATA_VERSION, STORAGE_KEY, createSeedData } from '../../../src/data/seed.ts'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value))
  }
}

test('migrates an older workspace while preserving the original snapshot', () => {
  const storage = new MemoryStorage()
  const legacy = createSeedData() as unknown as Record<string, unknown>
  legacy.version = DATA_VERSION - 1
  legacy.workspaceName = 'Preserve me'
  delete legacy.pinnedArtifacts
  storage.setItem(`opensaddle-data-v${DATA_VERSION - 1}`, JSON.stringify(legacy))

  const loaded = loadWorkspace(storage)

  assert.equal(loaded.data.version, DATA_VERSION)
  assert.equal(loaded.data.workspaceName, 'Preserve me')
  assert.deepEqual(loaded.data.pinnedArtifacts, [])
  assert.match(loaded.notice ?? '', /migrated/i)
  assert.equal(loaded.recoveries.length, 1)
  assert.equal(readWorkspaceRecovery(loaded.recoveries[0], storage).workspaceName, 'Preserve me')
})

test('preserves unreadable current data instead of silently overwriting it', () => {
  const storage = new MemoryStorage()
  storage.setItem(STORAGE_KEY, '{not-json')

  const loaded = loadWorkspace(storage)

  assert.equal(loaded.data.version, DATA_VERSION)
  assert.match(loaded.notice ?? '', /preserved/i)
  assert.equal(loaded.recoveries.length, 1)
  assert.equal(storage.getItem(loaded.recoveries[0].storageKey), '{not-json')
})

test('keeps only the five newest distinct recovery snapshots', () => {
  const storage = new MemoryStorage()
  for (let index = 0; index < 7; index += 1) {
    captureWorkspaceRecovery(storage, STORAGE_KEY, JSON.stringify({ version: DATA_VERSION, index }), `snapshot ${index}`)
  }

  const recoveries = listWorkspaceRecoveries(storage)
  assert.equal(recoveries.length, 5)
  assert.equal(recoveries.some((item) => item.reason === 'snapshot 0'), false)
  assert.equal(recoveries.some((item) => item.reason === 'snapshot 6'), true)
})
