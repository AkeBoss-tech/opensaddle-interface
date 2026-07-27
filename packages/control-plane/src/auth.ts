import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { ControlPlaneConfig } from './config.js'
import type { AuthPrincipal } from './types.js'

function isLoopback(address: string | undefined): boolean {
  if (!address) return false
  const normalized = address.replace(/^::ffff:/, '')
  return normalized === '127.0.0.1' || normalized === '::1'
}

function secureMatch(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const [scheme, token, extra] = header.trim().split(/\s+/)
  if (scheme?.toLowerCase() !== 'bearer' || !token || extra) return null
  return token
}

export function authenticate(request: FastifyRequest, config: ControlPlaneConfig): AuthPrincipal | null {
  if (config.mode === 'local') {
    if (!isLoopback(request.ip)) return null
    const requestedUser = request.headers['x-opensaddle-user']
    return {
      userId: typeof requestedUser === 'string' && requestedUser.trim()
        ? requestedUser.trim()
        : config.bootstrapAdminId,
      roles: ['local', 'admin'],
      authType: 'local',
    }
  }

  const supplied = bearerToken(request.headers.authorization)
  if (!supplied) return null
  for (const [candidate, identity] of config.apiKeys) {
    if (secureMatch(supplied, candidate)) {
      return { ...identity, authType: 'bearer' }
    }
  }
  return null
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return 'configured endpoint'
  }
}
