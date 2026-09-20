import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

export interface KrailRuntimeManifest {
  schemaVersion: 2
  runtime: 'krail'
  sources: Record<'interface'|'krail'|'opensaddle', { repository: string; revision: string; tree: string }>
  wheel: { name: string; sha256: string; provenance: 'pypi'|'reviewed_local' }
  opensaddle: { name: string; sha256: string; command: string; provenance: 'pypi'|'reviewed_local' }
  python: { name: string; sha256: string; command: string }
  dependencies: { report: string; sha256: string }
  runtimeLock: { name: string; sha256: string }
  requirements: { name: string; sha256: string }
  wheelSet: { count: number; sha256: string }
  commands: { admin: string; mutation: string }
  builtAt: string
}

export interface ResolvedKrailRuntime {
  manifest: KrailRuntimeManifest
  adminCommand: string
  mutationCommand: string
  backendCommand: string
}

export type DesktopBackendSelection =
  | { kind: 'selected'; command: string; source: string; bundledRuntime?: ResolvedKrailRuntime }
  | { kind: 'discover' }
  | { kind: 'unavailable' }

/** The packaged app has one authority for its executable and KRAIL commands:
 * the validated resources beside that app. Development may use an explicitly
 * configured executable before its normal local discovery path. */
export function selectDesktopBackend(input: {
  packaged: boolean
  resourceRoot: string
  configuredExecutable?: string
}): DesktopBackendSelection {
  if (input.packaged) {
    const bundledRuntime = resolveKrailRuntime(input.resourceRoot)
    return bundledRuntime
      ? { kind: 'selected', command: bundledRuntime.backendCommand, source: 'bundled backend', bundledRuntime }
      : { kind: 'unavailable' }
  }
  if (input.configuredExecutable && existsSync(input.configuredExecutable)) {
    return { kind: 'selected', command: input.configuredExecutable, source: 'configured executable' }
  }
  return { kind: 'discover' }
}

/** Passed to both the sidecar and personal-runtime subprocess boundaries. */
export function desktopRuntimeEnvironment(input: {
  inherited: NodeJS.ProcessEnv
  packaged: boolean
  bundledRuntime: ResolvedKrailRuntime | null
}): NodeJS.ProcessEnv {
  const env = { ...input.inherited }
  if (input.packaged) {
    if (!input.bundledRuntime) throw Error('Packaged runtime is unavailable')
    delete env.OPENSADDLE_EXECUTABLE
    delete env.OPENSADDLE_KRAIL_RUNTIME_DIR
    env.OPENSADDLE_KRAIL_ADMIN_COMMAND = input.bundledRuntime.adminCommand
    env.OPENSADDLE_KRAIL_MUTATION_COMMAND = input.bundledRuntime.mutationCommand
  } else if (input.bundledRuntime) {
    env.OPENSADDLE_KRAIL_ADMIN_COMMAND ??= input.bundledRuntime.adminCommand
    env.OPENSADDLE_KRAIL_MUTATION_COMMAND ??= input.bundledRuntime.mutationCommand
  }
  return env
}

function confinedBundledPath(root: string, candidate: unknown): string | null {
  if (typeof candidate !== 'string' || !candidate || path.isAbsolute(candidate)) return null
  const resolved = path.resolve(root, candidate)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null
  try {
    const actualRoot = realpathSync(root)
    const actualPath = realpathSync(resolved)
    if (actualPath !== actualRoot && !actualPath.startsWith(`${actualRoot}${path.sep}`)) return null
  } catch {
    return null
  }
  return resolved
}

function bundledCommand(root: string, candidate: unknown): string | null {
  const resolved = confinedBundledPath(root, candidate)
  if (!resolved) return null
  try {
    if (!statSync(resolved).isFile()) return null
    accessSync(resolved, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch {
    return null
  }
  return resolved
}

function bundledDigest(root: string, candidate: unknown, expected: unknown): boolean {
  if (typeof candidate !== 'string' || !candidate || path.isAbsolute(candidate) || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return false
  const resolved = confinedBundledPath(root, candidate)
  if (!resolved) return false
  try {
    return createHash('sha256').update(readFileSync(resolved)).digest('hex') === expected
  } catch {
    return false
  }
}

export function resolveKrailRuntime(resourceRoot: string): ResolvedKrailRuntime | null {
  const root = path.resolve(resourceRoot, 'krail-runtime')
  try {
    if (!confinedBundledPath(path.resolve(resourceRoot), 'krail-runtime')) return null
    const manifestPath = confinedBundledPath(root, 'manifest.json')
    if (!manifestPath) return null
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as KrailRuntimeManifest
    if (manifest.schemaVersion !== 2 || manifest.runtime !== 'krail') return null
    const expectedRepositories = {
      interface: 'https://github.com/AkeBoss-tech/opensaddle-interface.git',
      krail: 'https://github.com/AkeBoss-tech/knowledge.git',
      opensaddle: 'https://github.com/AkeBoss-tech/opensaddle.git',
    } as const
    if (!manifest.sources || Object.keys(manifest.sources).sort().join(',') !== 'interface,krail,opensaddle') return null
    if (Object.entries(expectedRepositories).some(([name, repository]) => {
      const source = manifest.sources[name as keyof typeof expectedRepositories]
      return source?.repository !== repository || !/^[a-f0-9]{40}$/.test(source?.revision ?? '') || !/^[a-f0-9]{40}$/.test(source?.tree ?? '')
    })) return null
    if (!['pypi','reviewed_local'].includes(manifest.wheel?.provenance) || !['pypi','reviewed_local'].includes(manifest.opensaddle?.provenance)) return null
    if (!manifest.wheel || typeof manifest.wheel.name !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.wheel.sha256)) return null
    if (!manifest.opensaddle || typeof manifest.opensaddle.name !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.opensaddle.sha256) || manifest.opensaddle.command !== '../opensaddle-backend/opensaddle') return null
    if (!manifest.python || typeof manifest.python.name !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.python.sha256)) return null
    if (!manifest.dependencies || !bundledDigest(root, manifest.dependencies.report, manifest.dependencies.sha256)) return null
    if (!manifest.runtimeLock || !bundledDigest(root, manifest.runtimeLock.name, manifest.runtimeLock.sha256)) return null
    if (!manifest.requirements || !bundledDigest(root, manifest.requirements.name, manifest.requirements.sha256)) return null
    if (!manifest.wheelSet || !Number.isSafeInteger(manifest.wheelSet.count) || manifest.wheelSet.count < 1 || !/^[a-f0-9]{64}$/.test(manifest.wheelSet.sha256)) return null
    const pythonCommand = bundledCommand(root, manifest.python.command)
    const adminCommand = bundledCommand(root, manifest.commands?.admin)
    const mutationCommand = bundledCommand(root, manifest.commands?.mutation)
    const backendCommand = bundledCommand(path.resolve(resourceRoot), process.platform === 'win32' ? 'opensaddle-backend/opensaddle.exe' : 'opensaddle-backend/opensaddle')
    return pythonCommand && adminCommand && mutationCommand && backendCommand
      ? { manifest, adminCommand, mutationCommand, backendCommand }
      : null
  } catch {
    return null
  }
}
