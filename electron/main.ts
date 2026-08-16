import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, WebContentsView } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'
import { readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { desktopCliPath, resolveDesktopCli } from './cliDiscovery.js'
import { resolveKrailRuntime } from './runtimeBundle.js'
import {
  classifySidecarHealth,
  incompatibleSidecarMessage,
  type SidecarHealth,
} from './sidecarCompatibility.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged

/**
 * The renderer is an ES-module bundle, and a module script cannot be fetched
 * from a `file://` origin — Chromium requires CORS for modules and file origins
 * are opaque, so `loadFile` yields a blank window. Serving the same directory
 * over a privileged scheme keeps webSecurity on and works packaged or not.
 */
const RENDERER_SCHEME = 'opensaddle'
protocol.registerSchemesAsPrivileged([{
  scheme: RENDERER_SCHEME,
  // `standard` is what lets module scripts load; deliberately NOT `secure`,
  // because a secure origin treats the local control plane's plain http://
  // endpoint as mixed content and blocks every API call.
  privileges: { standard: true, supportFetchAPI: true, corsEnabled: true },
}])

function rendererRoot(): string {
  return isDev
    ? path.resolve(__dirname, '../../dist')
    : path.join(process.resourcesPath, 'renderer')
}

function registerRendererProtocol() {
  const root = rendererRoot()
  protocol.handle(RENDERER_SCHEME, (request) => {
    const requested = decodeURIComponent(new URL(request.url).pathname)
    const resolved = path.join(root, requested)
    // Any unknown path resolves to the shell so hash routing still works, and a
    // traversal attempt outside the bundle root can never escape it.
    const safe = resolved.startsWith(root) && existsSync(resolved) && !resolved.endsWith('/')
      ? resolved
      : path.join(root, 'index.html')
    return net.fetch(`file://${safe}`)
  })
}

let mainWindow: BrowserWindow | null = null
let opensaddleProc: ChildProcess | null = null
let sessionBridgeProc: ChildProcess | null = null
let embeddedBrowser: WebContentsView | null = null
let sidecarsShuttingDown = false
let opensaddleRestartTimer: NodeJS.Timeout | null = null
let opensaddleHealthTimer: NodeJS.Timeout | null = null
let opensaddleEnsurePromise: Promise<boolean> | null = null
let opensaddleLaunchError: string | null = null
let opensaddleOwnedPid: number | null = null
let sidecarsStopPromise: Promise<void> | null = null
let quitAfterSidecars = false

const opensaddleUrlConfigured = Boolean(process.env.OPENSADDLE_URL)
let opensaddleUrl = process.env.OPENSADDLE_URL ?? 'http://127.0.0.1:8765'
let opensaddleCompatibilityNotice: string | null = null
const SESSION_BRIDGE_URL = process.env.SESSION_BRIDGE_URL ?? process.env.KRAIL_URL ?? 'http://127.0.0.1:8787'

function packagedKrailRuntime() {
  return resolveKrailRuntime(
    process.env.OPENSADDLE_KRAIL_RUNTIME_DIR ?? process.resourcesPath,
  )
}

const CLI_CANDIDATES = ['codex', 'claude', 'cursor-agent', 'agent', 'gemini', 'opencode', 'antigravity', 'aider', 'copilot', 'amp', 'agy', 'openclaw', 'hermes', 'pi']
const APP_ICON = isDev ? path.resolve(__dirname, '../assets/opensaddle-icon.png') : path.join(process.resourcesPath, 'opensaddle-icon.png')
const SKIP_PROJECT_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage', 'vendor'])

interface LocalProjectInspection {
  rootPath: string
  name: string
  description: string
  detectedConfigs: string[]
  documents: Array<{ title: string; path: string }>
  skills: Array<{ name: string; path: string; description: string }>
  fileCount: number
  languages: string[]
}

interface WorkspaceScanSnapshot {
  scannedAt?: number
  folderPath: string
  folderName: string
  directories: string[]
  configPaths: string[]
  packageScripts: string[]
  dependencyNames: string[]
  makefile: string | null
  envExamplePaths: string[]
  envExampleVariableNames: string[]
  connectorPaths: string[]
  git: {
    readable: boolean
    reason?: string
    branches: string[]
    commitCount: number
    directoryCommitCounts?: Record<string, number>
    authors: Array<{ name: string; email: string; commitCount: number }>
    hasRemote: boolean
    remoteHost?: string
    branchActivity?: Record<string, number>
  }
}

function gitOutput(folderPath: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: folderPath, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout)
    })
  })
}

function gitRemoteHost(remote: string | null): string | undefined {
  const value = remote?.trim()
  if (!value) return undefined
  try { return new URL(value).hostname.toLowerCase() || undefined } catch { /* try scp-style remotes */ }
  return value.match(/^[^@\s]+@([^:/\s]+):/)?.[1]?.toLowerCase()
}

function parseEnvExampleVariableNames(source: string): string[] {
  return [...new Set(source.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    return match ? [match[1]] : []
  }))]
}

async function scanWorkspaceFolder(input: string): Promise<WorkspaceScanSnapshot> {
  const folderPath = await realpath(input).catch(() => input)
  const folderName = path.basename(folderPath) || folderPath
  const entries = await readdir(folderPath, { withFileTypes: true }).catch(() => [])
  const names = new Set(entries.map((entry) => entry.name))
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  const configPaths = ['.claude/', '.codex/', '.cursor/', 'AGENTS.md', 'CLAUDE.md', '.opensaddle/']
    .filter((marker) => names.has(marker.replace(/\/$/, '')))
  const packageMetadata = await readFile(path.join(folderPath, 'package.json'), 'utf8')
    .then((source) => {
      const pkg = JSON.parse(source) as { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
      return {
        packageScripts: Object.entries(pkg.scripts ?? {}).flatMap(([name, command]) => typeof command === 'string' ? [`${name}: ${command}`] : []),
        dependencyNames: [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])],
      }
    })
    .catch(() => ({ packageScripts: [], dependencyNames: [] }))
  const { packageScripts, dependencyNames } = packageMetadata
  const makefile = names.has('Makefile')
    ? await readFile(path.join(folderPath, 'Makefile'), 'utf8').catch(() => '')
    : null
  const envExamplePaths = names.has('.env.example') ? ['.env.example'] : []
  const envExampleVariableNames = names.has('.env.example')
    ? parseEnvExampleVariableNames(await readFile(path.join(folderPath, '.env.example'), 'utf8').catch(() => '')) : []
  const connectorPaths = ['netlify.toml', 'vercel.json', 'cloudbuild.yaml', 'app.yaml', 'Dockerfile', '.gcloudignore', 'supabase/', '.github/workflows/']
    .filter((marker) => marker === '.github/workflows/'
      ? entries.some((entry) => entry.name === '.github' && entry.isDirectory()) && existsSync(path.join(folderPath, '.github', 'workflows'))
      : names.has(marker.replace(/\/$/, '')))

  const isGitRepository = (await gitOutput(folderPath, ['rev-parse', '--is-inside-work-tree']))?.trim() === 'true'
  if (!isGitRepository) {
    return {
      scannedAt: Date.now(),
      folderPath, folderName, directories, configPaths, packageScripts, dependencyNames, makefile, envExamplePaths, envExampleVariableNames, connectorPaths,
      git: { readable: false, reason: 'No readable git history was found for this folder.', branches: [], commitCount: 0, authors: [], hasRemote: false },
    }
  }

  // Branches carry their last-commit date so stale ones can be filtered out.
  // A long-lived repo accumulates dead branches; proposing all of them as
  // channels buries the handful anyone is actually working on.
  const branchLines = ((await gitOutput(folderPath, [
    'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)|%(committerdate:unix)', 'refs/heads',
  ])) ?? '').split(/\r?\n/).filter(Boolean)
  const branches = branchLines.map((line) => line.split('|')[0]!.trim()).filter(Boolean)
  const branchActivity: Record<string, number> = {}
  for (const line of branchLines) {
    const [name, when] = line.split('|')
    const seconds = Number(when)
    if (name && Number.isFinite(seconds)) branchActivity[name.trim()] = seconds * 1000
  }
  const authorCounts = new Map<string, { name: string; email: string; commitCount: number }>()
  const authorLines = ((await gitOutput(folderPath, ['log', '--format=%an|%ae'])) ?? '').split(/\r?\n/)
  for (const line of authorLines) {
    const separator = line.lastIndexOf('|')
    if (separator < 1) continue
    const name = line.slice(0, separator).trim()
    const email = line.slice(separator + 1).trim()
    if (!name || !email) continue
    const key = `${name}\u0000${email}`
    const author = authorCounts.get(key)
    if (author) author.commitCount += 1
    else authorCounts.set(key, { name, email, commitCount: 1 })
  }
  const authors = [...authorCounts.values()]
  const hasRemote = Boolean((await gitOutput(folderPath, ['remote']))?.trim())
  const remoteHost = gitRemoteHost(await gitOutput(folderPath, ['remote', 'get-url', 'origin']))

  // Per-directory commit counts so a proposed channel can justify itself with a
  // number that actually describes that directory. Bounded to keep the scan quick.
  const directoryCommitCounts: Record<string, number> = {}
  for (const directory of directories.slice(0, 40)) {
    const log = await gitOutput(folderPath, ['log', '--oneline', '--', directory])
    if (log !== null) directoryCommitCounts[directory] = log.split(/\r?\n/).filter(Boolean).length
  }

  return {
    scannedAt: Date.now(),
    folderPath, folderName, directories, configPaths, packageScripts, dependencyNames, makefile, envExamplePaths, envExampleVariableNames, connectorPaths,
    git: { readable: true, branches, branchActivity, commitCount: authorLines.filter(Boolean).length, directoryCommitCounts, authors, hasRemote, remoteHost },
  }
}

async function inspectLocalProject(input: string): Promise<LocalProjectInspection> {
  const rootPath = await realpath(input)
  if (!(await stat(rootPath)).isDirectory()) throw new Error('Selected project is not a directory')
  const detectedConfigs: string[] = []
  const documents: LocalProjectInspection['documents'] = []
  const skills: LocalProjectInspection['skills'] = []
  const extensionCounts = new Map<string, number>()
  let fileCount = 0

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 5 || fileCount >= 4_000) return
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (fileCount >= 4_000) break
      if (entry.isSymbolicLink()) continue
      const absolute = path.join(directory, entry.name)
      const relativePath = path.relative(rootPath, absolute)
      if (entry.isDirectory()) {
        if (SKIP_PROJECT_DIRS.has(entry.name)) continue
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      fileCount += 1
      const ext = path.extname(entry.name).toLowerCase()
      if (ext) extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1)
      if (/^(AGENTS|CLAUDE|README|CONTRIBUTING|ARCHITECTURE)(\.[^.]+)?$/i.test(entry.name)) {
        documents.push({ title: entry.name.replace(/\.[^.]+$/, ''), path: relativePath })
      }
      if (/^(AGENTS\.md|CLAUDE\.md|\.cursorrules|package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/i.test(entry.name)
        || relativePath.startsWith('.codex/')
        || relativePath.startsWith('.claude/')
        || relativePath.startsWith('.cursor/')) {
        detectedConfigs.push(relativePath)
      }
      if (entry.name === 'SKILL.md' && /(^|\/)(skills?|agents?)\//i.test(relativePath.replaceAll('\\', '/'))) {
        const text = await readFile(absolute, 'utf8').catch(() => '')
        const title = text.match(/^name:\s*(.+)$/m)?.[1]?.trim()
          ?? path.basename(path.dirname(absolute))
        const description = text.match(/^description:\s*(.+)$/m)?.[1]?.trim()
          ?? 'Project-local skill'
        skills.push({ name: title, path: relativePath, description })
      }
    }
  }
  await walk(rootPath, 0)

  let description = `Local code project at ${rootPath}`
  try {
    const pkg = JSON.parse(await readFile(path.join(rootPath, 'package.json'), 'utf8')) as { name?: string; description?: string }
    if (pkg.description) description = pkg.description
  } catch {
    // Non-JavaScript projects or malformed package metadata still import.
  }
  const languageByExtension: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
    '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin',
    '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift', '.cs': 'C#', '.cpp': 'C++', '.c': 'C',
  }
  const languages = [...extensionCounts.entries()]
    .filter(([extension]) => languageByExtension[extension])
    .sort((left, right) => right[1] - left[1])
    .map(([extension]) => languageByExtension[extension]!)
    .filter((language, index, all) => all.indexOf(language) === index)
    .slice(0, 6)

  return {
    rootPath,
    name: path.basename(rootPath),
    description,
    detectedConfigs: [...new Set(detectedConfigs)].slice(0, 100),
    documents: documents.slice(0, 100),
    skills: skills.slice(0, 100),
    fileCount,
    languages,
  }
}

function browserUrl(input: string): string {
  const candidate = input.trim()
  const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS pages can be opened')
  return url.toString()
}

function createNativeBrowser(input: string): BrowserWindow {
  const page = browserUrl(input)
  const browser = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: 'OpenSaddle Browser',
    icon: APP_ICON,
    backgroundColor: '#111410',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  browser.webContents.setWindowOpenHandler(({ url }) => {
    try { createNativeBrowser(url) } catch { /* reject non-web popups */ }
    return { action: 'deny' }
  })
  browser.webContents.on('will-navigate', (event, url) => {
    try { browserUrl(url) } catch { event.preventDefault() }
  })
  browser.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  void browser.loadURL(page)
  return browser
}

function embeddedWebContents(): WebContentsView {
  if (embeddedBrowser) return embeddedBrowser
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  view.webContents.setWindowOpenHandler(({ url }) => {
    try { createNativeBrowser(url) } catch { /* reject non-web popups */ }
    return { action: 'deny' }
  })
  view.webContents.on('will-navigate', (event, url) => {
    try { browserUrl(url) } catch { event.preventDefault() }
  })
  view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  mainWindow?.contentView.addChildView(view)
  embeddedBrowser = view
  return view
}

function cliResolutionOptions() {
  return { env: process.env, home: app.getPath('home'), platform: process.platform }
}

async function commandPath(cmd: string): Promise<string | null> {
  return resolveDesktopCli(cmd, cliResolutionOptions())
}

async function discoverClis(): Promise<string[]> {
  const found: string[] = []
  for (const cmd of CLI_CANDIDATES) {
    if (await commandPath(cmd)) found.push(cmd)
  }
  return found
}

async function probeOpenSaddle(url = opensaddleUrl): Promise<SidecarHealth> {
  try {
    const response = await fetch(new URL('/api/health', url), {
      signal: AbortSignal.timeout(800),
    })
    if (!response.ok) return 'incompatible'
    return classifySidecarHealth(await response.json())
  } catch {
    return 'absent'
  }
}

async function opensaddleHealthy(): Promise<boolean> {
  return await probeOpenSaddle() === 'compatible'
}

async function unusedLoopbackUrl(): Promise<string> {
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
      server.close((error) => error
        ? reject(error)
        : resolve(`http://127.0.0.1:${address.port}`))
    })
  })
}

async function waitForOpenSaddle(timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await opensaddleHealthy()) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

interface OpenSaddleLaunch {
  command: string
  args: string[]
  cwd: string
  source: string
}

interface OpenSaddleSidecarOwnership {
  version: 1
  pid: number
  ownerPid: number
  url: string
  stateDir: string
  command: string
  startedAt: string
}

function opensaddleStateDir(): string {
  return process.env.OPENSADDLE_DATA_DIR
    ?? path.join(app.getPath('userData'), 'opensaddle-server')
}

function opensaddleOwnershipPath(): string {
  return path.join(opensaddleStateDir(), 'desktop-sidecar.json')
}

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && Boolean(url.port)
      && url.pathname === '/'
  } catch {
    return false
  }
}

function processIsRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function processCommandLine(pid: number): Promise<string> {
  if (process.platform === 'win32') return ''
  return new Promise((resolve) => {
    const child = spawn('ps', ['-p', String(pid), '-o', 'command='], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let output = ''
    child.stdout?.on('data', (chunk) => { output += String(chunk) })
    child.once('error', () => resolve(''))
    child.once('close', (code) => resolve(code === 0 ? output.trim() : ''))
  })
}

async function readOpenSaddleOwnership(): Promise<OpenSaddleSidecarOwnership | null> {
  try {
    const value = JSON.parse(await readFile(opensaddleOwnershipPath(), 'utf8')) as Partial<OpenSaddleSidecarOwnership>
    if (
      value.version !== 1
      || !Number.isSafeInteger(value.pid)
      || Number(value.pid) <= 1
      || typeof value.ownerPid !== 'number'
      || typeof value.url !== 'string'
      || !isLoopbackHttpUrl(value.url)
      || value.stateDir !== opensaddleStateDir()
      || typeof value.command !== 'string'
      || typeof value.startedAt !== 'string'
    ) return null
    return value as OpenSaddleSidecarOwnership
  } catch {
    return null
  }
}

async function persistOpenSaddleOwnership(
  pid: number,
  command: string,
): Promise<void> {
  const stateDir = opensaddleStateDir()
  mkdirSync(stateDir, { recursive: true })
  const target = opensaddleOwnershipPath()
  const temporary = `${target}.${process.pid}.tmp`
  const record: OpenSaddleSidecarOwnership = {
    version: 1,
    pid,
    ownerPid: process.pid,
    url: opensaddleUrl,
    stateDir,
    command,
    startedAt: new Date().toISOString(),
  }
  await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

async function clearOpenSaddleOwnership(expectedPid?: number): Promise<void> {
  if (expectedPid !== undefined) {
    const record = await readOpenSaddleOwnership()
    if (record && record.pid !== expectedPid) return
  }
  await unlink(opensaddleOwnershipPath()).catch(() => undefined)
}

async function adoptOpenSaddleSidecar(): Promise<boolean> {
  if (opensaddleProc || opensaddleOwnedPid) return true
  const record = await readOpenSaddleOwnership()
  if (!record) return false
  if (!processIsRunning(record.pid)) {
    await clearOpenSaddleOwnership(record.pid)
    return false
  }
  const previousUrl = opensaddleUrl
  if (record.url !== opensaddleUrl) {
    if (opensaddleUrlConfigured) return false
    opensaddleUrl = record.url
  }
  if (process.platform !== 'win32') {
    const commandLine = await processCommandLine(record.pid)
    if (
      !commandLine.includes('opensaddle')
      || !commandLine.includes('serve-api')
      || !commandLine.includes(record.stateDir)
    ) {
      opensaddleUrl = previousUrl
      await clearOpenSaddleOwnership(record.pid)
      return false
    }
  }
  opensaddleOwnedPid = record.pid
  try {
    await persistOpenSaddleOwnership(record.pid, record.command)
  } catch {
    // The live sidecar remains usable even if ownership metadata cannot refresh.
  }
  return true
}

async function resolveOpenSaddleLaunch(): Promise<OpenSaddleLaunch | null> {
  const stateDir = opensaddleStateDir()
  mkdirSync(stateDir, { recursive: true })
  const serverArgs = [
    'serve-api',
    '--host', '127.0.0.1',
    '--port', new URL(opensaddleUrl).port || '8765',
    '--state-dir', stateDir,
  ]
  const configured = process.env.OPENSADDLE_EXECUTABLE
  if (configured && existsSync(configured)) {
    return { command: configured, args: serverArgs, cwd: stateDir, source: 'configured executable' }
  }
  const bundled = process.platform === 'win32'
    ? path.join(process.resourcesPath, 'opensaddle-backend', 'opensaddle.exe')
    : path.join(process.resourcesPath, 'opensaddle-backend', 'opensaddle')
  if (!isDev && existsSync(bundled)) {
    return { command: bundled, args: serverArgs, cwd: stateDir, source: 'bundled backend' }
  }
  const backendRoots = [
    process.env.OPENSADDLE_BACKEND_DIR,
    path.resolve(__dirname, '../../../opensaddle'),
    path.join(app.getPath('documents'), 'CodingProjects', 'opensaddle'),
  ].filter((candidate): candidate is string => !!candidate)
  for (const backendRoot of backendRoots) {
    const virtualEnvCli = process.platform === 'win32'
      ? path.join(backendRoot, '.venv', 'Scripts', 'opensaddle.exe')
      : path.join(backendRoot, '.venv', 'bin', 'opensaddle')
    if (existsSync(virtualEnvCli)) {
      return { command: virtualEnvCli, args: serverArgs, cwd: stateDir, source: backendRoot }
    }
  }
  const installed = await commandPath('opensaddle')
  if (installed) {
    return { command: installed, args: serverArgs, cwd: stateDir, source: 'PATH' }
  }
  const uvCandidates = [
    await commandPath('uv'),
    path.join(app.getPath('home'), '.local', 'bin', 'uv'),
    path.join(app.getPath('home'), '.cargo', 'bin', 'uv'),
    '/opt/homebrew/bin/uv',
    '/usr/local/bin/uv',
  ].filter((candidate, index, all): candidate is string =>
    !!candidate && all.indexOf(candidate) === index && existsSync(candidate))
  const backendRoot = backendRoots.find((candidate) => existsSync(path.join(candidate, 'pyproject.toml')))
  if (backendRoot && uvCandidates[0]) {
    return {
      command: uvCandidates[0],
      args: ['run', '--project', backendRoot, 'opensaddle', ...serverArgs],
      cwd: stateDir,
      source: backendRoot,
    }
  }
  return null
}

async function launchOpenSaddle(): Promise<void> {
  if (opensaddleProc || sidecarsShuttingDown) return
  const launch = await resolveOpenSaddleLaunch()
  if (!launch) {
    opensaddleLaunchError = 'OpenSaddle backend was not found. Install the opensaddle CLI or set OPENSADDLE_EXECUTABLE.'
    return
  }
  opensaddleLaunchError = null
  const krailRuntime = packagedKrailRuntime()
  const launchEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: desktopCliPath(cliResolutionOptions()),
    OPENSADDLE_DESKTOP: '1',
  }
  if (krailRuntime) {
    launchEnv.OPENSADDLE_KRAIL_ADMIN_COMMAND ??= krailRuntime.adminCommand
    launchEnv.OPENSADDLE_KRAIL_MUTATION_COMMAND ??= krailRuntime.mutationCommand
  }
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    stdio: process.env.OPENSADDLE_SIDECAR_STDIO === 'inherit' ? 'inherit' : 'ignore',
    env: launchEnv,
    detached: process.platform !== 'win32',
  })
  opensaddleProc = child
  const childPid = child.pid
  child.once('error', (error) => {
    opensaddleLaunchError = `Could not start ${launch.source}: ${error.message}`
    if (childPid) void clearOpenSaddleOwnership(childPid)
  })
  child.once('exit', (code, signal) => {
    if (opensaddleProc === child) opensaddleProc = null
    if (childPid && opensaddleOwnedPid === childPid) opensaddleOwnedPid = null
    if (childPid && process.platform !== 'win32') {
      try { process.kill(-childPid, 'SIGKILL') } catch { /* no descendant processes remain */ }
    }
    if (childPid) void clearOpenSaddleOwnership(childPid)
    if (code && code !== 0) {
      opensaddleLaunchError = `OpenSaddle backend exited with code ${code}${signal ? ` (${signal})` : ''}.`
    }
    if (sidecarsShuttingDown) return
    opensaddleRestartTimer = setTimeout(() => {
      opensaddleRestartTimer = null
      void ensureOpenSaddle()
    }, 1_500)
  })
  if (childPid) {
    opensaddleOwnedPid = childPid
    try {
      await persistOpenSaddleOwnership(childPid, launch.command)
    } catch (error) {
      opensaddleLaunchError = `Could not persist local server ownership: ${error instanceof Error ? error.message : String(error)}`
    }
    if (child.exitCode !== null) await clearOpenSaddleOwnership(childPid)
  }
}

async function ensureOpenSaddle(): Promise<boolean> {
  if (opensaddleEnsurePromise) return opensaddleEnsurePromise
  const pending = (async () => {
    const adopted = await adoptOpenSaddleSidecar()
    const health = await probeOpenSaddle()
    if (health === 'compatible') return true
    if (adopted && opensaddleOwnedPid) {
      await terminateOwnedSidecar(opensaddleOwnedPid)
      opensaddleOwnedPid = null
      await clearOpenSaddleOwnership()
    } else if (health === 'incompatible') {
      const notice = incompatibleSidecarMessage(opensaddleUrl, opensaddleUrlConfigured)
      if (opensaddleUrlConfigured) {
        opensaddleLaunchError = notice
        return false
      }
      opensaddleCompatibilityNotice = notice
      try {
        opensaddleUrl = await unusedLoopbackUrl()
      } catch (error) {
        opensaddleLaunchError = `Could not select a fallback loopback port: ${error instanceof Error ? error.message : String(error)}`
        return false
      }
    }
    await launchOpenSaddle()
    const healthy = await waitForOpenSaddle()
    if (!healthy && !opensaddleLaunchError) {
      opensaddleLaunchError = `OpenSaddle backend did not become ready at ${opensaddleUrl}.`
    }
    return healthy
  })()
  opensaddleEnsurePromise = pending
  try {
    return await pending
  } finally {
    if (opensaddleEnsurePromise === pending) opensaddleEnsurePromise = null
  }
}

async function startSidecars(): Promise<void> {
  await ensureOpenSaddle()
  opensaddleHealthTimer = setInterval(() => {
    if (!sidecarsShuttingDown) void ensureOpenSaddle()
  }, 3_000)
  if (!isDev) return
  const sessionBridgeEntry = path.resolve(__dirname, '../../packages/session-bridge/src/server.ts')
  if (existsSync(sessionBridgeEntry)) {
    sessionBridgeProc = spawn('npx', ['tsx', sessionBridgeEntry], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'ignore',
      env: {
        ...process.env,
        PATH: desktopCliPath(cliResolutionOptions()),
        SESSION_BRIDGE_PORT: '8787',
      },
    })
  }
}

async function terminateSidecar(child: ChildProcess | null, graceMs = 1_500): Promise<void> {
  if (!child || child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    let finished = false
    let forceTimer: NodeJS.Timeout | null = null
    let settleTimer: NodeJS.Timeout | null = null
    const finish = () => {
      if (finished) return
      finished = true
      if (forceTimer) clearTimeout(forceTimer)
      if (settleTimer) clearTimeout(settleTimer)
      child.off('exit', finish)
      resolve()
    }
    const force = () => {
      if (finished || child.exitCode !== null) {
        finish()
        return
      }
      try { child.kill('SIGKILL') } catch { /* process already exited */ }
      settleTimer = setTimeout(finish, 500)
    }
    child.once('exit', finish)
    forceTimer = setTimeout(force, graceMs)
    try {
      if (!child.kill('SIGTERM')) force()
    } catch {
      force()
    }
    if (child.exitCode !== null) finish()
  })
}

function signalOwnedSidecar(pid: number, signal: NodeJS.Signals): boolean {
  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, signal)
    } else {
      process.kill(pid, signal)
    }
    return true
  } catch {
    try {
      process.kill(pid, signal)
      return true
    } catch {
      return false
    }
  }
}

async function terminateOwnedSidecar(pid: number, graceMs = 1_500): Promise<void> {
  if (!processIsRunning(pid)) return
  signalOwnedSidecar(pid, 'SIGTERM')
  const deadline = Date.now() + graceMs
  while (processIsRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (processIsRunning(pid)) {
    signalOwnedSidecar(pid, 'SIGKILL')
  }
}

async function stopSidecars(): Promise<void> {
  sidecarsShuttingDown = true
  if (opensaddleRestartTimer) clearTimeout(opensaddleRestartTimer)
  opensaddleRestartTimer = null
  if (opensaddleHealthTimer) clearInterval(opensaddleHealthTimer)
  opensaddleHealthTimer = null
  const opensaddle = opensaddleProc
  const ownedPid = opensaddleOwnedPid
  const sessionBridge = sessionBridgeProc
  opensaddleProc = null
  opensaddleOwnedPid = null
  sessionBridgeProc = null
  await Promise.all([
    ownedPid
      ? terminateOwnedSidecar(ownedPid)
      : terminateSidecar(opensaddle),
    terminateSidecar(sessionBridge),
  ])
  if (ownedPid) await clearOpenSaddleOwnership(ownedPid)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    title: 'OpenSaddle Desktop',
    icon: APP_ICON,
    backgroundColor: '#111410',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.on('did-finish-load', () => {
    void mainWindow?.webContents.executeJavaScript('window.opensaddleDesktop = true')
  })

  // Set OPENSADDLE_DEV_SERVER=1 to attach to a running Vite for hot reload.
  // Vite binds [::1] rather than 127.0.0.1, so address it by hostname.
  if (isDev && process.env.OPENSADDLE_DEV_SERVER) {
    void mainWindow.loadURL('http://localhost:5173/opensaddle-interface/')
    return
  }

  void mainWindow.loadURL(`${RENDERER_SCHEME}://bundle/index.html`)
}

app.whenReady().then(async () => {
  app.setName('OpenSaddle')
  if (process.platform === 'darwin') app.dock?.setIcon(APP_ICON)
  registerRendererProtocol()
  await startSidecars()
  ipcMain.on('runtime:opensaddle-url', (event) => {
    event.returnValue = opensaddleUrl
  })
  createWindow()

  ipcMain.handle('runtime:info', async () => {
    const krailRuntime = packagedKrailRuntime()
    const environmentConfigured = Boolean(
      process.env.OPENSADDLE_KRAIL_ADMIN_COMMAND
      || process.env.OPENSADDLE_KRAIL_MUTATION_COMMAND,
    )
    return ({
    mode: 'desktop',
    opensaddleUrl,
    opensaddleConnected: await opensaddleHealthy(),
    opensaddleError: opensaddleLaunchError,
    opensaddleNotice: opensaddleCompatibilityNotice,
    sessionBridgeUrl: SESSION_BRIDGE_URL,
    krailUrl: SESSION_BRIDGE_URL,
    krailRuntime: {
      bundled: Boolean(krailRuntime),
      source: krailRuntime ? 'bundle' : environmentConfigured ? 'environment' : 'path',
      version: krailRuntime?.manifest.wheel.name,
    },
    clis: await discoverClis(),
    })
  })

  ipcMain.handle('runtime:pick-repo', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select repository',
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('runtime:inspect-project', async (_evt, target: string) => inspectLocalProject(target))

  ipcMain.handle('runtime:scan-workspace', async (_evt, folderPath: string) => scanWorkspaceFolder(folderPath))

  ipcMain.handle('runtime:open-path', async (_evt, target: string) => {
    await shell.openPath(target)
  })

  ipcMain.handle('runtime:open-browser', async (_evt, target: string) => {
    const view = embeddedWebContents()
    await view.webContents.loadURL(browserUrl(target))
  })

  ipcMain.handle('runtime:browser-bounds', async (_evt, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!embeddedBrowser || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || bounds.width < 0 || bounds.height < 0) return
    embeddedBrowser.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) })
  })

  ipcMain.handle('runtime:close-browser', async () => {
    if (!embeddedBrowser) return
    mainWindow?.contentView.removeChildView(embeddedBrowser)
    embeddedBrowser.webContents.close()
    embeddedBrowser = null
  })

  ipcMain.handle('runtime:browser-command', async (_evt, command: 'back' | 'forward' | 'reload' | 'zoom-in' | 'zoom-out' | 'zoom-reset') => {
    const contents = embeddedBrowser?.webContents
    if (!contents) return { zoomFactor: 1 }
    if (command === 'back' && contents.canGoBack()) contents.goBack()
    if (command === 'forward' && contents.canGoForward()) contents.goForward()
    if (command === 'reload') contents.reload()
    if (command === 'zoom-reset') contents.setZoomFactor(1)
    if (command === 'zoom-in') contents.setZoomFactor(Math.min(3, contents.getZoomFactor() + 0.1))
    if (command === 'zoom-out') contents.setZoomFactor(Math.max(0.5, contents.getZoomFactor() - 0.1))
    return { zoomFactor: contents.getZoomFactor(), canGoBack: contents.canGoBack(), canGoForward: contents.canGoForward() }
  })

  ipcMain.handle('runtime:browser-find', async (_evt, text: string) => {
    if (!embeddedBrowser || !text.trim()) return null
    return embeddedBrowser.webContents.findInPage(text.trim(), { findNext: true, forward: true })
  })

  ipcMain.handle('runtime:browser-stop-find', async () => embeddedBrowser?.webContents.stopFindInPage('clearSelection'))

  ipcMain.handle('runtime:browser-print', async () => {
    if (!embeddedBrowser) return false
    return new Promise<boolean>((resolve) => embeddedBrowser?.webContents.print({ printBackground: true }, (success) => resolve(success)))
  })

  ipcMain.handle('runtime:browser-screenshot', async () => {
    if (!embeddedBrowser) return false
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save browser screenshot',
      defaultPath: 'opensaddle-browser.png',
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, (await embeddedBrowser.webContents.capturePage()).toPNG())
    return true
  })

  ipcMain.handle('runtime:browser-clear-data', async () => {
    if (!embeddedBrowser) return false
    const session = embeddedBrowser.webContents.session
    await Promise.all([session.clearCache(), session.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] })])
    return true
  })

  app.on('activate', async () => {
    await ensureOpenSaddle()
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitAfterSidecars) return
  event.preventDefault()
  if (!sidecarsStopPromise) {
    sidecarsStopPromise = stopSidecars().finally(() => {
      quitAfterSidecars = true
      app.quit()
    })
  }
})
