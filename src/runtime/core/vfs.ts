import { normalizeRuntimePath } from './capabilities'
import type { VirtualDirectoryEntry, VirtualFileStat, VirtualFileSystem } from './types'

type Node = { kind: 'file'; data: Uint8Array; updatedAt: number } | { kind: 'directory'; updatedAt: number }

export class MemoryVirtualFileSystem implements VirtualFileSystem {
  private readonly nodes = new Map<string, Node>([['/', { kind: 'directory', updatedAt: Date.now() }]])
  private readonly root: string

  constructor(root = '/') {
    this.root = normalizeRuntimePath(root)
  }

  private path(path: string): string {
    const normalized = normalizeRuntimePath(path)
    const root = this.root
    if (root === '/') return normalized
    if (normalized !== root && !normalized.startsWith(`${root}/`)) throw new Error(`Path outside VFS root: ${path}`)
    return normalized
  }

  async read(path: string): Promise<Uint8Array> {
    const node = this.nodes.get(this.path(path))
    if (!node || node.kind !== 'file') throw new Error(`File not found: ${path}`)
    return node.data.slice()
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const target = this.path(path)
    if (target === '/') throw new Error('Cannot write the VFS root')
    await this.mkdir(parent(target))
    this.nodes.set(target, { kind: 'file', data: data.slice(), updatedAt: Date.now() })
  }

  async list(path = '/'): Promise<VirtualDirectoryEntry[]> {
    const target = this.path(path)
    const node = this.nodes.get(target)
    if (!node || node.kind !== 'directory') throw new Error(`Directory not found: ${path}`)
    const prefix = target === '/' ? '/' : `${target}/`
    const entries: VirtualDirectoryEntry[] = []
    for (const [candidate, child] of this.nodes) {
      if (!candidate.startsWith(prefix) || candidate === target) continue
      const rest = candidate.slice(prefix.length)
      if (!rest || rest.includes('/')) continue
      entries.push({ path: candidate, name: rest, kind: child.kind, size: child.kind === 'file' ? child.data.byteLength : 0, updatedAt: child.updatedAt })
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  }

  async stat(path: string): Promise<VirtualFileStat | null> {
    const target = this.path(path)
    const node = this.nodes.get(target)
    if (!node) return null
    return { path: target, kind: node.kind, size: node.kind === 'file' ? node.data.byteLength : 0, updatedAt: node.updatedAt }
  }

  async mkdir(path: string): Promise<void> {
    const target = this.path(path)
    if (target === '/') return
    const parts = target.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += `/${part}`
      const existing = this.nodes.get(current)
      if (existing?.kind === 'file') throw new Error(`Not a directory: ${current}`)
      if (!existing) this.nodes.set(current, { kind: 'directory', updatedAt: Date.now() })
    }
  }

  async remove(path: string): Promise<void> {
    const target = this.path(path)
    if (target === '/') throw new Error('Cannot remove the VFS root')
    for (const candidate of [...this.nodes.keys()]) {
      if (candidate === target || candidate.startsWith(`${target}/`)) this.nodes.delete(candidate)
    }
  }
}

function parent(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  const normalized = `/${parts.join('/')}`
  return normalized === '/' ? '/' : normalized
}

export function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function decodeText(data: Uint8Array): string {
  return new TextDecoder().decode(data)
}
