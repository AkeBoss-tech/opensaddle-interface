import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let opensaddleProc: ChildProcess | null = null
let krailProc: ChildProcess | null = null

const OPENSADDLE_URL = process.env.OPENSADDLE_URL ?? 'http://127.0.0.1:8765'
const KRAIL_URL = process.env.KRAIL_URL ?? 'http://127.0.0.1:8787'

const CLI_CANDIDATES = ['codex', 'claude', 'agent', 'aider', 'copilot', 'amp', 'agy', 'openclaw', 'hermes', 'pi']

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

function startSidecars() {
  const opensaddleRoot = path.resolve(__dirname, '../../../opensaddle')
  if (existsSync(opensaddleRoot)) {
    opensaddleProc = spawn('uv', ['run', 'opensaddle', 'serve-api', '--port', '8765'], {
      cwd: opensaddleRoot,
      stdio: 'ignore',
      detached: false,
    })
  }

  const krailEntry = path.resolve(__dirname, '../../packages/krail/src/server.ts')
  if (existsSync(krailEntry)) {
    krailProc = spawn('npx', ['tsx', krailEntry], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'ignore',
      env: { ...process.env, KRAIL_PORT: '8787' },
    })
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    title: 'OpenSaddle Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
}

app.whenReady().then(() => {
  startSidecars()
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

  ipcMain.handle('runtime:open-path', async (_evt, target: string) => {
    await shell.openPath(target)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  opensaddleProc?.kill()
  krailProc?.kill()
  if (process.platform !== 'darwin') app.quit()
})
