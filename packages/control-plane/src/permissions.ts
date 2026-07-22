import type { AuthPrincipal, EffectivePermission, PermissionGrant, ResourceKind } from './types.js'

export interface PermissionInput {
  userId: string
  agentId?: string
  resourceKind: ResourceKind
  resourceId: string
  action: string
  path?: string
}

export function evaluatePermissions(grants: PermissionGrant[], input: PermissionInput): EffectivePermission {
  const now = Date.now()
  const relevant = grants.filter((grant) => {
    const scopeMatches =
      (grant.resourceKind === input.resourceKind && grant.resourceId === input.resourceId)
      || grant.resourceKind === 'organization'
    if (!scopeMatches) return false
    if (grant.action !== input.action && grant.action !== 'administer') return false
    if (grant.expiresAt !== undefined && grant.expiresAt <= now) return false
    if (grant.pathPrefix !== undefined && (input.path === undefined || !input.path.startsWith(grant.pathPrefix))) {
      return false
    }
    return true
  })

  const forPrincipal = (kind: PermissionGrant['principalKind'], id: string) =>
    relevant.filter((grant) => grant.principalKind === kind && grant.principalId === id)

  const userGrants = forPrincipal('user', input.userId)
  const agentGrants = input.agentId ? forPrincipal('agent', input.agentId) : []
  const userDeny = userGrants.find((grant) => grant.effect === 'deny')
  if (userDeny) {
    return {
      allowed: false,
      reason: `Denied for user by grant ${userDeny.id}`,
      matchedGrantIds: [userDeny.id],
      approvalRequired: false,
    }
  }

  const agentDeny = agentGrants.find((grant) => grant.effect === 'deny')
  if (agentDeny) {
    return {
      allowed: false,
      reason: `Denied for agent by grant ${agentDeny.id}`,
      matchedGrantIds: [agentDeny.id],
      approvalRequired: false,
    }
  }

  const userAllow = userGrants.find((grant) => grant.effect === 'allow')
  if (!userAllow) {
    return {
      allowed: false,
      reason: 'No allow grant for initiating user',
      matchedGrantIds: [],
      approvalRequired: false,
    }
  }

  if (input.agentId) {
    const agentAllow = agentGrants.find((grant) => grant.effect === 'allow')
    if (!agentAllow) {
      return {
        allowed: false,
        reason: 'Agent lacks intersecting allow grant',
        matchedGrantIds: [userAllow.id],
        approvalRequired: false,
      }
    }
    return {
      allowed: true,
      reason: 'Allowed by intersection of user and agent grants',
      matchedGrantIds: [userAllow.id, agentAllow.id],
      approvalRequired: Boolean(userAllow.approvalRequired || agentAllow.approvalRequired),
    }
  }

  return {
    allowed: true,
    reason: 'Allowed by user grant',
    matchedGrantIds: [userAllow.id],
    approvalRequired: Boolean(userAllow.approvalRequired),
  }
}

export function requireAdmin(grants: PermissionGrant[], principal: AuthPrincipal): EffectivePermission {
  return evaluatePermissions(grants, {
    userId: principal.userId,
    resourceKind: 'organization',
    resourceId: 'org-default',
    action: 'administer',
  })
}
