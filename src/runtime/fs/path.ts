export function normalizePath(input: string): string {
  const raw = input.replaceAll('\\', '/').trim()
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error(`Path escapes virtual root: ${input}`)
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return `/${parts.join('/')}`
}

export function joinPath(parent: string, child: string): string {
  return normalizePath(`${parent}/${child}`)
}

export function basename(path: string): string {
  const normalized = normalizePath(path)
  return normalized === '/' ? '/' : normalized.slice(normalized.lastIndexOf('/') + 1)
}

export function parentPath(path: string): string {
  const normalized = normalizePath(path)
  if (normalized === '/') return '/'
  const index = normalized.lastIndexOf('/')
  return index <= 0 ? '/' : normalized.slice(0, index)
}

export function isWithin(path: string, scope: string): boolean {
  const candidate = normalizePath(path)
  const root = normalizePath(scope)
  return candidate === root || candidate.startsWith(`${root}/`)
}

export function assertWithin(path: string, scope: string): string {
  const normalized = normalizePath(path)
  if (!isWithin(normalized, scope)) throw new Error(`Path is outside scope ${normalizePath(scope)}: ${path}`)
  return normalized
}
