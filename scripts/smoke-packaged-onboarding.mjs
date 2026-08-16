import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'

const REQUIRED_CAPABILITY = 'project_onboarding'
const REQUIRED_CONTRACT = 'opensaddle.project-onboarding/v1'
const MAX_LOG_CHARS = 64_000

function requireValue(args, flag) {
  const index = args.indexOf(flag)
  if (index < 0 || !args[index + 1]) return null
  return path.resolve(args[index + 1])
}

function configuration(args) {
  const resources = requireValue(args, '--resources')
  const app = requireValue(args, '--app')
  if (Boolean(resources) === Boolean(app)) {
    throw new Error('provide exactly one of --resources <Resources> or --app <OpenSaddle.app>')
  }
  if (app) {
    const appResources = path.join(app, 'Contents', 'Resources')
    const executable = path.join(app, 'Contents', 'MacOS', 'OpenSaddle')
    if (!existsSync(executable) || !existsSync(appResources)) {
      throw new Error(`packaged app is incomplete: ${app}`)
    }
    return { mode: 'desktop-app', command: executable, args: [], resources: appResources }
  }
  const launcher = path.join(resources, 'opensaddle-backend', process.platform === 'win32' ? 'opensaddle.exe' : 'opensaddle')
  if (!existsSync(launcher)) throw new Error(`OpenSaddle sidecar launcher is missing: ${launcher}`)
  return { mode: 'sidecar', command: launcher, args: null, resources }
}

function appendLog(current, chunk) {
  const next = current + String(chunk)
  return next.length > MAX_LOG_CHARS ? next.slice(-MAX_LOG_CHARS) : next
}

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('could not reserve a loopback port')))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

function gitExecutable() {
  if (process.env.GIT_EXECUTABLE && existsSync(process.env.GIT_EXECUTABLE)) return process.env.GIT_EXECUTABLE
  return existsSync('/usr/bin/git') ? '/usr/bin/git' : 'git'
}

function git(repo, args, env) {
  const result = spawnSync(gitExecutable(), args, {
    cwd: repo,
    env,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.status}):\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
  return (result.stdout ?? '').trim()
}

function createDisposableProject(root, env) {
  mkdirSync(root, { recursive: true })
  git(root, ['init', '--initial-branch=main'], env)
  git(root, ['config', 'user.name', 'OpenSaddle release smoke'], env)
  git(root, ['config', 'user.email', 'release-smoke@opensaddle.invalid'], env)
  writeFileSync(path.join(root, 'README.md'), '# Packaged onboarding smoke\n\nA disposable local project.\n')
  writeFileSync(path.join(root, 'pyproject.toml'), '[tool.pytest.ini_options]\naddopts = "-q"\n')
  git(root, ['add', 'README.md', 'pyproject.toml'], env)
  git(root, ['commit', '-m', 'Seed disposable project'], env)
  // Deliberately keep the project dirty: prepare/discovery must work while
  // execution remains gated, so this smoke never starts Codex or Claude.
  writeFileSync(path.join(root, 'LOCAL_NOTES.md'), 'Uncommitted by design for the profile-only smoke.\n')
  return {
    head: git(root, ['rev-parse', 'HEAD'], env),
    status: git(root, ['status', '--porcelain=v1', '--untracked-files=all'], env),
  }
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(new URL(route, baseUrl), {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
  })
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${options.method ?? 'GET'} ${route} returned non-JSON HTTP ${response.status}: ${text.slice(0, 2_000)}`)
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${route} returned HTTP ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

async function waitForCompatibleHealth(baseUrl, childState, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no response'
  while (Date.now() < deadline) {
    if (childState.spawnError) throw childState.spawnError
    if (childState.child.exitCode !== null) {
      throw new Error(`runtime exited before health became ready (code ${childState.child.exitCode})`)
    }
    try {
      const health = await requestJson(baseUrl, '/api/health', { timeoutMs: 1_000 })
      if (
        health?.service === 'opensaddle'
        && health?.mode === 'local'
        && Array.isArray(health.capabilities)
        && health.capabilities.includes(REQUIRED_CAPABILITY)
        && health.contracts?.project_onboarding === REQUIRED_CONTRACT
      ) return health
      lastError = `incompatible health payload: ${JSON.stringify(health)}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`compatible sidecar did not become ready at ${baseUrl}: ${lastError}`)
}

async function waitForManagedOwnership(stateDir, baseUrl, timeoutMs = 5_000) {
  const ownershipPath = path.join(stateDir, 'desktop-sidecar.json')
  const deadline = Date.now() + timeoutMs
  let lastError = 'ownership record was not created'
  while (Date.now() < deadline) {
    try {
      const ownership = JSON.parse(readFileSync(ownershipPath, 'utf8'))
      if (
        ownership?.version === 1
        && Number.isSafeInteger(ownership.pid)
        && ownership.pid > 1
        && ownership.url === baseUrl
        && path.resolve(ownership.stateDir ?? '') === path.resolve(stateDir)
        && typeof ownership.command === 'string'
        && ownership.command.includes('opensaddle-backend')
      ) return ownership
      lastError = `invalid ownership record: ${JSON.stringify(ownership)}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Electron did not record ownership of its packaged sidecar: ${lastError}`)
}

function processRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function signalProcessGroup(pid, signal) {
  try {
    if (process.platform !== 'win32') process.kill(-pid, signal)
    else process.kill(pid, signal)
    return
  } catch {
    try { process.kill(pid, signal) } catch { /* already stopped */ }
  }
}

async function terminatePid(pid, graceMs = 5_000) {
  if (!processRunning(pid)) return
  signalProcessGroup(pid, 'SIGTERM')
  const deadline = Date.now() + graceMs
  while (processRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (processRunning(pid)) signalProcessGroup(pid, 'SIGKILL')
}

async function waitForStopped(baseUrl, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(new URL('/api/health', baseUrl), { signal: AbortSignal.timeout(300) })
    } catch {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

async function runSmoke(config, context) {
  const port = await unusedPort()
  const baseUrl = `http://127.0.0.1:${port}`
  const home = path.join(context.tempRoot, 'home')
  const state = path.join(context.tempRoot, 'state')
  const project = path.join(context.tempRoot, 'project')
  mkdirSync(home, { recursive: true })
  mkdirSync(state, { recursive: true })
  const sanitizedEnv = {
    PATH: '/usr/bin:/bin',
    HOME: home,
    TMPDIR: context.tempRoot,
    LANG: 'C.UTF-8',
    OPENSADDLE_URL: baseUrl,
    OPENSADDLE_DATA_DIR: state,
    OPENSADDLE_KRAIL_RUNTIME_DIR: config.resources,
    OPENSADDLE_SIDECAR_STDIO: 'inherit',
    OPENSADDLE_CLI_PATH_MODE: 'inherited-only',
    ELECTRON_ENABLE_LOGGING: '1',
  }
  if (config.mode === 'sidecar') {
    sanitizedEnv.OPENSADDLE_KRAIL_ADMIN_COMMAND = path.join(config.resources, 'krail-runtime', 'bin', 'krail-admin')
    sanitizedEnv.OPENSADDLE_KRAIL_MUTATION_COMMAND = path.join(config.resources, 'krail-runtime', 'bin', 'krail-mutate')
    config.args = ['serve-api', '--host', '127.0.0.1', '--port', String(port), '--state-dir', state]
  }

  const before = createDisposableProject(project, sanitizedEnv)
  const child = spawn(config.command, config.args, {
    env: sanitizedEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  context.child = child
  context.stateDir = state
  context.baseUrl = baseUrl
  child.stdout?.on('data', (chunk) => { context.stdout = appendLog(context.stdout, chunk) })
  child.stderr?.on('data', (chunk) => { context.stderr = appendLog(context.stderr, chunk) })
  child.once('error', (error) => { context.spawnError = error })
  const health = await waitForCompatibleHealth(baseUrl, { child, get spawnError() { return context.spawnError } })
  if (health.clis?.codex !== false || health.clis?.claude_code !== false) {
    throw new Error(`clean profile-only smoke unexpectedly discovered Codex or Claude: ${JSON.stringify(health.clis)}`)
  }
  const ownership = config.mode === 'desktop-app'
    ? await waitForManagedOwnership(state, baseUrl)
    : null

  const tokenPayload = await requestJson(baseUrl, '/api/local-action-token')
  if (typeof tokenPayload?.token !== 'string' || tokenPayload.token.length < 16) {
    throw new Error('local-action bootstrap returned no usable token')
  }
  const projectId = 'packaged-smoke'
  const registered = await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, root: project }),
  })
  if (registered?.project_id !== projectId || path.resolve(registered?.root ?? '') !== path.resolve(project)) {
    throw new Error(`project registration mismatch: ${JSON.stringify(registered)}`)
  }
  const prepared = await requestJson(baseUrl, `/api/projects/${projectId}/onboarding/prepare`, {
    method: 'POST',
    headers: { 'x-opensaddle-local-action': tokenPayload.token },
    body: JSON.stringify({ runner: 'codex_cli' }),
  })
  if (
    prepared?.contract !== 'opensaddle.project-onboarding/v1'
    || prepared?.project_id !== projectId
    || prepared?.status !== 'ready'
    || prepared?.active_run_id !== null
    || prepared?.discovery?.contract !== 'krail.project-discovery/v1'
    || prepared?.discovery?.repository?.dirty !== true
    || prepared?.execution_ready !== false
    || !prepared?.execution_barriers?.includes('git_clean')
  ) {
    throw new Error(`profile-only prepare returned an invalid state: ${JSON.stringify(prepared)}`)
  }
  const persisted = await requestJson(baseUrl, `/api/projects/${projectId}/onboarding`)
  if (persisted?.fingerprint !== prepared.fingerprint || persisted?.active_run_id !== null) {
    throw new Error('prepared onboarding state was not durably readable')
  }

  const after = {
    head: git(project, ['rev-parse', 'HEAD'], sanitizedEnv),
    status: git(project, ['status', '--porcelain=v1', '--untracked-files=all'], sanitizedEnv),
  }
  if (after.head !== before.head || after.status !== before.status || existsSync(path.join(project, '.opensaddle'))) {
    throw new Error(`profile-only prepare mutated the project: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    mode: config.mode,
    baseUrl,
    capability: REQUIRED_CAPABILITY,
    contract: REQUIRED_CONTRACT,
    healthMode: health.mode,
    managedSidecarPid: ownership?.pid ?? null,
    projectId,
    fingerprint: prepared.fingerprint,
    executionBarriers: prepared.execution_barriers,
    sourceUnchanged: true,
  }, null, 2))
}

async function cleanup(context) {
  if (context.child?.pid) await terminatePid(context.child.pid)
  const ownershipPath = context.stateDir ? path.join(context.stateDir, 'desktop-sidecar.json') : null
  if (ownershipPath && existsSync(ownershipPath)) {
    try {
      const ownership = JSON.parse(readFileSync(ownershipPath, 'utf8'))
      if (Number.isSafeInteger(ownership.pid)) await terminatePid(ownership.pid)
    } catch { /* malformed diagnostics should not prevent remaining cleanup */ }
  }
  if (context.baseUrl && !await waitForStopped(context.baseUrl)) {
    throw new Error(`sidecar remained reachable after cleanup at ${context.baseUrl}`)
  }
}

const context = {
  tempRoot: mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'opensaddle-packaged-smoke-')),
  child: null,
  stateDir: null,
  baseUrl: null,
  spawnError: null,
  stdout: '',
  stderr: '',
}
let failed = false
try {
  await runSmoke(configuration(process.argv.slice(2)), context)
} catch (error) {
  failed = true
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  if (context.stdout) console.error(`\n--- runtime stdout (tail) ---\n${context.stdout}`)
  if (context.stderr) console.error(`\n--- runtime stderr (tail) ---\n${context.stderr}`)
} finally {
  try {
    await cleanup(context)
  } catch (error) {
    failed = true
    console.error(`cleanup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  }
  if (failed && process.env.OPENSADDLE_SMOKE_KEEP === '1') {
    console.error(`preserved smoke directory: ${context.tempRoot}`)
  } else {
    rmSync(context.tempRoot, { recursive: true, force: true })
  }
}
if (failed) process.exitCode = 1
