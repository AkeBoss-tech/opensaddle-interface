import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface KrailRuntimeManifest {
  schemaVersion: 1
  runtime: 'krail'
  wheel: { name: string; sha256: string }
  commands: { admin: string; mutation: string }
  builtAt: string
}

export interface ResolvedKrailRuntime {
  manifest: KrailRuntimeManifest
  adminCommand: string
  mutationCommand: string
}

function bundledCommand(root: string, candidate: unknown): string | null {
  if (typeof candidate !== 'string' || !candidate || path.isAbsolute(candidate)) return null
  const resolved = path.resolve(root, candidate)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null
  if (!existsSync(resolved)) return null
  try {
    accessSync(resolved, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch {
    return null
  }
  return resolved
}

export function resolveKrailRuntime(resourceRoot: string): ResolvedKrailRuntime | null {
  const root = path.resolve(resourceRoot, 'krail-runtime')
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as KrailRuntimeManifest
    if (manifest.schemaVersion !== 1 || manifest.runtime !== 'krail') return null
    if (!manifest.wheel || typeof manifest.wheel.name !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.wheel.sha256)) return null
    const adminCommand = bundledCommand(root, manifest.commands?.admin)
    const mutationCommand = bundledCommand(root, manifest.commands?.mutation)
    return adminCommand && mutationCommand
      ? { manifest, adminCommand, mutationCommand }
      : null
  } catch {
    return null
  }
}
