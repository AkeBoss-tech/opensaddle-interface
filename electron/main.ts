import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let daemonProc: ChildProcess | null = null
let krailProc: ChildProcess | null = null

// These are read only in the privileged main process. They are never exposed as token values.
function validateEndpoint(raw: string): string {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('OpenSaddle daemon endpoint must be a safe loopback URL')
  return url.toString().replace(/\/$/, '')
}
interface DaemonTransport { capabilities(): Promise<unknown>; createRun(request: unknown): Promise<unknown>; getRun(runId: string): Promise<unknown>; cancelRun(runId: string): Promise<unknown>; listEvents(runId: string, afterSequence: number): Promise<unknown> }
function createTransport(endpoint: string, token?: string): DaemonTransport {
  const base = validateEndpoint(endpoint)
  const request = async (path: string, init: RequestInit = {}) => { const response = await fetch(`${base}${path}`, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } }); if (!response.ok) throw new Error(`OpenSaddle daemon HTTP ${response.status}`); return response.json() }
  return { capabilities: () => request('/api/v1/capabilities'), createRun: (body) => request('/api/v1/runs', { method: 'POST', body: JSON.stringify(body) }), getRun: (id) => request(`/api/v1/runs/${encodeURIComponent(id)}`), cancelRun: (id) => request(`/api/v1/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }), listEvents: (id, after) => request(`/api/v1/runs/${encodeURIComponent(id)}/events?after_sequence=${after}`) }
}
const daemonUrl = validateEndpoint(process.env.OPENSADDLE_DAEMON_URL ?? 'http://127.0.0.1:8765')
const daemonToken = process.env.OPENSADDLE_INSTALL_TOKEN
const daemonTransport: DaemonTransport = createTransport(daemonUrl, daemonToken)
const KRAIL_URL = process.env.KRAIL_URL ?? 'http://127.0.0.1:8787'
const CLI_CANDIDATES = ['codex', 'claude', 'agent', 'aider', 'copilot', 'amp', 'agy', 'openclaw', 'hermes', 'pi']

async function which(cmd: string): Promise<boolean> { return new Promise((resolve) => { const child = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd]); child.on('close', (code) => resolve(code === 0)) }) }
async function discoverClis(): Promise<string[]> { const found: string[] = []; for (const cmd of CLI_CANDIDATES) if (await which(cmd)) found.push(cmd); return found }

function startDaemon() {
  const command = process.env.OPENSADDLE_DAEMON_COMMAND
  if (!command) return
  daemonProc = spawn(command, ['daemon', '--host', '127.0.0.1', '--port', new URL(daemonUrl).port || '8765'], { cwd: app.getPath('userData'), stdio: 'ignore', shell: false, env: { ...process.env } })
}
function startKrail() {
  const command = process.env.KRAIL_COMMAND
  if (command) krailProc = spawn(command, [], { cwd: app.getPath('userData'), stdio: 'ignore', shell: false, env: { ...process.env } })
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 960, minWidth: 1100, minHeight: 700, title: 'OpenSaddle Desktop', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  if (isDev) void mainWindow.loadURL('http://127.0.0.1:5173/opensaddle-interface/')
  else void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
}

app.whenReady().then(() => {
  startDaemon(); startKrail(); createWindow()
  ipcMain.handle('daemon:capabilities', () => daemonTransport.capabilities())
  ipcMain.handle('daemon:create-run', (_event, request) => daemonTransport.createRun(request))
  ipcMain.handle('daemon:get-run', (_event, runId: string) => daemonTransport.getRun(runId))
  ipcMain.handle('daemon:cancel-run', (_event, runId: string) => daemonTransport.cancelRun(runId))
  ipcMain.handle('daemon:list-events', (_event, runId: string, afterSequence: number) => daemonTransport.listEvents(runId, afterSequence))
  ipcMain.handle('runtime:info', async () => ({ mode: 'desktop', opensaddleUrl: daemonUrl, krailUrl: KRAIL_URL, clis: await discoverClis() }))
  ipcMain.handle('runtime:pick-repo', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Select repository' }); return result.canceled ? null : result.filePaths[0] ?? null })
  ipcMain.handle('runtime:open-path', async (_event, target: string) => { await shell.openPath(target) })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { daemonProc?.kill(); krailProc?.kill(); if (process.platform !== 'darwin') app.quit() })
