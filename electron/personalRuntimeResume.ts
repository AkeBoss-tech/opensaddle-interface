import path from 'node:path'
import { constants } from 'node:fs'
import { open, lstat, realpath, readdir } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { hostname } from 'node:os'
import { adoptPersonalRuntime } from './personalRuntimeCommissioning.js'

export type PersonalRuntimeResumeStatus =
  | { kind: 'none' }
  | { kind: 'offline'; projectId: string; installationId: string }
  | { kind: 'blocked'; reason: 'retained_state_invalid' | 'recovery_required' | 'runtime_may_be_running' | 'authority_changed' }

export type StoredMetadata = {
  schema_version: string
  base_url: string
  installation_id: string
  project_id: string
  adoption_socket: string
  ipc_dir: string
}

export async function canonicalPersonalRuntimeStateDir(requestedStateDir: string): Promise<string> {
  // /tmp may itself be a trusted platform symlink; the final owned directory
  // must not be. Check that component before resolving ancestor aliases.
  try {
    if ((await lstat(requestedStateDir)).isSymbolicLink())
      throw Error('Retained personal runtime directory is invalid')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return realpath(requestedStateDir).catch(() => path.resolve(requestedStateDir))
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('retained state is invalid')
  return value as Record<string, unknown>
}
const sameKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const nonempty = (value: unknown, max = 256): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0')
const noFollow = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)

async function privateJson(file: string, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const descriptor = await open(file, noFollow)
  try {
    const stat = await descriptor.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes ||
        (process.getuid && stat.uid !== process.getuid()) ||
        (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw Error('retained state is invalid')
    // A concurrent writer may grow the file after stat. Never read beyond the
    // private metadata bound, even if its size changes during this read.
    const buffer = Buffer.alloc(maxBytes + 1)
    let bytes = 0
    while (bytes < buffer.length) {
      const chunk = await descriptor.read(buffer, bytes, buffer.length - bytes, bytes)
      if (!chunk.bytesRead) break
      bytes += chunk.bytesRead
    }
    if (bytes < 1 || bytes > maxBytes) throw Error('retained state is invalid')
    return record(JSON.parse(buffer.toString('utf8', 0, bytes)))
  } finally { await descriptor.close() }
}

async function privateRegularFile(file: string): Promise<boolean> {
  try {
    const stat = await lstat(file)
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 4096 &&
      (!process.getuid || stat.uid === process.getuid()) &&
      (process.platform === 'win32' || (stat.mode & 0o077) === 0)
  } catch { return false }
}

async function privateDirectory(directory: string): Promise<boolean> {
  try {
    const stat = await lstat(directory)
    return stat.isDirectory() && !stat.isSymbolicLink() &&
      (!process.getuid || stat.uid === process.getuid()) &&
      (process.platform === 'win32' || (stat.mode & 0o077) === 0)
  } catch { return false }
}

export async function readPersonalRuntimeAdoptionMetadata(input: { stateDir: string; ipcDir: string }): Promise<StoredMetadata> {
  if (!await privateDirectory(input.stateDir) || !await privateDirectory(input.ipcDir))
    throw Error('retained state directory is invalid')
  const canonicalIpcDir = await realpath(input.ipcDir)
  const metadata = await privateJson(path.join(input.stateDir, 'desktop-adoption.json'), 4096)
  if (!sameKeys(metadata, ['schema_version', 'base_url', 'installation_id', 'project_id', 'adoption_socket', 'ipc_dir']) ||
      metadata.schema_version !== 'opensaddle.personal-runtime-desktop.v1' ||
      !nonempty(metadata.project_id, 128) || !nonempty(metadata.installation_id, 128) ||
      !nonempty(metadata.base_url, 128) || !nonempty(metadata.ipc_dir, 1024) ||
      !nonempty(metadata.adoption_socket, 1024) ||
      metadata.ipc_dir !== canonicalIpcDir ||
      metadata.adoption_socket !== path.join(canonicalIpcDir, 'p.sock') ||
      path.dirname(metadata.adoption_socket) !== canonicalIpcDir) throw Error('retained adoption metadata is invalid')
  const url = new URL(metadata.base_url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      metadata.base_url !== url.origin || url.username || url.password || url.search || url.hash)
    throw Error('retained adoption endpoint is invalid')
  return metadata as StoredMetadata
}

const connectionRefused = (error: unknown) =>
  error && typeof error === 'object' && ['ENOENT', 'ECONNREFUSED'].includes(String((error as NodeJS.ErrnoException).code))

async function oldEndpointOffline(baseUrl: string): Promise<boolean> {
  const url = new URL(baseUrl)
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(url.port) })
    let settled = false
    const done = (offline: boolean) => { if (settled) return; settled = true; socket.destroy(); resolve(offline) }
    socket.setTimeout(500, () => done(false))
    socket.once('connect', () => done(false))
    socket.once('error', error => done((error as NodeJS.ErrnoException).code === 'ECONNREFUSED'))
  })
}

async function lockDoesNotHaveLiveOwner(stateDir: string): Promise<boolean> {
  const lockFile = path.join(stateDir, 'personal-runtime.lock')
  try {
    await lstat(lockFile)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
  try {
    const lock = await privateJson(lockFile, 4096)
    if (!sameKeys(lock, ['pid', 'hostname', 'created_at']) ||
        !Number.isSafeInteger(lock.pid) || Number(lock.pid) < 1 ||
        lock.hostname !== hostname() ||
        typeof lock.created_at !== 'number' || !Number.isFinite(lock.created_at) ||
        lock.created_at < 1 || lock.created_at > Date.now() / 1000)
      return false
    process.kill(Number(lock.pid), 0)
    return false
  } catch (error) {
    // Core alone may remove a stale lock. This read only recognizes a dead
    // exact-host PID; uncertain/foreign/malformed locks remain blocked.
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

/** Read-only classification. A failed adoption and a refused old endpoint are
 * required before the UI may offer an explicit restart. Core remains the final
 * authority for its lock, Project/root binding and unknown Run reconciliation. */
export async function inspectPersonalRuntimeResume(input: { stateDir: string; ipcDir: string }): Promise<PersonalRuntimeResumeStatus> {
  const stateDir = path.resolve(input.stateDir)
  const adoptionFile = path.join(stateDir, 'desktop-adoption.json')
  const stateFile = path.join(stateDir, 'personal-runtime.json')
  const identityFile = path.join(stateDir, 'identity', 'daemon.identity')
  const tokenFile = path.join(stateDir, 'identity', 'daemon.token')
  const exists = await Promise.all([adoptionFile, stateFile, identityFile, tokenFile].map(async file => {
    try { await lstat(file); return true } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  })).catch(() => null)
  if (!exists) return { kind: 'blocked', reason: 'retained_state_invalid' }
  if (exists.every(value => !value)) {
    try {
      const entries = await readdir(stateDir)
      if (!await privateDirectory(stateDir)) return { kind: 'blocked', reason: 'retained_state_invalid' }
      return entries.length === 0
        ? { kind: 'none' }
        : { kind: 'blocked', reason: 'retained_state_invalid' }
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? { kind: 'none' }
        : { kind: 'blocked', reason: 'retained_state_invalid' }
    }
  }
  if (exists.some(value => !value)) return { kind: 'blocked', reason: 'retained_state_invalid' }
  try {
    if (!await privateDirectory(stateDir) ||
        !await privateDirectory(path.join(stateDir, 'identity')) ||
        !await privateDirectory(input.ipcDir) ||
        !await privateRegularFile(tokenFile)) throw Error('retained state is invalid')
    const canonicalStateDir = await realpath(stateDir)
    const canonicalIpcDir = await realpath(input.ipcDir)
    const [metadata, identity, state] = await Promise.all([
      readPersonalRuntimeAdoptionMetadata({ stateDir: canonicalStateDir, ipcDir: canonicalIpcDir }),
      privateJson(identityFile, 4096), privateJson(stateFile),
    ])
    if (!sameKeys(identity, ['install_id']) || identity.install_id !== metadata.installation_id ||
        state.schema_version !== 'opensaddle.personal-runtime-state.v1' ||
        state.installation_id !== metadata.installation_id ||
        state.owner_subject !== metadata.installation_id ||
        state.project_id !== metadata.project_id ||
        !nonempty(state.worker_id, 128) ||
        canonicalStateDir !== stateDir) throw Error('retained state identity is invalid')
    if (state.lifecycle === 'intervention_required' || state.unresolved_process_group_id != null)
      return { kind: 'blocked', reason: 'recovery_required' }
    if (!['running', 'draining', 'stopped', 'degraded'].includes(String(state.lifecycle)))
      throw Error('retained lifecycle is invalid')
    if (!await lockDoesNotHaveLiveOwner(stateDir))
      return { kind: 'blocked', reason: 'runtime_may_be_running' }
    try {
      await adoptPersonalRuntime({
        stateDir: canonicalStateDir, ipcDir: canonicalIpcDir,
        socketPath: metadata.adoption_socket, baseUrl: metadata.base_url,
        installationId: metadata.installation_id, projectId: metadata.project_id,
        timeoutMs: 500,
      })
      return { kind: 'blocked', reason: 'runtime_may_be_running' }
    } catch (error) {
      if (!connectionRefused(error) || !await oldEndpointOffline(metadata.base_url))
        return { kind: 'blocked', reason: 'runtime_may_be_running' }
      return { kind: 'offline', projectId: metadata.project_id, installationId: metadata.installation_id }
    }
  } catch { return { kind: 'blocked', reason: 'retained_state_invalid' } }
}
