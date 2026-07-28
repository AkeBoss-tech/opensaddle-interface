import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserAgentRuntime } from '../src/services/browserAgentRuntime.ts'
import { MemoryFileStore } from '../src/services/fileStore.ts'
import type {
  LocalProjectClient,
  PermissionClient,
  SandboxClient,
} from '../src/services/contracts.ts'

function allowingPermissions(): PermissionClient {
  return {
    async list() { return [] },
    async upsert(grant) { return { ...grant, id: grant.id ?? 'grant', createdAt: Date.now() } },
    async consume() { throw new Error('not used') },
    async revoke() {},
    async check() {
      return { allowed: true, reason: 'test', matchedGrantIds: [], approvalRequired: false }
    },
  }
}

const sandbox: SandboxClient = {
  async run() {
    return { ok: true, stdout: '', stderr: '', durationMs: 0 }
  },
}

test('uses the authoritative folder for registered local project files', async () => {
  const browserFiles = new MemoryFileStore()
  const reads: string[] = []
  const writes: Array<{ projectId: string; path: string; content: string }> = []
  const localProjects = {
    async listProjects() {
      return [{ projectId: 'local-project', root: '/work/project', createdAt: 1 }]
    },
    async readFile(projectId: string, path: string) {
      reads.push(`${projectId}:${path}`)
      return {
        root: '/work/project',
        path,
        content: '# Real repository',
        bytes: 17,
        truncated: false,
      }
    },
    async writeManagedArtifact(projectId: string, input: { path: string; content: string }) {
      writes.push({ projectId, ...input })
      return {
        root: '/work/project',
        path: input.path,
        bytes: input.content.length,
        modifiedAt: 1,
      }
    },
  } as LocalProjectClient
  const runtime = new BrowserAgentRuntime(
    browserFiles,
    sandbox,
    allowingPermissions(),
    [],
    localProjects,
  )

  const read = await runtime.call({
    tool: 'filesystem.read',
    args: { path: 'README.md' },
    projectId: 'local-project',
    userId: 'local-admin',
  })
  assert.equal(read.ok, true)
  assert.deepEqual(read.data, {
    path: 'README.md',
    content: '# Real repository',
    storage: 'local-project',
    truncated: false,
  })
  assert.deepEqual(reads, ['local-project:README.md'])
  assert.equal(read.events.some((event) => event.type === 'tool.output' && event.payload.storage === 'local-project'), true)

  const write = await runtime.call({
    tool: 'filesystem.write',
    args: { path: 'runtime/hello.txt', content: 'hello' },
    projectId: 'local-project',
    userId: 'local-admin',
  })
  assert.equal(write.ok, true)
  assert.deepEqual(write.data, {
    path: 'runtime/hello.txt',
    bytes: 5,
    storage: 'local-project',
  })
  assert.deepEqual(writes, [{
    projectId: 'local-project',
    path: 'runtime/hello.txt',
    content: 'hello',
  }])
  assert.equal(await browserFiles.stat('projects/local-project/runtime/hello.txt'), null)
})

test('keeps non-local project files isolated in browser storage', async () => {
  const browserFiles = new MemoryFileStore()
  const localProjects = {
    async listProjects() {
      return [{ projectId: 'other-project', root: '/work/other', createdAt: 1 }]
    },
  } as LocalProjectClient
  const runtime = new BrowserAgentRuntime(
    browserFiles,
    sandbox,
    allowingPermissions(),
    [],
    localProjects,
  )

  const write = await runtime.call({
    tool: 'filesystem.write',
    args: { path: 'notes.txt', content: 'browser only' },
    projectId: 'company-project',
    userId: 'user-1',
  })
  assert.deepEqual(write.data, {
    path: 'notes.txt',
    bytes: 12,
    storage: 'browser-workspace',
  })
  assert.equal(
    await browserFiles.read('projects/company-project/notes.txt'),
    'browser only',
  )
})
