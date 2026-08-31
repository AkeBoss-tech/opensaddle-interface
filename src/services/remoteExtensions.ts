import type {
  ExtensionCatalogClient,
  ExtensionContribution,
  ProjectExtensionEnablement,
} from './contracts'

export class RemoteExtensionCatalogClient implements ExtensionCatalogClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string

  constructor(baseUrl: string, getUserId: () => string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getUserId = getUserId
    this.token = token
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'X-OpenSaddle-User': this.getUserId(),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(body?.detail ?? `OpenSaddle HTTP ${response.status}`)
    }
    return await response.json() as T
  }

  async projectExtensions(projectId: string) {
    const result = await this.request<{ extensions: Array<{
      project_id: string; package_id: string; version: string; status: 'enabled' | 'disabled'
      revision: number; policy_receipt: Record<string, unknown>
    }> }>(`/api/projects/${encodeURIComponent(projectId)}/extensions`)
    return result.extensions.map((item): ProjectExtensionEnablement => ({
      projectId: item.project_id,
      packageId: item.package_id,
      version: item.version,
      status: item.status,
      revision: item.revision,
      policyReceipt: item.policy_receipt,
    }))
  }

  async contributions(projectId: string, kind?: ExtensionContribution['kind']) {
    const query = kind ? `?kind=${encodeURIComponent(kind)}` : ''
    const result = await this.request<{ contributions: Array<{
      kind: ExtensionContribution['kind']; contribution_id: string; title: string
      description?: string; package_id: string; package_version: string; manifest_digest: string
      effect?: 'read' | 'write'; approval_required?: boolean; surface_kind?: ExtensionContribution['surfaceKind']
      required_capabilities?: string[]; descriptor?: Record<string, unknown>
    }> }>(`/api/projects/${encodeURIComponent(projectId)}/extension-contributions${query}`)
    return result.contributions.map((item): ExtensionContribution => ({
      kind: item.kind,
      contributionId: item.contribution_id,
      title: item.title,
      description: item.description ?? '',
      packageId: item.package_id,
      packageVersion: item.package_version,
      manifestDigest: item.manifest_digest,
      effect: item.effect,
      approvalRequired: item.approval_required,
      surfaceKind: item.surface_kind,
      requiredCapabilities: item.required_capabilities ?? [],
      descriptor: item.descriptor ?? {},
    }))
  }
}
