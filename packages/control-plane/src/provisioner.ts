import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ControlPlaneConfig } from './config.js'
import type { AuthPrincipal, ProvisionedRuntime, RuntimeKind } from './types.js'
import { StateStore } from './store.js'

function command(program: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() })
      else reject(new Error(`${program} exited ${code}: ${stderr.trim()}`))
    })
  })
}

function isWithin(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export class RuntimeProvisioner {
  constructor(
    private readonly config: ControlPlaneConfig,
    private readonly store: StateStore,
  ) {}

  async provision(input: {
    projectId: string
    kind: RuntimeKind
    repo?: string
    principal: AuthPrincipal
  }): Promise<ProvisionedRuntime> {
    const id = `rt_${randomUUID().slice(0, 12)}`
    const runtime: ProvisionedRuntime = {
      id,
      kind: input.kind,
      status: 'provisioning',
      projectId: input.projectId,
      ownerId: input.principal.userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.runtimeTtlMs,
    }
    await this.store.saveRuntime(runtime)

    try {
      const sourceRepo = input.repo ? await this.validateRepository(input.repo) : undefined
      if (this.config.runtimeProvider === 'docker' && input.kind !== 'local') {
        const workspace = resolve(this.config.workspaceDir, id)
        await mkdir(workspace, { recursive: true, mode: 0o700 })
        if (sourceRepo) await this.cloneRepository(sourceRepo, workspace)
        const result = await command('docker', [
          'create',
          '--name', `opensaddle-${id}`,
          '--label', 'opensaddle.managed=true',
          '--network', 'none',
          '--read-only',
          '--cap-drop', 'ALL',
          '--security-opt', 'no-new-privileges',
          '--pids-limit', '256',
          '--memory', '2g',
          '--cpus', '2',
          '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
          '--mount', `type=bind,src=${workspace},dst=/workspace`,
          '--workdir', '/workspace',
          this.config.dockerImage,
          'sleep', 'infinity',
        ])
        await command('docker', ['start', result.stdout])
        runtime.containerId = result.stdout
        runtime.workspacePath = workspace
      } else {
        const workspace = resolve(this.config.workspaceDir, id)
        await mkdir(workspace, { recursive: true, mode: 0o700 })
        if (sourceRepo) await this.cloneRepository(sourceRepo, workspace)
        runtime.workspacePath = workspace
      }
      runtime.status = 'running'
      await this.store.saveRuntime(runtime)
      return runtime
    } catch (error) {
      runtime.status = 'failed'
      await this.store.saveRuntime(runtime)
      throw error
    }
  }

  private async validateRepository(path: string): Promise<string> {
    const repo = resolve(path)
    const projects = this.store.workspace()?.projects
    const localProjectRoots = this.config.mode === 'local' && Array.isArray(projects)
      ? projects.flatMap((candidate) => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
          const local = (candidate as Record<string, unknown>).local
          if (!local || typeof local !== 'object' || Array.isArray(local)) return []
          const rootPath = (local as Record<string, unknown>).rootPath
          return typeof rootPath === 'string' ? [resolve(rootPath)] : []
        })
      : []
    if (![...this.config.allowedRepoRoots, ...localProjectRoots].some((root) => isWithin(repo, root))) {
      throw new Error('Repository path is outside OPENSADDLE_ALLOWED_REPO_ROOTS')
    }
    const info = await stat(repo)
    if (!info.isDirectory()) throw new Error('Repository path is not a directory')
    await command('git', ['-C', repo, 'rev-parse', '--is-inside-work-tree'])
    return repo
  }

  private async cloneRepository(repo: string, workspace: string): Promise<void> {
    // A local clone gives every run an isolated, diffable checkout while
    // avoiding hard links back into the source repository.
    await command('git', ['clone', '--no-hardlinks', '--quiet', '--', repo, workspace])
  }

  async release(runtimeId: string, principal: AuthPrincipal, force = false): Promise<boolean> {
    const runtime = this.store.runtime(runtimeId)
    if (!runtime) return false
    if (!force && runtime.ownerId !== principal.userId) throw new Error('Runtime belongs to another user')

    if (runtime.containerId) {
      await command('docker', ['rm', '--force', runtime.containerId])
    }
    if (runtime.workspacePath && isWithin(runtime.workspacePath, this.config.workspaceDir)) {
      await rm(runtime.workspacePath, { recursive: true, force: true })
    }
    runtime.status = 'stopped'
    await this.store.saveRuntime(runtime)
    return true
  }

  async cleanupExpired(): Promise<void> {
    const system: AuthPrincipal = { userId: 'system', roles: ['system'], authType: 'local' }
    for (const runtime of this.store.runtimes()) {
      if (runtime.status === 'running' && runtime.expiresAt <= Date.now()) {
        await this.release(runtime.id, system, true).catch(() => undefined)
      }
    }
  }
}
