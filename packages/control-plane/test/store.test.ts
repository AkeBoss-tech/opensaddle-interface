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
    assert.equal(second.projectStates()[0]?.id, 'project-1')
    assert.equal(second.artifactStates('project-1').some((artifact) => artifact.id === 'sources:source-1'), false)

    await second.saveWorkspace({
      version: 5,
      projects: [{ id: 'project-1', name: 'Persistent project' }],
      chats: [],
      messages: [],
      sources: [{ id: 'source-1', projectId: 'project-1', name: 'Authoritative source' }],
    }, 'user-ad')
    await second.saveWorker({
      id: 'browser-worker-1',
      ownerId: 'user-ad',
      kind: 'browser-sandbox',
      status: 'available',
      capabilities: ['javascript'],
      registeredAt: 100,
      lastSeenAt: 200,
    })
    await second.appendAudit({
      id: 'audit-1',
      timestamp: 300,
      actorId: 'user-ad',
      type: 'workspace.saved',
      targetType: 'workspace',
      targetId: 'org-default',
    })

    assert.equal(second.artifactStates('project-1')[0]?.id, 'sources:source-1')
    assert.equal(second.workers()[0]?.id, 'browser-worker-1')
    assert.equal(second.auditEvents()[0]?.type, 'workspace.saved')
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
