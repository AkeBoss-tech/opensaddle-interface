import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { ControlPlaneConfig } from './config.js'
import type { AuthPrincipal } from './types.js'

export interface DemoSession {
  token: string
  userId: string
  displayName: string
  expiresAt: number
}

/**
 * Intentionally small local-development session store. Company deployments
 * continue to use configured bearer identities; local accounts get opaque,
 * in-memory tokens instead of trusting a user id supplied by the web UI.
 */
export class DemoSessionManager {
  private readonly sessions = new Map<string, DemoSession>()

  issue(input: { userId: string; displayName: string }): DemoSession {
    const token = crypto.randomUUID()
    const session = { token, userId: input.userId, displayName: input.displayName, expiresAt: Date.now() + 12 * 60 * 60_000 }
    this.sessions.set(token, session)
    return session
  }

  get(token: string | undefined): DemoSession | undefined {
    if (!token) return undefined
    const session = this.sessions.get(token)
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.sessions.delete(token)
      return undefined
    }
    return session
  }

  revoke(token: string | undefined): void {
    if (token) this.sessions.delete(token)
  }
}

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

export function authenticate(request: FastifyRequest, config: ControlPlaneConfig, sessions?: DemoSessionManager): AuthPrincipal | null {
  const sessionToken = request.headers['x-opensaddle-session']
  const session = config.mode === 'local' && typeof sessionToken === 'string' ? sessions?.get(sessionToken) : undefined
  if (session) return { userId: session.userId, displayName: session.displayName, roles: ['local'], authType: 'local' }
  if (config.mode === 'local') {
    if (!isLoopback(request.ip)) return null
    const requestedUser = request.headers['x-opensaddle-user']
    return {
      userId: typeof requestedUser === 'string' && requestedUser.trim()
        ? requestedUser.trim()
        : config.bootstrapAdminId,
      roles: ['local'],
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
