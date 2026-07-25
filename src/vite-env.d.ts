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
    capabilities: () => Promise<unknown>
    createRun: (request: unknown) => Promise<unknown>
    getRun: (runId: string) => Promise<unknown>
    cancelRun: (runId: string) => Promise<unknown>
    listEvents: (runId: string, afterSequence: number) => Promise<unknown>
    getRuntimeInfo: () => Promise<{ mode: string; opensaddleUrl: string; krailUrl: string; clis: string[] }>
    pickRepository: () => Promise<string | null>
    openPath: (path: string) => Promise<void>
  }
}
