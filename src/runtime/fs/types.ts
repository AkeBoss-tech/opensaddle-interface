export type FileKind = 'file' | 'directory'

export interface FileStat {
  path: string
  name: string
  kind: FileKind
  size: number
  updatedAt: number
}

export interface DirectoryEntry extends FileStat {}

export interface FileEvent {
  type: 'created' | 'updated' | 'deleted'
  path: string
  kind: FileKind
  at: number
}

export interface VirtualFileSystem {
  read(path: string): Promise<Uint8Array>
  write(path: string, data: Uint8Array): Promise<void>
  list(path?: string): Promise<DirectoryEntry[]>
  stat(path: string): Promise<FileStat | null>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
  watch?(path?: string): AsyncIterable<FileEvent>
}

export interface FileMount {
  id: string
  virtualPath: string
  access: 'read' | 'readwrite'
  kind: 'directory'
}

export interface DirectoryHandleLike {
  readonly kind: 'directory'
  readonly name: string
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterableIterator<[string, DirectoryHandleLike | FileHandleLike]>
}

export interface FileHandleLike {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>
}

export interface MountOptions {
  id?: string
  virtualPath: string
  access?: 'read' | 'readwrite'
}
