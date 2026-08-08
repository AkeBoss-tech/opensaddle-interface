import type { ResourceVersion } from './contracts'

const VERSION_PREFIXES = new Set(['version', 'revision', 'rev'])
const DIGEST_PATTERN = /^[a-z][a-z0-9_-]*:[A-Za-z0-9+/=_-]+$/

/** Parse explicit version syntax without guessing from unqualified identifiers. */
export function parseResourceVersion(value: unknown): ResourceVersion | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined

  const separator = normalized.indexOf(':')
  if (separator < 1 || separator === normalized.length - 1) return undefined
  const prefix = normalized.slice(0, separator).toLowerCase()
  const exactValue = normalized.slice(separator + 1).trim()
  if (!exactValue) return undefined

  if (VERSION_PREFIXES.has(prefix)) return { kind: 'revision', value: exactValue }
  if (prefix === 'etag') return { kind: 'etag', value: exactValue }
  if (prefix === 'timestamp') {
    const timestamp = Date.parse(exactValue)
    return Number.isFinite(timestamp)
      ? { kind: 'timestamp', value: new Date(timestamp).toISOString() }
      : undefined
  }
  if (DIGEST_PATTERN.test(normalized)) {
    return { kind: 'digest', algorithm: prefix, value: exactValue }
  }
  return undefined
}

export function serializeResourceVersion(version: ResourceVersion): string {
  if (version.kind === 'digest') return `${version.algorithm.toLowerCase()}:${version.value}`
  if (version.kind === 'revision') return `revision:${version.value}`
  return `${version.kind}:${version.value}`
}
