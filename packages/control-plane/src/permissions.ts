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
  if (principal.roles.includes('admin')) {
    return {
      allowed: true,
      reason: 'Allowed by authenticated admin role',
      matchedGrantIds: [],
      approvalRequired: false,
    }
  }
  return evaluatePermissions(grants, {
    userId: principal.userId,
    resourceKind: 'organization',
    resourceId: 'org-default',
    action: 'administer',
  })
}

/**
 * A delegating agent may not point at a more privileged agent.  Each active
 * capability granted to the target must also be available to the caller, and
 * a matching deny on the caller wins.  This is deliberately structural rather
 * than rank-based: it remains correct as resource kinds/actions evolve.
 */
export function canDelegateToAgent(grants: PermissionGrant[], callerAgentId: string, targetAgentId: string): EffectivePermission {
  const now = Date.now()
  if (callerAgentId === targetAgentId) return { allowed: true, reason: 'Agent may reference its own threads', matchedGrantIds: [], approvalRequired: false }
  const active = grants.filter((grant) => grant.principalKind === 'agent' && (grant.expiresAt === undefined || grant.expiresAt > now))
  const caller = active.filter((grant) => grant.principalId === callerAgentId)
  const targetAllows = active.filter((grant) => grant.principalId === targetAgentId && grant.effect === 'allow')
  const matched: string[] = []
  for (const target of targetAllows) {
    const matchingCaller = caller.find((grant) => grant.effect === 'allow'
      && grant.resourceKind === target.resourceKind
      && grant.resourceId === target.resourceId
      && (grant.action === target.action || grant.action === 'administer'))
    const callerDeny = caller.find((grant) => grant.effect === 'deny'
      && grant.resourceKind === target.resourceKind
      && grant.resourceId === target.resourceId
      && (grant.action === target.action || grant.action === 'administer'))
    if (!matchingCaller || callerDeny) {
      return { allowed: false, reason: `Target agent has capability ${target.resourceKind}:${target.resourceId}:${target.action} beyond caller`, matchedGrantIds: callerDeny ? [callerDeny.id, target.id] : [target.id], approvalRequired: false }
    }
    matched.push(matchingCaller.id, target.id)
  }
  return { allowed: true, reason: 'Target agent has equal or lesser active permissions', matchedGrantIds: [...new Set(matched)], approvalRequired: false }
}
