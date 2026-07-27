import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { promisify } from 'node:util'
import type { ControlPlaneConfig } from '../src/config.js'
import { RuntimeProvisioner } from '../src/provisioner.js'
import { StateStore } from '../src/store.js'

const exec = promisify(execFile)

it('runs a local project directly even when the folder is not a Git repository', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-local-folder-'))
  const projectDir = await mkdtemp(join(tmpdir(), 'opensaddle-project-folder-'))
  const config: ControlPlaneConfig = {
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
    defaultCodingProvider: 'codex',
    codingProviders: ['codex'],
    harnessProfiles: [],
    runtimeProvider: 'local',
    dockerImage: 'node:22-alpine',
    runtimeTtlMs: 60_000,
    allowedRepoRoots: [projectDir],
    maxConcurrentRuns: 2,
    modelProvider: 'unconfigured',
  }
  const store = new StateStore(config)
  await store.init()
  const provisioner = new RuntimeProvisioner(config, store)
  const principal = { userId: 'user-ad', roles: ['admin'], authType: 'local' as const }

  try {
    const runtime = await provisioner.provision({
      projectId: 'project-local',
      kind: 'local',
      repo: projectDir,
      principal,
    })
    assert.equal(runtime.status, 'running')
    assert.equal(runtime.workspacePath, projectDir)

    await provisioner.release(runtime.id, principal)
    await access(projectDir)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
    await rm(projectDir, { recursive: true, force: true })
  }
})

it('prepares review changes in an isolated copy of the current project state', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-review-data-'))
  const projectDir = await mkdtemp(join(tmpdir(), 'opensaddle-review-project-'))
  const config: ControlPlaneConfig = {
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
    defaultCodingProvider: 'codex',
    codingProviders: ['codex'],
    harnessProfiles: [],
    runtimeProvider: 'local',
    dockerImage: 'node:22-alpine',
    runtimeTtlMs: 60_000,
    allowedRepoRoots: [projectDir],
    maxConcurrentRuns: 2,
    modelProvider: 'unconfigured',
  }
  const store = new StateStore(config)
  await store.init()
  const provisioner = new RuntimeProvisioner(config, store)
  const principal = { userId: 'user-ad', roles: ['admin'], authType: 'local' as const }

  try {
    await exec('git', ['init', '-q'], { cwd: projectDir })
    await exec('git', ['config', 'user.name', 'OpenSaddle Test'], { cwd: projectDir })
    await exec('git', ['config', 'user.email', 'test@opensaddle.local'], { cwd: projectDir })
    await writeFile(join(projectDir, 'tracked.txt'), 'committed\n')
    await exec('git', ['add', '.'], { cwd: projectDir })
    await exec('git', ['commit', '-qm', 'initial'], { cwd: projectDir })
    await writeFile(join(projectDir, 'tracked.txt'), 'current user edit\n')
    await writeFile(join(projectDir, 'draft.txt'), 'untracked context\n')

    const runtime = await provisioner.provision({
      projectId: 'project-review',
      kind: 'local',
      repo: projectDir,
      principal,
      isolateChanges: true,
      reviewTargetPath: projectDir,
    })

    assert.equal(runtime.isolatedChanges, true)
    assert.equal(runtime.sourceWorkspacePath, projectDir)
    assert.notEqual(runtime.workspacePath, projectDir)
    assert.equal(await readFile(join(runtime.workspacePath!, 'tracked.txt'), 'utf8'), 'current user edit\n')
    assert.equal(await readFile(join(runtime.workspacePath!, 'draft.txt'), 'utf8'), 'untracked context\n')

    await writeFile(join(runtime.workspacePath!, 'tracked.txt'), 'agent review edit\n')
    assert.equal(await readFile(join(projectDir, 'tracked.txt'), 'utf8'), 'current user edit\n')
    await provisioner.release(runtime.id, principal)
  } finally {
    await rm(dataDir, { recursive: true, force: true })
    await rm(projectDir, { recursive: true, force: true })
  }
})
