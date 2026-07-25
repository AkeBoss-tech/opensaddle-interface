import { contextBridge, ipcRenderer } from 'electron'

export interface DesktopDaemonBridge {
  capabilities: () => Promise<unknown>
  createRun: (request: unknown) => Promise<unknown>
  getRun: (runId: string) => Promise<unknown>
  cancelRun: (runId: string) => Promise<unknown>
  listEvents: (runId: string, afterSequence: number) => Promise<unknown>
  getRuntimeInfo: () => Promise<{ mode: string; opensaddleUrl: string; krailUrl: string; clis: string[] }>
  pickRepository: () => Promise<string | null>
  openPath: (path: string) => Promise<void>
}

contextBridge.exposeInMainWorld('opensaddleDesktop', true)
contextBridge.exposeInMainWorld('opensaddle', {
  capabilities: () => ipcRenderer.invoke('daemon:capabilities'),
  createRun: (request: unknown) => ipcRenderer.invoke('daemon:create-run', request),
  getRun: (runId: string) => ipcRenderer.invoke('daemon:get-run', runId),
  cancelRun: (runId: string) => ipcRenderer.invoke('daemon:cancel-run', runId),
  listEvents: (runId: string, afterSequence: number) => ipcRenderer.invoke('daemon:list-events', runId, afterSequence),
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:info'),
  pickRepository: () => ipcRenderer.invoke('runtime:pick-repo'),
  openPath: (target: string) => ipcRenderer.invoke('runtime:open-path', target),
} satisfies DesktopDaemonBridge)
