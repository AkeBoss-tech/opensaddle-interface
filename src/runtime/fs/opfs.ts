import { basename, joinPath, normalizePath, parentPath } from './path'
import type { DirectoryEntry, FileStat, VirtualFileSystem, DirectoryHandleLike } from './types'

const textEncoder = new TextEncoder()

export class OpfsVirtualFileSystem implements VirtualFileSystem {
  private readonly root: DirectoryHandleLike

  constructor(root: DirectoryHandleLike) {
    this.root = root
  }

  async read(path: string): Promise<Uint8Array> {
    const handle = await this.resolveFile(path)
    return new Uint8Array(await (await handle.getFile()).arrayBuffer())
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const normalized = normalizePath(path)
    const parent = await this.resolveDirectory(parentPath(normalized), true)
    const handle = await parent.getFileHandle(basename(normalized), { create: true })
    const writable = await handle.createWritable()
    await writable.write(data)
    await writable.close()
  }

  async list(path = '/'): Promise<DirectoryEntry[]> {
    const normalized = normalizePath(path)
    const dir = await this.resolveDirectory(normalized, false)
    const result: DirectoryEntry[] = []
    for await (const [name, handle] of dir.entries()) {
      const full = joinPath(normalized, name)
      if (handle.kind === 'directory') result.push(this.statValue(full, 'directory', 0))
      else result.push(this.statValue(full, 'file', (await handle.getFile()).size))
    }
    return result.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
  }

  async stat(path: string): Promise<FileStat | null> {
    const normalized = normalizePath(path)
    if (normalized === '/') return this.statValue('/', 'directory', 0)
    try {
      const parent = await this.resolveDirectory(parentPath(normalized), false)
      try {
        await parent.getDirectoryHandle(basename(normalized))
        return this.statValue(normalized, 'directory', 0)
      } catch {
        const file = await parent.getFileHandle(basename(normalized))
        return this.statValue(normalized, 'file', (await file.getFile()).size)
      }
    } catch { return null }
  }

  async mkdir(path: string): Promise<void> { await this.resolveDirectory(path, true) }

  async remove(path: string): Promise<void> {
    const normalized = normalizePath(path)
    if (normalized === '/') throw new Error('Cannot remove virtual root')
    await (await this.resolveDirectory(parentPath(normalized), false)).removeEntry(basename(normalized), { recursive: true })
  }

  private async resolveFile(path: string) {
    const normalized = normalizePath(path)
    return (await this.resolveDirectory(parentPath(normalized), false)).getFileHandle(basename(normalized))
  }

  private async resolveDirectory(path: string, create: boolean): Promise<DirectoryHandleLike> {
    let current = this.root
    for (const part of normalizePath(path).split('/').filter(Boolean)) current = await current.getDirectoryHandle(part, { create })
    return current
  }

  private statValue(path: string, kind: 'file' | 'directory', size: number): FileStat {
    return { path, name: basename(path), kind, size, updatedAt: Date.now() }
  }
}

export function opfsRuntimeRoot(name = 'opensaddle-runtime'): Promise<OpfsVirtualFileSystem> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
    return Promise.reject(new Error('OPFS is unavailable in this browser'))
  }
  return navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(name, { create: true })).then((root) => new OpfsVirtualFileSystem(root as unknown as DirectoryHandleLike))
}

export function bytes(text: string): Uint8Array { return textEncoder.encode(text) }
