import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ControlPlaneConfig } from '../src/config.js'
import { StateStore } from '../src/store.js'

function config(dataDir: string): ControlPlaneConfig {
  return {
    mode: 'local',
    host: '127.0.0.1',
    port: 0,
    dataDir,
    workspaceDir: join(dataDir, 'workspaces'),
    corsOrigins: [],
    apiKeys: new Map(),
    bootstrapAdminId: 'user-ad',
    modelRoutes: {},
    defaultModel: 'gpt',
    defaultCodingProvider: 'opensaddle',
    codingProviders: ['opensaddle'],
    harnessProfiles: [],
    runtimeProvider: 'local',
    dockerImage: 'node:22-alpine',
    runtimeTtlMs: 60_000,
    allowedRepoRoots: [dataDir],
    maxConcurrentRuns: 1,
    modelProvider: 'unconfigured',
  }
}

test('persists workspace documents and grants across store instances', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-store-'))
  try {
    const first = new StateStore(config(dataDir))
    await first.init()
    await first.saveWorkspace({
      version: 5,
      projects: [{ id: 'project-1', name: 'Persistent project', routingDefaults: { providerKey: 'codex', modelKey: 'sonnet' } }],
      chats: [{ id: 'chat-1', projectId: 'project-1', updatedAt: 10 }],
      messages: [{ id: 'message-1', chatId: 'chat-1', text: 'Saved in SQLite' }],
      pinnedArtifacts: [{ kind: 'project', id: 'project-1' }],
    }, 'user-ad')
    await first.saveRouteTelemetry({
      id: 'route-1',
      projectId: 'project-1',
      modelKey: 'sonnet',
      providerKey: 'codex',
      harnessKey: 'coding',
      runtimeKey: 'local',
      succeeded: true,
      durationMs: 900,
      createdAt: 100,
    })

    assert.equal(first.storageInfo().engine, 'sqlite')
    assert.equal(first.workspaceInfo()?.documents, 4)

    const second = new StateStore(config(dataDir))
    await second.init()
    const workspace = second.workspace()
    assert.equal((workspace?.chats as Array<{ id: string }>)[0]?.id, 'chat-1')
    assert.equal((workspace?.pinnedArtifacts as Array<{ id: string }>)[0]?.id, 'project-1')
    assert.equal(second.routeTelemetry('project-1')[0]?.durationMs, 900)
    assert.equal(second.grants().some((grant) => grant.id === 'bootstrap-admin'), true)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
