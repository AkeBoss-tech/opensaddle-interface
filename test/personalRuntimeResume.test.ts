import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import os from 'node:os'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { canonicalPersonalRuntimeStateDir, inspectPersonalRuntimeResume } from '../electron/personalRuntimeResume'

async function listener() {
  const server = createServer(socket => socket.destroy())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return { server, port: address.port, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'opensaddle-resume-')))
  const stateDir = path.join(root, 'personal-runtime')
  const ipcDir = path.join(root, 'runtime-ipc')
  await mkdir(path.join(stateDir, 'identity'), { recursive: true, mode: 0o700 })
  await mkdir(ipcDir, { mode: 0o700 })
  const endpoint = await listener()
  const baseUrl = `http://127.0.0.1:${endpoint.port}`
  await endpoint.close()
  const adoption = {
    schema_version: 'opensaddle.personal-runtime-desktop.v1', base_url: baseUrl,
    installation_id: 'installation-test', project_id: 'project-test',
    adoption_socket: path.join(ipcDir, 'p.sock'), ipc_dir: ipcDir,
  }
  const state = {
    schema_version: 'opensaddle.personal-runtime-state.v1', installation_id: 'installation-test',
    owner_subject: 'installation-test', project_id: 'project-test', worker_id: 'personal-codex-test',
    lifecycle: 'running', state_revision: 0, worker_process_id: 999999,
    unresolved_process_group_id: null,
  }
  const put = async (relative: string, value: unknown) =>
    writeFile(path.join(stateDir, relative), JSON.stringify(value), { mode: 0o600 })
  await put('desktop-adoption.json', adoption)
  await put('personal-runtime.json', state)
  await put('identity/daemon.identity', { install_id: 'installation-test' })
  await writeFile(path.join(stateDir, 'identity/daemon.token'), 'fixture-only-token', { mode: 0o600 })
  return { root, stateDir, ipcDir, adoption, state, put, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('stopped owned endpoint and exact retained identity yield only a secret-free offline restart candidate', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir: f.stateDir, ipcDir: f.ipcDir }),
      { kind: 'offline', projectId: 'project-test', installationId: 'installation-test' })
  } finally { await f.cleanup() }
})

test('uncertain live endpoint, mismatched identity, recovery, and symlinked metadata never offer restart', async () => {
  const f = await fixture()
  try {
    const live = createServer(socket => socket.destroy())
    const port = Number(new URL(f.adoption.base_url).port)
    await new Promise<void>(resolve => live.listen(port, '127.0.0.1', resolve))
    try {
      assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir: f.stateDir, ipcDir: f.ipcDir }),
        { kind: 'blocked', reason: 'runtime_may_be_running' })
    } finally { await new Promise<void>(resolve => live.close(() => resolve())) }
    await f.put('identity/daemon.identity', { install_id: 'other-installation' })
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir: f.stateDir, ipcDir: f.ipcDir }),
      { kind: 'blocked', reason: 'retained_state_invalid' })
    await f.put('identity/daemon.identity', { install_id: 'installation-test' })
    await f.put('personal-runtime.json', { ...f.state, unresolved_process_group_id: 12345 })
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir: f.stateDir, ipcDir: f.ipcDir }),
      { kind: 'blocked', reason: 'recovery_required' })
    await f.put('personal-runtime.json', f.state)
    const adoptionPath = path.join(f.stateDir, 'desktop-adoption.json')
    await rm(adoptionPath)
    await symlink(path.join(f.root, 'other.json'), adoptionPath)
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir: f.stateDir, ipcDir: f.ipcDir }),
      { kind: 'blocked', reason: 'retained_state_invalid' })
    await rm(adoptionPath)
    await f.put('desktop-adoption.json', f.adoption)
    const identityDir = path.join(f.stateDir, 'identity')
    const relocatedIdentity = path.join(f.root, 'relocated-identity')
    await rename(identityDir, relocatedIdentity)
    await symlink(relocatedIdentity, identityDir)
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir: f.stateDir, ipcDir: f.ipcDir }),
      { kind: 'blocked', reason: 'retained_state_invalid' })
  } finally { await f.cleanup() }
})

test('desktop state-path probe rejects a symlink at the owned runtime directory', async () => {
  const f = await fixture()
  try {
    const alias = path.join(f.root, 'runtime-alias')
    await symlink(f.stateDir, alias)
    await assert.rejects(canonicalPersonalRuntimeStateDir(alias), /directory is invalid/)
    assert.equal(await canonicalPersonalRuntimeStateDir(f.stateDir), f.stateDir)
  } finally { await f.cleanup() }
})

test('partial retained data is blocked rather than presented as a fresh installation', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'opensaddle-partial-')))
  const stateDir = path.join(root, 'personal-runtime')
  try {
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir, ipcDir: path.join(root, 'ipc') }),
      { kind: 'none' })
    await mkdir(stateDir, { mode: 0o700 })
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir, ipcDir: path.join(root, 'ipc') }),
      { kind: 'none' })
    await writeFile(path.join(stateDir, 'worker-runtime.db'), 'retained fixture bytes', { mode: 0o600 })
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir, ipcDir: path.join(root, 'ipc') }),
      { kind: 'blocked', reason: 'retained_state_invalid' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('live or ambiguous runtime lock blocks restart, while an exact dead owner leaves recovery to Core', async () => {
  const f = await fixture()
  try {
    const lock = path.join(f.stateDir, 'personal-runtime.lock')
    const record = (pid: number) => ({ pid, hostname: os.hostname(), created_at: Date.now() / 1000 - 10 })
    await writeFile(lock, JSON.stringify(record(process.pid)), { mode: 0o600 })
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir: f.stateDir, ipcDir: f.ipcDir }),
      { kind: 'blocked', reason: 'runtime_may_be_running' })
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
    assert.ok(child.pid)
    await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('close', () => resolve()) })
    await writeFile(lock, JSON.stringify(record(child.pid)), { mode: 0o600 })
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir: f.stateDir, ipcDir: f.ipcDir }),
      { kind: 'offline', projectId: 'project-test', installationId: 'installation-test' })
    await writeFile(lock, JSON.stringify({ ...record(child.pid), hostname: 'other-host' }), { mode: 0o600 })
    assert.deepEqual(await inspectPersonalRuntimeResume({ stateDir: f.stateDir, ipcDir: f.ipcDir }),
      { kind: 'blocked', reason: 'runtime_may_be_running' })
  } finally { await f.cleanup() }
})
