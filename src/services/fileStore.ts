import type { FileEntry, FileStore } from './contracts'

const META_KEY = 'opensaddle-files-meta-v1'
const ROOT = 'opensaddle-workspace'

type MetaMap = Record<string, FileEntry>

function normalize(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '') || ''
}

function parentPath(path: string): string {
  const parts = normalize(path).split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

function loadMeta(): MetaMap {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? '{}') as MetaMap
  } catch {
    return {}
  }
}

function saveMeta(meta: MetaMap) {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(ROOT, { create: true })
}

async function resolveHandle(path: string, createFile = false): Promise<{ dir: FileSystemDirectoryHandle; name: string; kind: 'file' | 'directory' }> {
  const parts = normalize(path).split('/').filter(Boolean)
  const name = parts.pop() ?? ''
  let dir = await getRoot()
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  if (!name) return { dir, name: '', kind: 'directory' }
  try {
    await dir.getDirectoryHandle(name)
    return { dir, name, kind: 'directory' }
  } catch {
    if (createFile) await dir.getFileHandle(name, { create: true })
    return { dir, name, kind: 'file' }
  }
}

export class BrowserFileStore implements FileStore {
  async list(path = ''): Promise<FileEntry[]> {
    const meta = loadMeta()
    const prefix = normalize(path)
    const root = await getRoot()
    let dir = root
    if (prefix) {
      for (const part of prefix.split('/').filter(Boolean)) {
        dir = await dir.getDirectoryHandle(part, { create: true })
      }
    }
    const entries: FileEntry[] = []
    for await (const [name, handle] of dir.entries()) {
      const full = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'directory') {
        const entry: FileEntry = meta[full] ?? {
          path: full,
          name,
          kind: 'directory',
          size: 0,
          updatedAt: Date.now(),
        }
        entries.push(entry)
      } else {
        const file = await (handle as FileSystemFileHandle).getFile()
        const entry: FileEntry = {
          path: full,
          name,
          kind: 'file',
          size: file.size,
          updatedAt: file.lastModified,
          mime: file.type || meta[full]?.mime || 'text/plain',
          projectId: meta[full]?.projectId,
        }
        meta[full] = entry
        entries.push(entry)
      }
    }
    saveMeta(meta)
    return entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1))
  }

  async read(path: string): Promise<string> {
    const { dir, name } = await resolveHandle(path)
    const handle = await dir.getFileHandle(name)
    const file = await handle.getFile()
    return file.text()
  }

  async write(path: string, content: string): Promise<void> {
    const n = normalize(path)
    const parent = parentPath(n)
    if (parent) await this.mkdir(parent)
    const { dir, name } = await resolveHandle(n, true)
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
    const meta = loadMeta()
    meta[n] = {
      path: n,
      name,
      kind: 'file',
      size: content.length,
      updatedAt: Date.now(),
      mime: meta[n]?.mime ?? 'text/plain',
      projectId: meta[n]?.projectId,
    }
    saveMeta(meta)
  }

  async mkdir(path: string): Promise<void> {
    const parts = normalize(path).split('/').filter(Boolean)
    let dir = await getRoot()
    const meta = loadMeta()
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      dir = await dir.getDirectoryHandle(part, { create: true })
      meta[current] = meta[current] ?? {
        path: current,
        name: part,
        kind: 'directory',
        size: 0,
        updatedAt: Date.now(),
      }
    }
    saveMeta(meta)
  }

  async remove(path: string): Promise<void> {
    const n = normalize(path)
    const parent = parentPath(n)
    const name = n.split('/').pop()!
    let dir = await getRoot()
    if (parent) {
      for (const part of parent.split('/').filter(Boolean)) {
        dir = await dir.getDirectoryHandle(part)
      }
    }
    await dir.removeEntry(name, { recursive: true })
    const meta = loadMeta()
    for (const key of Object.keys(meta)) {
      if (key === n || key.startsWith(`${n}/`)) delete meta[key]
    }
    saveMeta(meta)
  }

  async move(from: string, to: string): Promise<void> {
    const content = await this.read(from)
    await this.write(to, content)
    await this.remove(from)
  }

  async stat(path: string): Promise<FileEntry | null> {
    const meta = loadMeta()
    const n = normalize(path)
    if (meta[n]) return meta[n]!
    try {
      const { dir, name, kind } = await resolveHandle(n)
      if (!name) return { path: '', name: ROOT, kind: 'directory', size: 0, updatedAt: Date.now() }
      if (kind === 'directory') return { path: n, name, kind: 'directory', size: 0, updatedAt: Date.now() }
      const file = await (await dir.getFileHandle(name)).getFile()
      return { path: n, name, kind: 'file', size: file.size, updatedAt: file.lastModified }
    } catch {
      return null
    }
  }

  async quota(): Promise<{ used: number; available: number }> {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate()
      return { used: est.usage ?? 0, available: est.quota ?? 0 }
    }
    return { used: 0, available: 0 }
  }

  async importFiles(files: FileList | File[]): Promise<string[]> {
    const list = Array.from(files)
    const paths: string[] = []
    for (const file of list) {
      const path = `imports/${file.name}`
      await this.write(path, await file.text())
      paths.push(path)
    }
    return paths
  }

  async exportFile(path: string): Promise<Blob> {
    const text = await this.read(path)
    return new Blob([text], { type: 'text/plain' })
  }
}

/** Fallback when OPFS is unavailable (e.g. private mode / older Safari). */
export class MemoryFileStore implements FileStore {
  private files = new Map<string, string>()
  private dirs = new Set<string>([''])

  async list(path = ''): Promise<FileEntry[]> {
    const prefix = normalize(path)
    const names = new Map<string, FileEntry>()
    for (const dir of this.dirs) {
      if (!prefix) {
        const top = dir.split('/')[0]
        if (top) names.set(top, { path: top, name: top, kind: 'directory', size: 0, updatedAt: Date.now() })
      } else if (dir.startsWith(`${prefix}/`)) {
        const rest = dir.slice(prefix.length + 1).split('/')[0]
        if (rest) names.set(rest, { path: `${prefix}/${rest}`, name: rest, kind: 'directory', size: 0, updatedAt: Date.now() })
      }
    }
    for (const [p, content] of this.files) {
      const parent = parentPath(p)
      if (parent === prefix) {
        const name = p.split('/').pop()!
        names.set(name, { path: p, name, kind: 'file', size: content.length, updatedAt: Date.now() })
      }
    }
    return [...names.values()]
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(normalize(path))
    if (content === undefined) throw new Error(`File not found: ${path}`)
    return content
  }

  async write(path: string, content: string): Promise<void> {
    const n = normalize(path)
    const parent = parentPath(n)
    if (parent) await this.mkdir(parent)
    this.files.set(n, content)
  }

  async mkdir(path: string): Promise<void> {
    const parts = normalize(path).split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      this.dirs.add(current)
    }
  }

  async remove(path: string): Promise<void> {
    const n = normalize(path)
    this.files.delete(n)
    this.dirs.delete(n)
    for (const key of [...this.files.keys()]) if (key.startsWith(`${n}/`)) this.files.delete(key)
    for (const key of [...this.dirs]) if (key.startsWith(`${n}/`)) this.dirs.delete(key)
  }

  async move(from: string, to: string): Promise<void> {
    const content = await this.read(from)
    await this.write(to, content)
    await this.remove(from)
  }

  async stat(path: string): Promise<FileEntry | null> {
    const n = normalize(path)
    if (this.dirs.has(n)) return { path: n, name: n.split('/').pop() ?? n, kind: 'directory', size: 0, updatedAt: Date.now() }
    const content = this.files.get(n)
    if (content === undefined) return null
    return { path: n, name: n.split('/').pop()!, kind: 'file', size: content.length, updatedAt: Date.now() }
  }
}

export async function createFileStore(): Promise<FileStore> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.getDirectory === 'function') {
      const store = new BrowserFileStore()
      await store.mkdir('projects')
      await store.mkdir('sandbox')
      await store.mkdir('imports')
      const readme = await store.stat('README.md')
      if (!readme) {
        await store.write(
          'README.md',
          '# OpenSaddle browser workspace\n\nFiles here persist in Origin Private File System (OPFS).\n',
        )
      }
      return store
    }
  } catch {
    // fall through
  }
  const mem = new MemoryFileStore()
  await mem.write('README.md', '# OpenSaddle memory workspace\n\nOPFS unavailable; using in-memory fallback.\n')
  return mem
}
