import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('opensaddleDesktop', true)
contextBridge.exposeInMainWorld('opensaddle', {
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:info') as Promise<{
    mode: string
    opensaddleUrl: string
    krailUrl: string
    clis: string[]
  }>,
  pickRepository: () => ipcRenderer.invoke('runtime:pick-repo') as Promise<string | null>,
  openPath: (path: string) => ipcRenderer.invoke('runtime:open-path', path) as Promise<void>,
})
