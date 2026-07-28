import type {
  CapabilityAction,
  EffectivePermission,
  PermissionClient,
  PermissionGrant,
  ResourceKind,
} from './contracts'

export class RemotePermissionClient implements PermissionClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string

  constructor(
    baseUrl: string,
    getUserId: () => string,
    token?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getUserId = getUserId
    this.token = token
  }

  private headers(json = false): Record<string, string> {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      'X-OpenSaddle-User': this.getUserId(),
    }
  }

  private async checked<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string; reason?: string; error?: string }
      throw new Error(body.reason ?? body.message ?? body.error ?? `Control plane HTTP ${response.status}`)
    }
    return await response.json() as T
  }

  async list(projectId?: string): Promise<PermissionGrant[]> {
    const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
    return await this.checked<PermissionGrant[]>(await fetch(`${this.baseUrl}/api/permissions${query}`, {
      headers: this.headers(),
    }))
  }

  async upsert(grant: Omit<PermissionGrant, 'id' | 'createdAt'> & { id?: string }): Promise<PermissionGrant> {
    return await this.checked<PermissionGrant>(await fetch(`${this.baseUrl}/api/permissions/grants`, {
      method: 'PUT',
      headers: this.headers(true),
      body: JSON.stringify({
        id: grant.id,
        principal_kind: grant.principalKind,
        principal_id: grant.principalId,
        resource_kind: grant.resourceKind,
        resource_id: grant.resourceId,
        action: grant.action,
        effect: grant.effect,
        approval_required: grant.approvalRequired,
        expires_at: grant.expiresAt,
        path_prefix: grant.pathPrefix,
        scope: grant.scope,
        scope_id: grant.scopeId,
        uses_remaining: grant.usesRemaining,
      }),
    }))
  }

  async consume(grantId: string): Promise<PermissionGrant> {
    return await this.checked<PermissionGrant>(await fetch(
      `${this.baseUrl}/api/permissions/grants/${encodeURIComponent(grantId)}/consume`,
      { method: 'POST', headers: this.headers() },
    ))
  }

  async revoke(grantId: string): Promise<void> {
    await this.checked<{ ok: true }>(await fetch(
      `${this.baseUrl}/api/permissions/grants/${encodeURIComponent(grantId)}`,
      { method: 'DELETE', headers: this.headers() },
    ))
  }

  async check(input: {
    userId: string
    agentId?: string
    resourceKind: ResourceKind
    resourceId: string
    action: CapabilityAction
    path?: string
  }): Promise<EffectivePermission> {
    return await this.checked<EffectivePermission>(await fetch(`${this.baseUrl}/api/permissions/check`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        user_id: input.userId,
        agent_id: input.agentId,
        resource_kind: input.resourceKind,
        resource_id: input.resourceId,
        action: input.action,
        path: input.path,
      }),
    }))
  }
}
