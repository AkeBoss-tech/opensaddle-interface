import type {
  ToolCallRequest,
  ToolCallResult,
  ToolClient,
  ToolManifest,
} from './contracts'

type Connection = {
  connection_id: string
  provider: string
  display_name: string
  status: string
  metadata?: Record<string, unknown>
}

type IntegrationTool = {
  tool_name: string
  adapter_id: string
  connection_id?: string | null
  description: string
  required_scopes?: string[]
  approval_required: boolean
  enabled: boolean
}

type Invocation = {
  invocation_id: string
  status: 'requested' | 'approved' | 'executing' | 'completed' | 'denied' | 'failed'
  result?: unknown
  error?: string | null
}

/** Truthful adapter for the daemon's durable integration broker. */
export class RemoteIntegrationToolClient implements ToolClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string

  constructor(baseUrl: string, getUserId: () => string, token?: string) {
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

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(Boolean(init?.body)), ...init?.headers },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {
        detail?: string
        error?: string
        message?: string
      } | null
      throw new Error(body?.detail ?? body?.message ?? body?.error ?? `OpenSaddle HTTP ${response.status}`)
    }
    return await response.json() as T
  }

  private async catalog(): Promise<{ connections: Connection[]; tools: IntegrationTool[] }> {
    const [connections, tools] = await Promise.all([
      this.request<{ items?: Connection[] }>('/api/integrations/connections'),
      this.request<{ items?: IntegrationTool[] }>('/api/integrations/tools'),
    ])
    return {
      connections: connections.items ?? [],
      tools: (tools.items ?? []).filter((tool) => tool.enabled),
    }
  }

  async list(): Promise<ToolManifest[]> {
    const { connections, tools } = await this.catalog()
    const connectionById = new Map(connections.map((connection) => [connection.connection_id, connection]))
    const groups = new Map<string, ToolManifest>()
    for (const tool of tools) {
      const connection = tool.connection_id ? connectionById.get(tool.connection_id) : undefined
      const id = connection?.connection_id ?? tool.adapter_id
      const existing = groups.get(id)
      const action = {
        id: tool.tool_name,
        label: tool.description,
        write: tool.approval_required,
      }
      if (existing) {
        existing.actions.push(action)
        existing.scopes = [...new Set([...existing.scopes, ...(tool.required_scopes ?? [])])]
        continue
      }
      groups.set(id, {
        id,
        name: connection?.display_name ?? tool.adapter_id,
        provider: connection?.provider ?? tool.adapter_id,
        description: connection
          ? `${connection.display_name} tools brokered by the local OpenSaddle server.`
          : `Server-registered ${tool.adapter_id} tools.`,
        scopes: tool.required_scopes ?? [],
        actions: [action],
        connected: connection ? connection.status === 'connected' : true,
        accountLabel: connection?.display_name,
      })
    }
    return [...groups.values()]
  }

  async connect(toolId: string): Promise<{ authUrl: string } | { connected: true }> {
    const { connections } = await this.catalog()
    const connection = connections.find((candidate) =>
      candidate.connection_id === toolId || candidate.provider === toolId
    )
    if (connection?.status === 'connected') return { connected: true }
    const authUrl = connection?.metadata?.authorization_url
    if (typeof authUrl === 'string' && authUrl) return { authUrl }
    throw new Error(
      connection
        ? `${connection.display_name} is configured but not connected. Complete its credentials in OpenSaddle settings.`
        : `${toolId} is not configured on this OpenSaddle server.`,
    )
  }

  async disconnect(toolId: string): Promise<void> {
    throw new Error(
      `Disconnect ${toolId} from OpenSaddle settings so credential revocation remains explicit and audited.`,
    )
  }

  async call(request: ToolCallRequest): Promise<ToolCallResult> {
    try {
      const { tools } = await this.catalog()
      const tool = tools.find((candidate) =>
        candidate.tool_name === request.action
        && (candidate.connection_id === request.toolId || candidate.adapter_id === request.toolId)
      )
      if (!tool) return { ok: false, error: `Tool action is not registered: ${request.toolId}/${request.action}` }
      const invocation = await this.request<Invocation>('/api/integrations/invocations', {
        method: 'POST',
        body: JSON.stringify({
          project_id: request.projectId,
          agent_id: request.agentId ?? 'interactive-user',
          tool_name: tool.tool_name,
          arguments: request.args,
          idempotency_key: crypto.randomUUID(),
          requested_by: request.userId || this.getUserId(),
        }),
      })
      if (invocation.status === 'requested') {
        return {
          ok: false,
          requiresApproval: true,
          approvalId: invocation.invocation_id,
          error: 'This server integration requires approval.',
        }
      }
      if (invocation.status === 'completed') return { ok: true, data: invocation.result }
      if (invocation.status !== 'approved') {
        return { ok: false, error: invocation.error ?? `Integration invocation is ${invocation.status}.` }
      }
      const executed = await this.request<Invocation>(
        `/api/integrations/invocations/${encodeURIComponent(invocation.invocation_id)}/execute`,
        { method: 'POST' },
      )
      return executed.status === 'completed'
        ? { ok: true, data: executed.result }
        : { ok: false, error: executed.error ?? `Integration invocation is ${executed.status}.` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async resolveApproval(approvalId: string, allow: boolean): Promise<void> {
    await this.request(
      `/api/integrations/invocations/${encodeURIComponent(approvalId)}/${allow ? 'approve' : 'deny'}`,
      {
        method: 'POST',
        body: JSON.stringify(allow
          ? { decided_by: this.getUserId() }
          : { decided_by: this.getUserId(), reason: 'Denied in OpenSaddle' }),
      },
    )
    if (allow) {
      await this.request(
        `/api/integrations/invocations/${encodeURIComponent(approvalId)}/execute`,
        { method: 'POST' },
      )
    }
  }
}
