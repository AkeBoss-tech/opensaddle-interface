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

test('consumes a one-time grant without deleting its audit record', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-grant-'))
  try {
    const first = new StateStore(config(dataDir))
    await first.init()
    await first.replaceGrant({
      id: 'grant-once',
      principalKind: 'user',
      principalId: 'user-ad',
      resourceKind: 'tool',
      resourceId: 'email',
      action: 'write',
      effect: 'allow',
      scope: 'once',
      scopeId: 'thread-1',
      usesRemaining: 1,
      createdAt: 1,
      createdBy: 'user-ad',
    })
    const consumed = await first.consumeGrant('grant-once')
    assert.equal(consumed?.usesRemaining, 0)
    assert.equal(typeof consumed?.consumedAt, 'number')
    assert.equal(first.grants().find((grant) => grant.id === 'grant-once')?.usesRemaining, 0)
    assert.equal(await first.consumeGrant('grant-once'), undefined)

    const second = new StateStore(config(dataDir))
    await second.init()
    assert.equal(second.grants().find((grant) => grant.id === 'grant-once')?.usesRemaining, 0)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('migrates legacy conversations and persists granular thread operations', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-threads-'))
  try {
    const first = new StateStore(config(dataDir))
    await first.init()
    await first.saveWorkspace({
      version: 1,
      currentUserId: 'user-ad',
      projects: [{ id: 'project-1' }],
      chats: [{
        id: 'chat-legacy',
        projectId: 'project-1',
        title: 'Legacy durable thread',
        visibility: 'project',
        sharedWith: ['user-reviewer'],
        continuation: {
          provider: 'claude',
          sessionId: 'claude-session',
          sourcePath: '/sessions/claude-session.jsonl',
          authority: 'hybrid',
        },
        runConfig: {
          auto: false,
          providerKey: 'claude',
          modelKey: 'opus',
          harnessKey: 'coding',
          runtimeKey: 'local',
          executionMode: 'review',
          tools: ['Files'],
        },
        createdAt: 10,
        updatedAt: 20,
      }],
      messages: [{
        id: 'message-legacy',
        chatId: 'chat-legacy',
        role: 'user',
        text: 'Find this durable message',
        createdAt: 15,
      }],
    }, 'user-ad')

    const migrated = first.thread('chat-legacy')
    assert.equal(migrated?.title, 'Legacy durable thread')
    assert.equal(migrated?.continuation?.sessionId, 'claude-session')
    assert.equal(migrated?.runConfig?.modelKey, 'opus')
    assert.equal(first.messages('chat-legacy')[0]?.text, 'Find this durable message')

    const durable = {
      id: 'thread-new',
      ownerId: 'user-ad',
      projectId: 'project-1',
      title: 'New thread',
      visibility: 'private' as const,
      sharedWith: [],
      continuation: {
        provider: 'codex' as const,
        sessionId: 'codex-session',
        sourcePath: '/sessions/codex-session.jsonl',
        authority: 'opensaddle_managed' as const,
        mode: 'fork' as const,
        checkpointId: 'turn-before-branch',
      },
      runConfig: {
        auto: false,
        providerKey: 'claude',
        modelKey: 'opus',
        harnessKey: 'coding',
        runtimeKey: 'local',
        executionMode: 'review' as const,
        tools: ['Files', 'Coding agent'],
      },
      pinned: true,
      createdAt: 30,
      updatedAt: 30,
    }
    await first.saveThread(durable)
    await first.saveThread({
      ...durable,
      id: 'thread-newer-unpinned',
      title: 'Newer but unpinned',
      pinned: false,
      createdAt: 40,
      updatedAt: 40,
    })
    await first.appendMessage({
      id: 'message-new',
      threadId: durable.id,
      role: 'assistant',
      text: 'Searchable implementation output',
      createdAt: 31,
      updatedAt: 31,
      payload: { runId: 'run-1' },
    })
    await first.saveMessage({
      id: 'message-new',
      threadId: durable.id,
      role: 'assistant',
      text: 'Searchable implementation output with streamed completion',
      createdAt: 31,
      updatedAt: 32,
      payload: { runId: 'run-1', done: true },
    })
    assert.equal(first.message('message-new')?.payload?.done, true)
    assert.equal(first.threads({ projectId: 'project-1' })[0]?.id, 'thread-new')
    assert.equal(first.thread('thread-new')?.runConfig?.modelKey, 'opus')
    assert.deepEqual(first.thread('thread-new')?.runConfig?.tools, ['Files', 'Coding agent'])
    const firstPage = first.threads({ projectId: 'project-1', limit: 1 })
    const secondPage = first.threads({
      projectId: 'project-1',
      limit: 1,
      cursor: {
        pinned: firstPage[0]!.pinned,
        updatedAt: firstPage[0]!.updatedAt,
        id: firstPage[0]!.id,
      },
    })
    assert.equal(secondPage[0]?.id, 'thread-newer-unpinned')
    assert.equal(first.searchThreads('implementation')[0]?.messageId, 'message-new')

    const second = new StateStore(config(dataDir))
    await second.init()
    assert.equal(second.thread('thread-new')?.pinned, true)
    assert.equal(second.thread('thread-new')?.continuation?.sessionId, 'codex-session')
    assert.equal(second.thread('thread-new')?.continuation?.mode, 'fork')
    assert.equal(second.thread('thread-new')?.continuation?.checkpointId, 'turn-before-branch')
    assert.equal(second.thread('thread-new')?.runConfig?.executionMode, 'review')
    assert.equal(second.messages('thread-new')[0]?.payload?.runId, 'run-1')
    assert.equal(await second.removeThread('thread-new'), true)
    assert.equal(second.messages('thread-new').length, 0)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
