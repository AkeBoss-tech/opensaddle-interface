import { basename, joinPath, normalizePath, parentPath, assertWithin } from './path'
import type { DirectoryEntry, DirectoryHandleLike, FileHandleLike, FileMount, MountOptions, VirtualFileSystem } from './types'

export class UserDirectoryMount implements VirtualFileSystem {
  readonly mount: FileMount
  private readonly root: DirectoryHandleLike

  constructor(root: DirectoryHandleLike, options: MountOptions) {
    this.root = root
    const virtualPath = normalizePath(options.virtualPath)
    this.mount = { id: options.id ?? `mount-${Math.random().toString(36).slice(2, 9)}`, virtualPath, access: options.access ?? 'read', kind: 'directory' }
  }

  async requestPermission(): Promise<boolean> {
    const mode = this.mount.access
    const current = await this.root.queryPermission?.({ mode })
    if (current === 'granted') return true
    const result = await this.root.requestPermission?.({ mode })
    return result === 'granted'
  }

  async read(path: string): Promise<Uint8Array> {
    const handle = await this.resolveFile(path)
    return new Uint8Array(await (await handle.getFile()).arrayBuffer())
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.assertWrite()
    const normalized = this.localPath(path)
    const parent = await this.resolveDirectory(parentPath(normalized), true)
    const writable = await (await parent.getFileHandle(basename(normalized), { create: true })).createWritable()
    await writable.write(data)
    await writable.close()
  }

  async list(path = this.mount.virtualPath): Promise<DirectoryEntry[]> {
    const normalized = this.localPath(path)
    const dir = await this.resolveDirectory(normalized, false)
    const entries: DirectoryEntry[] = []
    for await (const [name, handle] of dir.entries()) {
      const full = joinPath(this.mount.virtualPath, joinPath(normalized, name))
      entries.push(handle.kind === 'directory'
        ? { path: full, name, kind: 'directory', size: 0, updatedAt: Date.now() }
        : { path: full, name, kind: 'file', size: (await handle.getFile()).size, updatedAt: Date.now() })
    }
    return entries
  }

  async stat(path: string) {
    try {
      const normalized = this.localPath(path)
      if (normalized === '/') return { path: this.mount.virtualPath, name: this.root.name, kind: 'directory' as const, size: 0, updatedAt: Date.now() }
      const parent = await this.resolveDirectory(parentPath(normalized), false)
      try { await parent.getDirectoryHandle(basename(normalized)); return { path: normalizePath(path), name: basename(path), kind: 'directory' as const, size: 0, updatedAt: Date.now() } }
      catch { const file = await parent.getFileHandle(basename(normalized)); return { path: normalizePath(path), name: basename(path), kind: 'file' as const, size: (await file.getFile()).size, updatedAt: Date.now() } }
    } catch { return null }
  }

  async mkdir(path: string): Promise<void> { this.assertWrite(); await this.resolveDirectory(this.localPath(path), true) }

  async remove(path: string): Promise<void> {
    this.assertWrite()
    const normalized = this.localPath(path)
    if (normalized === '/') throw new Error('Cannot remove mount root')
    await (await this.resolveDirectory(parentPath(normalized), false)).removeEntry(basename(normalized), { recursive: true })
  }

  private localPath(path: string): string {
    const normalized = normalizePath(path)
    return assertWithin(normalized, this.mount.virtualPath).slice(this.mount.virtualPath.length) || '/'
  }

  private assertWrite() { if (this.mount.access !== 'readwrite') throw new Error(`Mount ${this.mount.id} is read-only`) }
  private async resolveFile(path: string): Promise<FileHandleLike> { const normalized = this.localPath(path); return (await this.resolveDirectory(parentPath(normalized), false)).getFileHandle(basename(normalized)) }
  private async resolveDirectory(path: string, create: boolean): Promise<DirectoryHandleLike> { let current = this.root; for (const part of normalizePath(path).split('/').filter(Boolean)) current = await current.getDirectoryHandle(part, { create }); return current }
}
