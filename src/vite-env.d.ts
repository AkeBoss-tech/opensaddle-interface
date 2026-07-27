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
    getRuntimeInfo: () => Promise<{ mode: string; opensaddleUrl: string; krailUrl: string; clis: string[] }>
    pickRepository: () => Promise<string | null>
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
    openBrowser: (url: string) => Promise<void>
    setBrowserBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
    closeBrowser: () => Promise<void>
    browserCommand: (command: 'back' | 'forward' | 'reload' | 'zoom-in' | 'zoom-out' | 'zoom-reset') => Promise<{ zoomFactor: number; canGoBack?: boolean; canGoForward?: boolean }>
    findInBrowser: (text: string) => Promise<unknown>
    stopFindingInBrowser: () => Promise<void>
    printBrowser: () => Promise<boolean>
    screenshotBrowser: () => Promise<boolean>
    clearBrowserData: () => Promise<boolean>
  }
}
