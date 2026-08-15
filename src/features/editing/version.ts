import type { EditResourceVersion } from './contracts'

const VERSION_PATTERN = /^(?:version|revision|rev|etag):[^\s]{1,256}$/
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

export function parseEditResourceVersion(version: unknown, digest: unknown): EditResourceVersion | undefined {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return undefined
  if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) return undefined
  return Object.freeze({ version, digest })
}

export function sameEditResourceVersion(left: EditResourceVersion, right: EditResourceVersion): boolean {
  return left.version === right.version && left.digest === right.digest
}
