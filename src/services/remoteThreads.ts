import type { DurableThread, DurableThreadMessage, ThreadClient } from './contracts'

type ApiThread = {
  id: string
  owner_id: string
  project_id: string
  title: string
  visibility: DurableThread['visibility']
  shared_with?: string[]
  agent_id?: string
  run_config?: DurableThread['runConfig']
  continuation?: DurableThread['continuation']
  branched_from_id?: string
  pinned?: boolean
  archived_at?: number
  created_at: number
  updated_at: number
}

type ApiMessage = {
  id: string
  thread_id: string
  role: DurableThreadMessage['role']
  text: string
  created_at: number
  updated_at: number
  payload?: Record<string, unknown>
}

function threadFromApi(thread: ApiThread): DurableThread {
  return {
    id: thread.id,
    ownerId: thread.owner_id,
    projectId: thread.project_id,
    title: thread.title,
    visibility: thread.visibility,
    sharedWith: thread.shared_with ?? [],
    agentId: thread.agent_id,
    runConfig: thread.run_config,
    continuation: thread.continuation,
    branchedFromId: thread.branched_from_id,
    pinned: thread.pinned === true,
    archivedAt: thread.archived_at,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
  }
}

function messageFromApi(message: ApiMessage): DurableThreadMessage {
  return {
    id: message.id,
    threadId: message.thread_id,
    role: message.role,
    text: message.text,
    createdAt: message.created_at,
    updatedAt: message.updated_at,
    payload: message.payload,
  }
}

/** HTTP client for the granular, SQLite-backed thread API. */
export class RemoteThreadClient implements ThreadClient {
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

  private async error(response: Response): Promise<Error> {
    const body = await response.json().catch(() => null) as { error?: string; message?: string; reason?: string } | null
    return new Error(body?.reason ?? body?.message ?? body?.error ?? `OpenSaddle HTTP ${response.status}`)
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init)
    if (!response.ok) throw await this.error(response)
    return await response.json() as T
  }

  async list(input: Parameters<ThreadClient['list']>[0] = {}) {
    const query = new URLSearchParams()
    if (input.projectId) query.set('project_id', input.projectId)
    if (input.includeArchived) query.set('include_archived', 'true')
    if (input.limit) query.set('limit', String(Math.min(input.limit, 100)))
    if (input.cursor) query.set('cursor', input.cursor)
    const body = await this.request<{ threads: ApiThread[]; next_cursor?: string | null }>(
      `/api/threads${query.size ? `?${query}` : ''}`,
      { headers: this.headers() },
    )
    return { threads: body.threads.map(threadFromApi), nextCursor: body.next_cursor ?? undefined }
  }

  async get(threadId: string): Promise<DurableThread> {
    const body = await this.request<{ thread: ApiThread }>(`/api/threads/${encodeURIComponent(threadId)}`, {
      headers: this.headers(),
    })
    return threadFromApi(body.thread)
  }

  async create(input: Parameters<ThreadClient['create']>[0]): Promise<DurableThread> {
    const body = await this.request<{ thread: ApiThread }>('/api/threads', {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        id: input.id,
        project_id: input.projectId,
        title: input.title,
        visibility: input.visibility,
        shared_with: input.sharedWith,
        agent_id: input.agentId,
        run_config: input.runConfig,
        continuation: input.continuation,
        branched_from_id: input.branchedFromId,
        pinned: input.pinned,
      }),
    })
    return threadFromApi(body.thread)
  }

  async update(threadId: string, input: Parameters<ThreadClient['update']>[1]): Promise<DurableThread> {
    const body = await this.request<{ thread: ApiThread }>(`/api/threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      headers: this.headers(true),
      body: JSON.stringify({
        title: input.title,
        visibility: input.visibility,
        shared_with: input.sharedWith,
        agent_id: input.agentId,
        continuation: input.continuation,
        run_config: input.runConfig,
        pinned: input.pinned,
        archived: input.archived,
      }),
    })
    return threadFromApi(body.thread)
  }

  async remove(threadId: string): Promise<void> {
    await this.request<{ ok: true }>(`/api/threads/${encodeURIComponent(threadId)}`, {
      method: 'DELETE',
      headers: this.headers(),
    })
  }

  async messages(threadId: string, input: Parameters<ThreadClient['messages']>[1] = {}) {
    const query = new URLSearchParams()
    if (input.limit) query.set('limit', String(Math.min(input.limit, 250)))
    if (input.cursor) query.set('cursor', input.cursor)
    const body = await this.request<{ messages: ApiMessage[]; next_cursor?: string | null }>(
      `/api/threads/${encodeURIComponent(threadId)}/messages${query.size ? `?${query}` : ''}`,
      { headers: this.headers() },
    )
    return { messages: body.messages.map(messageFromApi), nextCursor: body.next_cursor ?? undefined }
  }

  async appendMessage(threadId: string, input: Parameters<ThreadClient['appendMessage']>[1]): Promise<DurableThreadMessage> {
    const body = await this.request<{ message: ApiMessage }>(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({ id: input.id, role: input.role, text: input.text, payload: input.payload }),
    })
    return messageFromApi(body.message)
  }

  async updateMessage(
    threadId: string,
    messageId: string,
    input: Parameters<ThreadClient['updateMessage']>[2],
  ): Promise<DurableThreadMessage> {
    const body = await this.request<{ message: ApiMessage }>(
      `/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: this.headers(true),
        body: JSON.stringify(input),
      },
    )
    return messageFromApi(body.message)
  }

  async search(input: Parameters<ThreadClient['search']>[0]) {
    const query = new URLSearchParams({ q: input.q })
    if (input.projectId) query.set('project_id', input.projectId)
    if (input.limit) query.set('limit', String(input.limit))
    const body = await this.request<{
      results: Array<{ thread: ApiThread; message_id?: string; snippet: string; matched_in: 'title' | 'message' }>
    }>(`/api/threads/search?${query}`, { headers: this.headers() })
    return body.results.map((result) => ({
      thread: threadFromApi(result.thread),
      messageId: result.message_id,
      snippet: result.snippet,
      matchedIn: result.matched_in,
    }))
  }
}
