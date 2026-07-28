import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import type { ControlPlaneConfig } from '../src/config.js'
import type { HarnessRunInput } from '../src/harness/types.js'
import { RunManager } from '../src/runManager.js'
import { RuntimeProvisioner } from '../src/provisioner.js'
import { StateStore } from '../src/store.js'
import type { AuthPrincipal, RouteEstimate } from '../src/types.js'

const principal: AuthPrincipal = { userId: 'user-ad', roles: ['admin'], authType: 'local' }
const exec = promisify(execFile)

async function eventually(check: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(message)
}

describe('durable run lifecycle', () => {
  it('prepares review changes outside the project and promotes only accepted hunks', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-run-review-'))
    const projectDir = join(dataDir, 'project')
    await mkdir(projectDir)
    const config: ControlPlaneConfig = {
      mode: 'local',
      host: '127.0.0.1',
      port: 0,
      dataDir,
      workspaceDir: join(dataDir, 'workspaces'),
      corsOrigins: [],
      apiKeys: new Map(),
      bootstrapAdminId: principal.userId,
      modelRoutes: {},
      defaultModel: 'gpt',
      defaultCodingProvider: 'codex',
      codingProviders: ['codex'],
      harnessProfiles: [],
      runtimeProvider: 'local',
      dockerImage: 'node:22-alpine',
      runtimeTtlMs: 60_000,
      allowedRepoRoots: [dataDir],
      maxConcurrentRuns: 2,
      modelProvider: 'unconfigured',
    }
    const store = new StateStore(config)
    await store.init()
    const provisioner = new RuntimeProvisioner(config, store)
    const original = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)

    try {
      await exec('git', ['init', '-q'], { cwd: projectDir })
      await exec('git', ['config', 'user.name', 'OpenSaddle Test'], { cwd: projectDir })
      await exec('git', ['config', 'user.email', 'test@opensaddle.local'], { cwd: projectDir })
      await writeFile(join(projectDir, 'review.txt'), `${original.join('\n')}\n`)
      await exec('git', ['add', '.'], { cwd: projectDir })
      await exec('git', ['commit', '-qm', 'initial'], { cwd: projectDir })
      const currentSource = [...original]
      currentSource[19] = 'current user edit'
      await writeFile(join(projectDir, 'review.txt'), `${currentSource.join('\n')}\n`)
      await writeFile(join(projectDir, 'draft.txt'), 'untracked user context\n')

      let reviewWorkspace = ''
      const harnesses = {
        async run(input: HarnessRunInput) {
          reviewWorkspace = input.workspacePath
          assert.notEqual(reviewWorkspace, projectDir)
          assert.equal(await readFile(join(reviewWorkspace, 'draft.txt'), 'utf8'), 'untracked user context\n')
          const prepared = (await readFile(join(reviewWorkspace, 'review.txt'), 'utf8')).trimEnd().split('\n')
          assert.equal(prepared[19], 'current user edit')
          prepared[1] = 'agent changed line 2'
          prepared[34] = 'agent changed line 35'
          await writeFile(join(reviewWorkspace, 'review.txt'), `${prepared.join('\n')}\n`)
          return { summary: 'Prepared two review hunks', providerId: 'codex' }
        },
      }
      const manager = new RunManager(config, store, {} as never, provisioner, harnesses as never)
      const route: RouteEstimate = {
        modelKey: 'gpt',
        modelId: 'gpt-5.4',
        harnessKey: 'coding',
        providerKey: 'codex',
        runtimeKey: 'local',
        reasons: ['test'],
        cost: '$0',
        alternatives: [],
      }
      const run = await manager.start({
        projectId: 'project-review',
        task: 'Prepare two changes for review',
        route,
        repo: projectDir,
        principal,
        executionMode: 'review',
        executionPolicy: {
          sandbox: 'workspace-write',
          approvals: 'on-request',
          network: false,
          allowedTools: [],
          deniedTools: [],
        },
      })
      await eventually(() => store.run(run.id)?.status === 'completed', 'review run did not complete')

      const sourceBeforeAcceptance = await readFile(join(projectDir, 'review.txt'), 'utf8')
      assert.doesNotMatch(sourceBeforeAcceptance, /^agent changed line 2$/m)
      assert.doesNotMatch(sourceBeforeAcceptance, /^agent changed line 35$/m)
      const diffEvent = [...store.run(run.id)!.events].reverse().find((event) => event.type === 'diff.updated')
      const files = diffEvent?.payload.files as Array<{ path: string; patch: string }> | undefined
      assert.equal(files?.[0]?.patch.split('\n').filter((line) => line.startsWith('@@')).length, 2)

      await manager.resolveDiff(run.id, principal, 'review.txt', 0, 'accepted')
      const sourceAfterAcceptance = await readFile(join(projectDir, 'review.txt'), 'utf8')
      assert.match(sourceAfterAcceptance, /^agent changed line 2$/m)
      assert.doesNotMatch(sourceAfterAcceptance, /^agent changed line 35$/m)
      assert.match(sourceAfterAcceptance, /^current user edit$/m)

      await manager.resolveDiff(run.id, principal, 'review.txt', 1, 'rejected')
      const isolatedAfterRejection = await readFile(join(reviewWorkspace, 'review.txt'), 'utf8')
      assert.match(isolatedAfterRejection, /^agent changed line 2$/m)
      assert.doesNotMatch(isolatedAfterRejection, /^agent changed line 35$/m)
      assert.ok(store.run(run.id)?.events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.tool === 'diff.hunk.accepted'
        && event.payload.promoted === true,
      ))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('pauses, resumes from the same workspace, and retries as a linked run', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-run-lifecycle-'))
    const config: ControlPlaneConfig = {
      mode: 'local',
      host: '127.0.0.1',
      port: 0,
      dataDir,
      workspaceDir: join(dataDir, 'workspaces'),
      corsOrigins: [],
      apiKeys: new Map(),
      bootstrapAdminId: principal.userId,
      modelRoutes: {},
      defaultModel: 'gpt',
      defaultCodingProvider: 'codex',
      codingProviders: ['codex'],
      harnessProfiles: [],
      runtimeProvider: 'local',
      dockerImage: 'node:22-alpine',
      runtimeTtlMs: 60_000,
      allowedRepoRoots: [dataDir],
      maxConcurrentRuns: 2,
      modelProvider: 'unconfigured',
    }
    const store = new StateStore(config)
    await store.init()
    const provisioner = new RuntimeProvisioner(config, store)
    let invocation = 0
    const providerSessions: Array<string | undefined> = []
    const steering: Array<{ providerId: string; runId: string; text: string }> = []
    const harnesses = {
      async run(input: HarnessRunInput) {
        invocation += 1
        providerSessions.push(input.providerSessionId)
        await input.emit('agent.started', { provider: 'codex', invocation })
        if (invocation === 1) {
          await input.emit('tool.completed', {
            tool: 'codex.thread.start',
            thread_id: 'thread-native-123',
            persistent: true,
          })
          await new Promise<void>((resolve) => {
            if (input.signal.aborted) resolve()
            else input.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          return { summary: '', providerId: 'codex' }
        }
        await input.emit('agent.output.delta', { text: invocation === 2 ? 'resumed' : 'retried' })
        return { summary: '', providerId: 'codex' }
      },
      async steer(providerId: string, runId: string, text: string) {
        steering.push({ providerId, runId, text })
        return true
      },
    }
    const manager = new RunManager(
      config,
      store,
      {} as never,
      provisioner,
      harnesses as never,
    )
    const route: RouteEstimate = {
      modelKey: 'gpt',
      modelId: 'gpt-5.4',
      harnessKey: 'coding',
      providerKey: 'codex',
      runtimeKey: 'local',
      reasons: ['test'],
      cost: '$0',
      alternatives: [],
    }

    try {
      const run = await manager.start({
        projectId: 'project-1',
        task: 'Implement the feature',
        route,
        principal,
        executionMode: 'plan',
        executionPolicy: {
          sandbox: 'read-only',
          approvals: 'always',
          network: false,
          allowedTools: [],
          deniedTools: ['delete_file'],
        },
      })
      await eventually(() => store.run(run.id)?.status === 'running' && !!store.run(run.id)?.runtimeId, 'run did not start')
      const runtimeId = store.run(run.id)?.runtimeId
      assert.equal(await manager.steer(run.id, principal, 'Focus on the smallest safe patch'), true)
      assert.deepEqual(steering, [{
        providerId: 'codex',
        runId: run.id,
        text: 'Focus on the smallest safe patch',
      }])
      assert.ok(store.run(run.id)?.events.some((event) =>
        event.type === 'user.input.submitted'
        && event.payload.kind === 'steer'
        && event.payload.text === 'Focus on the smallest safe patch',
      ))

      assert.equal(await manager.pause(run.id, principal), true)
      assert.equal(store.run(run.id)?.status, 'paused')
      assert.ok(store.run(run.id)?.events.some((event) => event.type === 'agent.paused'))

      await manager.resume(run.id, principal)
      await eventually(() => store.run(run.id)?.status === 'completed', 'resumed run did not complete')
      const resumed = store.run(run.id)!
      assert.equal(resumed.runtimeId, runtimeId)
      assert.equal(providerSessions[1], 'thread-native-123')
      assert.ok(resumed.events.some((event) => event.type === 'agent.resumed'))
      assert.ok(resumed.events.some((event) => event.type === 'agent.output.delta' && event.payload.text === 'resumed'))

      const retry = await manager.retry(run.id, principal)
      assert.ok(retry)
      assert.equal(retry?.parentRunId, run.id)
      await eventually(() => store.run(retry!.id)?.status === 'completed', 'retried run did not complete')
      assert.equal(store.run(retry!.id)?.executionMode, 'plan')
      assert.equal(store.run(retry!.id)?.executionPolicy?.sandbox, 'read-only')
      assert.deepEqual(store.run(retry!.id)?.executionPolicy?.deniedTools, ['delete_file'])
      assert.ok(store.run(retry!.id)?.events.some((event) => event.type === 'agent.output.delta' && event.payload.text === 'retried'))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('recovers an active run as a resumable checkpoint after a control-plane restart', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-run-restart-'))
    const projectDir = join(dataDir, 'project')
    await mkdir(projectDir)
    const config: ControlPlaneConfig = {
      mode: 'local',
      host: '127.0.0.1',
      port: 0,
      dataDir,
      workspaceDir: join(dataDir, 'workspaces'),
      corsOrigins: [],
      apiKeys: new Map(),
      bootstrapAdminId: principal.userId,
      modelRoutes: {},
      defaultModel: 'gpt',
      defaultCodingProvider: 'codex',
      codingProviders: ['codex'],
      harnessProfiles: [],
      runtimeProvider: 'local',
      dockerImage: 'node:22-alpine',
      runtimeTtlMs: 60_000,
      allowedRepoRoots: [dataDir],
      maxConcurrentRuns: 2,
      modelProvider: 'unconfigured',
    }
    const store = new StateStore(config)
    await store.init()
    const provisioner = new RuntimeProvisioner(config, store)
    const route: RouteEstimate = {
      modelKey: 'gpt',
      modelId: 'gpt-5.4',
      harnessKey: 'coding',
      providerKey: 'codex',
      runtimeKey: 'local',
      reasons: ['test'],
      cost: '$0',
      alternatives: [],
    }
    const runId = 'run-restart'
    const runtimeId = 'runtime-restart'
    await store.saveRuntime({
      id: runtimeId,
      kind: 'local',
      status: 'running',
      projectId: 'project-1',
      ownerId: principal.userId,
      workspacePath: projectDir,
      createdAt: Date.now(),
      expiresAt: Date.now() - 1,
    })
    await store.saveRun({
      id: runId,
      sessionId: 'session-restart',
      projectId: 'project-1',
      ownerId: principal.userId,
      task: 'Continue after restart',
      route,
      status: 'running',
      runtimeId,
      providerSessionId: 'thread-native-restart',
      providerSessionMode: 'resume',
      createdAt: Date.now() - 1_000,
      updatedAt: Date.now() - 500,
      events: [],
    })

    const workspaces: string[] = []
    const providerSessions: Array<string | undefined> = []
    const harnesses = {
      async run(input: HarnessRunInput) {
        workspaces.push(input.workspacePath)
        providerSessions.push(input.providerSessionId)
        await input.emit('agent.started', { provider: 'codex' })
        await input.emit('agent.output.delta', { text: 'continued after restart' })
        return { summary: '', providerId: 'codex' }
      },
    }
    const manager = new RunManager(config, store, {} as never, provisioner, harnesses as never)

    try {
      assert.equal(await manager.recoverInterruptedRuns(), 1)
      const recovered = store.run(runId)!
      assert.equal(recovered.status, 'paused')
      assert.equal(recovered.error, undefined)
      await provisioner.cleanupExpired()
      assert.equal(store.runtime(runtimeId)?.status, 'running')
      assert.ok(recovered.events.some((event) =>
        event.type === 'agent.paused'
        && event.payload.reason === 'control_plane_restarted'
        && event.payload.resumable === true,
      ))
      assert.equal(recovered.events.some((event) => event.type === 'session.closed'), false)

      await manager.resume(runId, principal)
      await eventually(() => store.run(runId)?.status === 'completed', 'recovered run did not complete')
      assert.deepEqual(workspaces, [projectDir])
      assert.deepEqual(providerSessions, ['thread-native-restart'])
      assert.ok(store.run(runId)?.events.some((event) =>
        event.type === 'agent.output.delta' && event.payload.text === 'continued after restart',
      ))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('persists a pending harness request and resumes after the user responds', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-run-interaction-'))
    const config: ControlPlaneConfig = {
      mode: 'local',
      host: '127.0.0.1',
      port: 0,
      dataDir,
      workspaceDir: join(dataDir, 'workspaces'),
      corsOrigins: [],
      apiKeys: new Map(),
      bootstrapAdminId: principal.userId,
      modelRoutes: {},
      defaultModel: 'gpt',
      defaultCodingProvider: 'codex',
      codingProviders: ['codex'],
      harnessProfiles: [],
      runtimeProvider: 'local',
      dockerImage: 'node:22-alpine',
      runtimeTtlMs: 60_000,
      allowedRepoRoots: [dataDir],
      maxConcurrentRuns: 2,
      modelProvider: 'unconfigured',
    }
    const store = new StateStore(config)
    await store.init()
    const provisioner = new RuntimeProvisioner(config, store)
    let receivedResponse: Awaited<ReturnType<NonNullable<HarnessRunInput['requestInteraction']>>> | undefined
    const harnesses = {
      async run(input: HarnessRunInput) {
        receivedResponse = await input.requestInteraction!({
          id: 'codex:42',
          kind: 'approval',
          method: 'item/commandExecution/requestApproval',
          prompt: 'Allow npm test?',
          detail: 'npm test',
          availableDecisions: ['accept', 'acceptForSession', 'decline'],
        })
        await input.emit('agent.output.delta', { text: receivedResponse.approved ? 'approved' : 'denied' })
        return { summary: '', providerId: 'codex' }
      },
    }
    const manager = new RunManager(config, store, {} as never, provisioner, harnesses as never)
    const route: RouteEstimate = {
      modelKey: 'gpt',
      modelId: 'gpt-5.4',
      harnessKey: 'coding',
      providerKey: 'codex',
      runtimeKey: 'local',
      reasons: ['test'],
      cost: '$0',
      alternatives: [],
    }

    try {
      const run = await manager.start({
        projectId: 'project-1',
        task: 'Run tests after approval',
        route,
        principal,
      })
      await eventually(
        () => store.run(run.id)?.events.some((event) => event.type === 'approval.requested') === true,
        'approval request was not persisted',
      )
      const requested = store.run(run.id)!.events.find((event) => event.type === 'approval.requested')!
      assert.equal(requested.payload.request_id, 'codex:42')
      assert.equal(requested.payload.detail, 'npm test')

      assert.equal(
        await manager.respondInteraction(run.id, 'codex:42', principal, { approved: true, scope: 'session' }),
        true,
      )
      await eventually(() => store.run(run.id)?.status === 'completed', 'run did not continue after approval')
      assert.deepEqual(receivedResponse, { approved: true, scope: 'session' })
      assert.ok(store.run(run.id)?.events.some((event) =>
        event.type === 'approval.resolved'
        && event.payload.allowed === true
        && event.payload.scope === 'session',
      ))
      assert.ok(store.run(run.id)?.events.some((event) =>
        event.type === 'agent.output.delta' && event.payload.text === 'approved',
      ))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('keeps steering guidance in the durable event stream after the active turn completes', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-run-steer-'))
    const config: ControlPlaneConfig = {
      mode: 'local',
      host: '127.0.0.1',
      port: 0,
      dataDir,
      workspaceDir: join(dataDir, 'workspaces'),
      corsOrigins: [],
      apiKeys: new Map(),
      bootstrapAdminId: principal.userId,
      modelRoutes: {},
      defaultModel: 'gpt',
      defaultCodingProvider: 'codex',
      codingProviders: ['codex'],
      harnessProfiles: [],
      runtimeProvider: 'local',
      dockerImage: 'node:22-alpine',
      runtimeTtlMs: 60_000,
      allowedRepoRoots: [dataDir],
      maxConcurrentRuns: 2,
      modelProvider: 'unconfigured',
    }
    const store = new StateStore(config)
    await store.init()
    const provisioner = new RuntimeProvisioner(config, store)
    let releaseTurn: (() => void) | undefined
    const harnesses = {
      async run(input: HarnessRunInput) {
        await input.emit('agent.started', { provider: 'codex' })
        await new Promise<void>((resolve) => {
          releaseTurn = resolve
        })
        await input.emit('agent.output.delta', { text: 'steered result' })
        return { summary: '', providerId: 'codex' }
      },
      async steer() {
        return true
      },
    }
    const manager = new RunManager(config, store, {} as never, provisioner, harnesses as never)
    const route: RouteEstimate = {
      modelKey: 'gpt',
      modelId: 'gpt-5.4',
      harnessKey: 'coding',
      providerKey: 'codex',
      runtimeKey: 'local',
      reasons: ['test'],
      cost: '$0',
      alternatives: [],
    }

    try {
      const run = await manager.start({
        projectId: 'project-1',
        task: 'Audit the feature',
        route,
        principal,
      })
      await eventually(() => releaseTurn !== undefined, 'run did not enter the active turn')
      assert.equal(await manager.steer(run.id, principal, 'Include the exact script count'), true)
      releaseTurn?.()
      await eventually(() => store.run(run.id)?.status === 'completed', 'steered run did not complete')

      const completed = store.run(run.id)!
      assert.ok(completed.events.some((event) =>
        event.type === 'user.input.submitted'
        && event.payload.kind === 'steer'
        && event.payload.text === 'Include the exact script count',
      ))
      assert.ok(completed.events.some((event) =>
        event.type === 'agent.output.delta' && event.payload.text === 'steered result',
      ))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('promotes a native fork child to the durable session used by later turns', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-run-fork-session-'))
    const config: ControlPlaneConfig = {
      mode: 'local',
      host: '127.0.0.1',
      port: 0,
      dataDir,
      workspaceDir: join(dataDir, 'workspaces'),
      corsOrigins: [],
      apiKeys: new Map(),
      bootstrapAdminId: principal.userId,
      modelRoutes: {},
      defaultModel: 'gpt',
      defaultCodingProvider: 'codex',
      codingProviders: ['codex'],
      harnessProfiles: [],
      runtimeProvider: 'local',
      dockerImage: 'node:22-alpine',
      runtimeTtlMs: 60_000,
      allowedRepoRoots: [dataDir],
      maxConcurrentRuns: 1,
      modelProvider: 'unconfigured',
    }
    const store = new StateStore(config)
    await store.init()
    const provisioner = new RuntimeProvisioner(config, store)
    const harnesses = {
      async run(input: HarnessRunInput) {
        assert.equal(input.providerSessionId, 'thread-source')
        assert.equal(input.providerSessionMode, 'fork')
        await input.emit('tool.completed', {
          tool: 'codex.thread.fork',
          source_thread_id: 'thread-source',
          thread_id: 'thread-child',
          persistent: true,
        })
        await input.emit('tool.completed', {
          tool: 'codex.turn.completed',
          thread_id: 'thread-child',
          turn_id: 'turn-child-1',
          persistent: true,
        })
        return { summary: 'forked', providerId: 'codex' }
      },
    }
    const manager = new RunManager(config, store, {} as never, provisioner, harnesses as never)
    const route: RouteEstimate = {
      modelKey: 'gpt',
      modelId: 'gpt-5.4',
      harnessKey: 'coding',
      providerKey: 'codex',
      runtimeKey: 'local',
      reasons: ['test'],
      cost: '$0',
      alternatives: [],
    }

    try {
      const run = await manager.start({
        projectId: 'project-1',
        task: 'Fork this thread',
        route,
        providerSessionId: 'thread-source',
        providerSessionMode: 'fork',
        principal,
      })
      await eventually(() => store.run(run.id)?.status === 'completed', 'forked run did not complete')
      const completed = store.run(run.id)!
      assert.equal(completed.providerSessionId, 'thread-child')
      assert.equal(completed.providerSessionMode, 'resume')
      assert.equal(completed.providerTurnId, 'turn-child-1')
      assert.ok(completed.events.some((event) =>
        event.type === 'agent.completed'
        && event.payload.provider_session_id === 'thread-child'
        && event.payload.provider_session_mode === 'resume'
        && event.payload.provider_turn_id === 'turn-child-1'
      ))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('runs durable queued follow-ups sequentially on the same native session', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'opensaddle-run-queue-'))
    const config: ControlPlaneConfig = {
      mode: 'local',
      host: '127.0.0.1',
      port: 0,
      dataDir,
      workspaceDir: join(dataDir, 'workspaces'),
      corsOrigins: [],
      apiKeys: new Map(),
      bootstrapAdminId: principal.userId,
      modelRoutes: {},
      defaultModel: 'gpt',
      defaultCodingProvider: 'codex',
      codingProviders: ['codex'],
      harnessProfiles: [],
      runtimeProvider: 'local',
      dockerImage: 'node:22-alpine',
      runtimeTtlMs: 60_000,
      allowedRepoRoots: [dataDir],
      maxConcurrentRuns: 2,
      modelProvider: 'unconfigured',
    }
    const store = new StateStore(config)
    await store.init()
    const provisioner = new RuntimeProvisioner(config, store)
    const releases: Array<() => void> = []
    const providerSessions: Array<string | undefined> = []
    let invocation = 0
    const harnesses = {
      async run(input: HarnessRunInput) {
        const index = invocation++
        providerSessions.push(input.providerSessionId)
        await input.emit('agent.started', { provider: 'codex', invocation: index + 1 })
        if (index === 0) {
          await input.emit('tool.completed', {
            tool: 'codex.thread.start',
            thread_id: 'thread-native-queue',
            persistent: true,
          })
        }
        await new Promise<void>((resolve) => {
          releases[index] = resolve
        })
        await input.emit('agent.output.delta', { text: `turn-${index + 1}` })
        return { summary: '', providerId: 'codex' }
      },
    }
    const manager = new RunManager(config, store, {} as never, provisioner, harnesses as never)
    const route: RouteEstimate = {
      modelKey: 'gpt',
      modelId: 'gpt-5.4',
      harnessKey: 'coding',
      providerKey: 'codex',
      runtimeKey: 'local',
      reasons: ['test'],
      cost: '$0',
      alternatives: [],
    }

    try {
      const parent = await manager.start({
        projectId: 'project-1',
        task: 'First turn',
        route,
        principal,
      })
      await eventually(() => releases[0] !== undefined, 'parent turn did not start')
      const first = await manager.queue(parent.id, principal, 'Second turn')
      const second = await manager.queue(parent.id, principal, 'Third turn')
      assert.ok(first)
      assert.ok(second)
      assert.equal(first?.parentRunId, parent.id)
      assert.equal(first?.queuedAfterRunId, parent.id)
      assert.equal(second?.parentRunId, parent.id)
      assert.equal(second?.queuedAfterRunId, first?.id)
      assert.equal(store.run(first!.id)?.status, 'waiting')
      assert.equal(store.run(second!.id)?.status, 'waiting')

      releases[0]!()
      await eventually(() => releases[1] !== undefined, 'first queued turn did not start')
      assert.equal(store.run(first!.id)?.status, 'running')
      assert.equal(store.run(second!.id)?.status, 'waiting')
      assert.equal(providerSessions[1], 'thread-native-queue')

      releases[1]!()
      await eventually(() => releases[2] !== undefined, 'second queued turn did not start')
      assert.equal(store.run(first!.id)?.status, 'completed')
      assert.equal(store.run(second!.id)?.status, 'running')
      assert.equal(providerSessions[2], 'thread-native-queue')

      releases[2]!()
      await eventually(() => store.run(second!.id)?.status === 'completed', 'queue did not drain')
      assert.ok(store.run(first!.id)?.events.some((event) => event.type === 'agent.dequeued'))
      assert.ok(store.run(second!.id)?.events.some((event) => event.type === 'agent.dequeued'))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
