import { app, BrowserWindow, dialog, ipcMain, shell, WebContentsView } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let controlPlaneProc: ChildProcess | null = null
let krailProc: ChildProcess | null = null
let embeddedBrowser: WebContentsView | null = null
let sidecarsShuttingDown = false
let controlPlaneRestartTimer: NodeJS.Timeout | null = null

const OPENSADDLE_URL = process.env.OPENSADDLE_URL ?? 'http://127.0.0.1:8765'
const KRAIL_URL = process.env.KRAIL_URL ?? 'http://127.0.0.1:8787'

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

async function which(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd])
    child.on('close', (code) => resolve(code === 0))
  })
}

async function discoverClis(): Promise<string[]> {
  const found: string[] = []
  for (const cmd of CLI_CANDIDATES) {
    if (await which(cmd)) found.push(cmd)
  }
  return found
}

async function controlPlaneHealthy(): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/health', OPENSADDLE_URL), {
      signal: AbortSignal.timeout(800),
    })
    if (!response.ok) return false
    const payload = await response.json() as { mode?: string }
    return payload.mode === 'local'
  } catch {
    return false
  }
}

async function waitForControlPlane(timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await controlPlaneHealthy()) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

function launchControlPlane(): void {
  if (controlPlaneProc || sidecarsShuttingDown) return
  const env = {
    ...process.env,
    OPENSADDLE_MODE: 'local',
    OPENSADDLE_HOST: '127.0.0.1',
    OPENSADDLE_PORT: '8765',
    OPENSADDLE_RUNTIME_PROVIDER: process.env.OPENSADDLE_RUNTIME_PROVIDER ?? 'local',
    OPENSADDLE_DATA_DIR: process.env.OPENSADDLE_DATA_DIR ?? path.join(app.getPath('userData'), 'control-plane'),
    OPENSADDLE_ALLOWED_REPO_ROOTS: process.env.OPENSADDLE_ALLOWED_REPO_ROOTS ?? app.getPath('home'),
  }
  if (isDev) {
    const controlPlaneEntry = path.resolve(__dirname, '../../packages/control-plane/src/server.ts')
    if (!existsSync(controlPlaneEntry)) return
    controlPlaneProc = spawn('npx', ['tsx', controlPlaneEntry], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'ignore',
      env,
    })
  } else {
    const controlPlaneEntry = path.join(process.resourcesPath, 'control-plane/dist/server.js')
    if (!existsSync(controlPlaneEntry)) return
    controlPlaneProc = spawn(process.execPath, [controlPlaneEntry], {
      cwd: app.getPath('userData'),
      stdio: 'ignore',
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    })
  }
  controlPlaneProc.once('exit', () => {
    controlPlaneProc = null
    if (sidecarsShuttingDown) return
    controlPlaneRestartTimer = setTimeout(() => {
      controlPlaneRestartTimer = null
      void ensureControlPlane()
    }, 1_500)
  })
}

async function ensureControlPlane(): Promise<boolean> {
  if (await controlPlaneHealthy()) return true
  launchControlPlane()
  return waitForControlPlane()
}

async function startSidecars(): Promise<void> {
  await ensureControlPlane()
  if (!isDev) return
  const krailEntry = path.resolve(__dirname, '../../packages/krail/src/server.ts')
  if (existsSync(krailEntry)) {
    krailProc = spawn('npx', ['tsx', krailEntry], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'ignore',
      env: { ...process.env, KRAIL_PORT: '8787' },
    })
  }
}

function stopSidecars(): void {
  sidecarsShuttingDown = true
  if (controlPlaneRestartTimer) clearTimeout(controlPlaneRestartTimer)
  controlPlaneRestartTimer = null
  controlPlaneProc?.kill()
  controlPlaneProc = null
  krailProc?.kill()
  krailProc = null
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

  if (isDev) {
    void mainWindow.loadURL('http://127.0.0.1:5173/opensaddle-interface/')
  } else {
    void mainWindow.loadFile(path.join(process.resourcesPath, 'renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  app.setName('OpenSaddle')
  if (process.platform === 'darwin') app.dock?.setIcon(APP_ICON)
  await startSidecars()
  createWindow()

  ipcMain.handle('runtime:info', async () => ({
    mode: 'desktop',
    opensaddleUrl: OPENSADDLE_URL,
    krailUrl: KRAIL_URL,
    clis: await discoverClis(),
  }))

  ipcMain.handle('runtime:pick-repo', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select repository',
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('runtime:inspect-project', async (_evt, target: string) => inspectLocalProject(target))

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
    await ensureControlPlane()
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopSidecars)
