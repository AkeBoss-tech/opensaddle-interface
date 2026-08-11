import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('opensaddleDesktop', true)
contextBridge.exposeInMainWorld('opensaddle', {
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:info') as Promise<{
    mode: string
    opensaddleUrl: string
    opensaddleConnected: boolean
    opensaddleError: string | null
    sessionBridgeUrl: string
    /** @deprecated Compatibility alias for sessionBridgeUrl. */
    krailUrl: string
    clis: string[]
  }>,
  pickRepository: () => ipcRenderer.invoke('runtime:pick-repo') as Promise<string | null>,
  inspectProject: (path: string) => ipcRenderer.invoke('runtime:inspect-project', path) as Promise<{
    rootPath: string
    name: string
    description: string
    detectedConfigs: string[]
    documents: Array<{ title: string; path: string }>
    skills: Array<{ name: string; path: string; description: string }>
    fileCount: number
    languages: string[]
  }>,
  openPath: (path: string) => ipcRenderer.invoke('runtime:open-path', path) as Promise<void>,
  openBrowser: (url: string) => ipcRenderer.invoke('runtime:open-browser', url) as Promise<void>,
  setBrowserBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('runtime:browser-bounds', bounds) as Promise<void>,
  closeBrowser: () => ipcRenderer.invoke('runtime:close-browser') as Promise<void>,
  browserCommand: (command: 'back' | 'forward' | 'reload' | 'zoom-in' | 'zoom-out' | 'zoom-reset') => ipcRenderer.invoke('runtime:browser-command', command) as Promise<{ zoomFactor: number; canGoBack?: boolean; canGoForward?: boolean }>,
  findInBrowser: (text: string) => ipcRenderer.invoke('runtime:browser-find', text) as Promise<unknown>,
  stopFindingInBrowser: () => ipcRenderer.invoke('runtime:browser-stop-find') as Promise<void>,
  printBrowser: () => ipcRenderer.invoke('runtime:browser-print') as Promise<boolean>,
  screenshotBrowser: () => ipcRenderer.invoke('runtime:browser-screenshot') as Promise<boolean>,
  clearBrowserData: () => ipcRenderer.invoke('runtime:browser-clear-data') as Promise<boolean>,
})
