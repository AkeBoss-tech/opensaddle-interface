/** Minimal OPFS / File System Access typings used by BrowserFileStore. */
interface FileSystemHandle {
  readonly kind: 'file' | 'directory'
  readonly name: string
}

interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: 'file'
  getFile(): Promise<File>
  createWritable(): Promise<FileSystemWritableFileStream>
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: 'directory'
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | BufferSource | Blob): Promise<void>
  close(): Promise<void>
}

interface StorageManager {
  getDirectory(): Promise<FileSystemDirectoryHandle>
  estimate?(): Promise<{ usage?: number; quota?: number }>
}

interface Navigator {
  readonly storage: StorageManager
}

interface Window {
  opensaddleDesktop?: boolean
  opensaddle?: {
    opensaddleUrl: string
    getRuntimeInfo: () => Promise<{ mode: string; opensaddleUrl: string; opensaddleConnected: boolean; opensaddleError: string | null; opensaddleNotice: string | null; sessionBridgeUrl: string; /** @deprecated */ krailUrl: string; krailRuntime: { bundled: boolean; source: 'bundle' | 'environment' | 'path'; version?: string }; clis: string[] }>
    pickRepository: () => Promise<string | null>
    discoverProjects: () => Promise<import('./types').DiscoveredLocalProject[]>
    listTokenPrices: () => Promise<import('./types').PublicTokenPrice[]>
    discoverSkills: () => Promise<import('./types').DiscoveredAgentSkill[]>
    discoverUiPlugins: () => Promise<import('./types').DiscoveredUiPlugin[]>
    inspectProject: (path: string) => Promise<{
      rootPath: string
      name: string
      description: string
      detectedConfigs: string[]
      documents: Array<{ title: string; path: string }>
      skills: Array<{ name: string; path: string; description: string }>
      fileCount: number
      languages: string[]
    }>
    openPath: (path: string) => Promise<void>
    openApplicationRenderer: (request: {instanceId:string;generation:number;connectionKey:string;packageRef:{package_id:string;version:string;manifest_digest:string};contentDigest:string;fragment:string;projection:{resource:{project_id:string;run_id:string;artifact_id:string;digest:string};text:string;verified_bytes:boolean;fact_verification:'verified'|'not_verified'|'unavailable'};bounds:{x:number;y:number;width:number;height:number}}) => Promise<{identity:string;rendererPid:number}>
    closeApplicationRenderer: (identity:string) => Promise<boolean>
    setApplicationRendererBounds: (identity:string,bounds:{x:number;y:number;width:number;height:number}) => Promise<boolean>
    onApplicationRendererEvent: (listener:(event:{identity:string;instanceId:string;generation:number;kind:'ready'|'state';state?:unknown})=>void) => () => void
    openBrowser: (url: string) => Promise<void>
    setBrowserBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
    closeBrowser: () => Promise<void>
    browserCommand: (command: 'back' | 'forward' | 'reload' | 'zoom-in' | 'zoom-out' | 'zoom-reset') => Promise<{ zoomFactor: number; canGoBack?: boolean; canGoForward?: boolean }>
    findInBrowser: (text: string) => Promise<unknown>
    stopFindingInBrowser: () => Promise<void>
    printBrowser: () => Promise<boolean>
    screenshotBrowser: () => Promise<boolean>
    clearBrowserData: () => Promise<boolean>
    scanWorkspaceFolder?: (folderPath: string) => Promise<import('./types').WorkspaceScanSnapshot>
  }
}
