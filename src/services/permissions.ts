import type {
  CapabilityAction,
  EffectivePermission,
  PermissionClient,
  PermissionGrant,
  PrincipalKind,
  ResourceKind,
} from './contracts'

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function evaluatePermissions(
  grants: PermissionGrant[],
  input: {
    userId: string
    agentId?: string
    resourceKind: ResourceKind
    resourceId: string
    action: CapabilityAction
    path?: string
  },
): EffectivePermission {
  const relevant = grants.filter((g) => {
    if (g.resourceKind !== input.resourceKind || g.resourceId !== input.resourceId) return false
    if (g.action !== input.action && g.action !== 'administer') return false
    if (g.expiresAt && g.expiresAt < Date.now()) return false
    if (g.pathPrefix && input.path && !input.path.startsWith(g.pathPrefix)) return false
    return true
  })

  const forPrincipal = (kind: PrincipalKind, id: string) =>
    relevant.filter((g) => g.principalKind === kind && g.principalId === id)

  const userGrants = forPrincipal('user', input.userId)
  const agentGrants = input.agentId ? forPrincipal('agent', input.agentId) : []

  const userDeny = userGrants.find((g) => g.effect === 'deny')
  if (userDeny) {
    return {
      allowed: false,
      reason: `Denied for user by grant ${userDeny.id}`,
      matchedGrantIds: [userDeny.id],
      approvalRequired: false,
    }
  }

  if (input.agentId) {
    const agentDeny = agentGrants.find((g) => g.effect === 'deny')
    if (agentDeny) {
      return {
        allowed: false,
        reason: `Denied for agent by grant ${agentDeny.id}`,
        matchedGrantIds: [agentDeny.id],
        approvalRequired: false,
      }
    }
  }

  const userAllow = userGrants.find((g) => g.effect === 'allow')
  if (!userAllow) {
    return {
      allowed: false,
      reason: 'No allow grant for initiating user',
      matchedGrantIds: [],
      approvalRequired: false,
    }
  }

  if (input.agentId) {
    const agentAllow = agentGrants.find((g) => g.effect === 'allow')
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

export class LocalPermissionClient implements PermissionClient {
  private getGrants: () => PermissionGrant[]
  private setGrants: (g: PermissionGrant[]) => void

  constructor(getGrants: () => PermissionGrant[], setGrants: (g: PermissionGrant[]) => void) {
    this.getGrants = getGrants
    this.setGrants = setGrants
  }

  async list(projectId?: string): Promise<PermissionGrant[]> {
    const all = this.getGrants()
    if (!projectId) return all
    return all.filter((g) => g.resourceId === projectId || g.resourceId.startsWith(`${projectId}/`) || g.resourceKind === 'organization')
  }

  async upsert(grant: Omit<PermissionGrant, 'id' | 'createdAt'> & { id?: string }): Promise<PermissionGrant> {
    const all = [...this.getGrants()]
    const next: PermissionGrant = {
      ...grant,
      id: grant.id ?? uid('grant'),
      createdAt: Date.now(),
    }
    const idx = all.findIndex((g) => g.id === next.id)
    if (idx >= 0) all[idx] = next
    else all.push(next)
    this.setGrants(all)
    return next
  }

  async revoke(grantId: string): Promise<void> {
    this.setGrants(this.getGrants().filter((g) => g.id !== grantId))
  }

  async check(input: {
    userId: string
    agentId?: string
    resourceKind: ResourceKind
    resourceId: string
    action: CapabilityAction
    path?: string
  }): Promise<EffectivePermission> {
    return evaluatePermissions(this.getGrants(), input)
  }
}
