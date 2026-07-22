import type { CapabilityDecision, CapabilityGrant, CapabilityRequest } from './types'

export function normalizeRuntimePath(path: string): string {
  const raw = path.trim().replaceAll('\\', '/')
  if (!raw) return '/'
  const absolute = raw.startsWith('/') ? raw : `/${raw}`
  const parts: string[] = []
  for (const part of absolute.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length) parts.pop()
      continue
    }
    parts.push(part)
  }
  const normalized = `/${parts.join('/')}`
  return normalized === '/' ? '/' : normalized
}

function pathMatches(prefix: string | undefined, target: string | undefined): boolean {
  if (!prefix) return true
  if (!target) return false
  const normalizedPrefix = normalizeRuntimePath(prefix)
  const normalizedTarget = normalizeRuntimePath(target)
  return normalizedTarget === normalizedPrefix || normalizedTarget.startsWith(`${normalizedPrefix}/`)
}

function originMatches(origins: string[] | undefined, target: string | undefined): boolean {
  if (!origins?.length) return true
  if (!target) return false
  try {
    const actual = new URL(target).origin
    return origins.some((origin) => {
      try { return new URL(origin).origin === actual } catch { return origin === actual }
    })
  } catch {
    return false
  }
}

export class CapabilityPolicy {
  private readonly grants: CapabilityGrant[]

  constructor(grants: CapabilityGrant[] = []) {
    this.grants = grants
  }

  evaluate(request: CapabilityRequest): CapabilityDecision {
    const relevant = this.grants.filter((grant) => {
      if (grant.capability !== request.capability && grant.capability !== '*') return false
      if (grant.expiresAt !== undefined && grant.expiresAt <= Date.now()) return false
      if (!pathMatches(grant.pathPrefix, request.pathPrefix)) return false
      if (!request.origins?.every((origin) => originMatches(grant.origins, origin))) return false
      if (grant.maxBytes !== undefined && request.maxBytes !== undefined && request.maxBytes > grant.maxBytes) return false
      return true
    })

    const deny = relevant.find((grant) => grant.effect === 'deny')
    if (deny) return { allowed: false, reason: `Denied by capability grant ${deny.id}`, matchedGrantIds: [deny.id], approvalRequired: false }
    const allow = relevant.filter((grant) => grant.effect === 'allow')
    if (!allow.length) return { allowed: false, reason: `No grant for capability ${request.capability}`, matchedGrantIds: [], approvalRequired: false }
    return {
      allowed: true,
      reason: 'Allowed by capability grant',
      matchedGrantIds: allow.map((grant) => grant.id),
      approvalRequired: allow.some((grant) => grant.approvalRequired === true),
    }
  }
}
