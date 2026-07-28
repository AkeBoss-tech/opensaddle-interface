import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { ControlPlaneConfig } from './config.js'
import type { AuthPrincipal, ProvisionedRuntime, RuntimeKind } from './types.js'
import { StateStore } from './store.js'

function command(
  program: string,
  args: string[],
  input?: string,
  preserveOutput = false,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      shell: false,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise({
        stdout: preserveOutput ? stdout : stdout.trim(),
        stderr: preserveOutput ? stderr : stderr.trim(),
      })
      else reject(new Error(`${program} exited ${code}: ${stderr.trim()}`))
    })
    if (input !== undefined) child.stdin?.end(input)
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
    isolateChanges?: boolean
    reviewTargetPath?: string
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
      const source = input.repo ? await this.validateWorkspace(input.repo) : undefined
      const reviewTarget = input.reviewTargetPath
        ? await this.validateWorkspace(input.reviewTargetPath)
        : source
      if (input.isolateChanges && source && !source.git) {
        throw new Error('Review changes requires a Git repository')
      }
      if (this.config.runtimeProvider === 'docker' && input.kind !== 'local') {
        const workspace = resolve(this.config.workspaceDir, id)
        await mkdir(workspace, { recursive: true, mode: 0o700 })
        if (source && !source.git) throw new Error('An isolated runtime requires a Git repository')
        if (source) {
          if (input.isolateChanges) await this.cloneWorkspaceState(source.path, workspace)
          else await this.cloneRepository(source.path, workspace)
        }
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
        if (input.isolateChanges && source) {
          runtime.sourceWorkspacePath = reviewTarget?.path ?? source.path
          runtime.isolatedChanges = true
        }
      } else if (input.isolateChanges && source) {
        const workspace = resolve(this.config.workspaceDir, id)
        await mkdir(workspace, { recursive: true, mode: 0o700 })
        await this.cloneWorkspaceState(source.path, workspace)
        runtime.workspacePath = workspace
        runtime.sourceWorkspacePath = reviewTarget?.path ?? source.path
        runtime.isolatedChanges = true
      } else {
        // The local desktop runtime intentionally operates in the selected
        // project folder, matching Codex/Claude Code and making edits visible
        // to the user's editor immediately. Generated scratch runs still get
        // an OpenSaddle-owned workspace.
        if (input.kind === 'local' && source) {
          runtime.workspacePath = source.path
        } else {
          const workspace = resolve(this.config.workspaceDir, id)
          await mkdir(workspace, { recursive: true, mode: 0o700 })
          if (source && !source.git) throw new Error('An isolated runtime requires a Git repository')
          if (source) await this.cloneRepository(source.path, workspace)
          runtime.workspacePath = workspace
        }
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

  private async validateWorkspace(path: string): Promise<{ path: string; git: boolean }> {
    const workspace = resolve(path)
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
    if (![this.config.workspaceDir, ...this.config.allowedRepoRoots, ...localProjectRoots].some((root) => isWithin(workspace, root))) {
      throw new Error('Workspace path is outside OPENSADDLE_ALLOWED_REPO_ROOTS')
    }
    const info = await stat(workspace)
    if (!info.isDirectory()) throw new Error('Workspace path is not a directory')
    const git = await command('git', ['-C', workspace, 'rev-parse', '--is-inside-work-tree'])
      .then(() => true)
      .catch(() => false)
    return { path: workspace, git }
  }

  private async cloneRepository(repo: string, workspace: string): Promise<void> {
    // A local clone gives every run an isolated, diffable checkout while
    // avoiding hard links back into the source repository.
    await command('git', ['clone', '--no-hardlinks', '--quiet', '--', repo, workspace])
  }

  private async cloneWorkspaceState(repo: string, workspace: string): Promise<void> {
    await this.cloneRepository(repo, workspace)
    const hasHead = await command('git', ['-C', repo, 'rev-parse', '--verify', 'HEAD'])
      .then(() => true)
      .catch(() => false)
    if (hasHead) {
      const { stdout: patch } = await command(
        'git',
        ['-C', repo, 'diff', '--binary', 'HEAD', '--'],
        undefined,
        true,
      )
      if (patch.trim()) {
        await command('git', ['-C', workspace, 'apply', '--whitespace=nowarn', '-'], patch)
      }
    }

    const { stdout } = await command(
      'git',
      ['-C', repo, 'ls-files', '--others', '--exclude-standard', '-z'],
      undefined,
      true,
    )
    for (const relativePath of stdout.split('\0').filter(Boolean)) {
      const source = resolve(repo, relativePath)
      const destination = resolve(workspace, relativePath)
      if (!isWithin(source, repo) || !isWithin(destination, workspace)) {
        throw new Error('Untracked project path escapes the review workspace')
      }
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await cp(source, destination, {
        recursive: true,
        force: false,
        preserveTimestamps: true,
      })
    }
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
    const pausedRuntimeIds = new Set(
      this.store.runs()
        .filter((run) => run.status === 'paused' && run.runtimeId)
        .map((run) => run.runtimeId!),
    )
    for (const runtime of this.store.runtimes()) {
      // A paused run is an explicit durable checkpoint. Keep its workspace
      // available until the user resumes, retries, or cancels that run.
      if (runtime.status === 'running' && runtime.expiresAt <= Date.now() && !pausedRuntimeIds.has(runtime.id)) {
        await this.release(runtime.id, system, true).catch(() => undefined)
      }
    }
  }
}
