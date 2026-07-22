import { basename, isWithin, joinPath, normalizePath, parentPath } from './path'
import type { DirectoryEntry, FileEvent, FileStat, VirtualFileSystem } from './types'

function clone(data: Uint8Array): Uint8Array {
  return new Uint8Array(data)
}

export class MemoryVirtualFileSystem implements VirtualFileSystem {
  private readonly files = new Map<string, Uint8Array>()
  private readonly dirs = new Set<string>(['/'])
  private readonly listeners = new Set<(event: FileEvent) => void>()

  async read(path: string): Promise<Uint8Array> {
    const normalized = normalizePath(path)
    const data = this.files.get(normalized)
    if (!data) throw new Error(`File not found: ${normalized}`)
    return clone(data)
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const normalized = normalizePath(path)
    await this.mkdir(parentPath(normalized))
    const type = this.files.has(normalized) ? 'updated' : 'created'
    this.files.set(normalized, clone(data))
    this.emit({ type, path: normalized, kind: 'file', at: Date.now() })
  }

  async list(path = '/'): Promise<DirectoryEntry[]> {
    const prefix = normalizePath(path)
    if (!this.dirs.has(prefix)) throw new Error(`Directory not found: ${prefix}`)
    const entries = new Map<string, DirectoryEntry>()
    for (const dir of this.dirs) {
      if (dir === prefix || !isWithin(dir, prefix)) continue
      const child = joinPath(prefix, dir.slice(prefix.length + 1).split('/')[0] ?? '')
      entries.set(child, this.statValue(child, 'directory', 0))
    }
    for (const [file, data] of this.files) {
      if (!isWithin(file, prefix)) continue
      const child = joinPath(prefix, file.slice(prefix.length + 1).split('/')[0] ?? '')
      if (child === file) entries.set(child, this.statValue(child, 'file', data.byteLength))
    }
    return [...entries.values()].sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1)
  }

  async stat(path: string): Promise<FileStat | null> {
    const normalized = normalizePath(path)
    if (this.dirs.has(normalized)) return this.statValue(normalized, 'directory', 0)
    const data = this.files.get(normalized)
    return data ? this.statValue(normalized, 'file', data.byteLength) : null
  }

  async mkdir(path: string): Promise<void> {
    const normalized = normalizePath(path)
    const parts = normalized.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += `/${part}`
      this.dirs.add(current)
    }
  }

  async remove(path: string): Promise<void> {
    const normalized = normalizePath(path)
    if (normalized === '/') throw new Error('Cannot remove virtual root')
    const stat = await this.stat(normalized)
    if (!stat) return
    for (const file of [...this.files.keys()]) if (file === normalized || isWithin(file, normalized)) this.files.delete(file)
    for (const dir of [...this.dirs]) if (dir === normalized || isWithin(dir, normalized)) this.dirs.delete(dir)
    this.emit({ type: 'deleted', path: normalized, kind: stat.kind, at: Date.now() })
  }

  watch(path = '/') : AsyncIterable<FileEvent> {
    const scope = normalizePath(path)
    const queue: FileEvent[] = []
    let wake: (() => void) | undefined
    const listener = (event: FileEvent) => {
      if (isWithin(event.path, scope)) { queue.push(event); wake?.(); wake = undefined }
    }
    this.listeners.add(listener)
    const self = this
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<FileEvent>> {
            while (!queue.length) await new Promise<void>((resolve) => { wake = resolve })
            return { done: false, value: queue.shift()! }
          },
          async return(): Promise<IteratorResult<FileEvent>> {
            self.listeners.delete(listener)
            return { done: true, value: undefined as never }
          },
        }
      },
    }
  }

  private emit(event: FileEvent) { this.listeners.forEach((listener) => listener(event)) }
  private statValue(path: string, kind: 'file' | 'directory', size: number): FileStat {
    return { path, name: basename(path), kind, size, updatedAt: Date.now() }
  }
}
