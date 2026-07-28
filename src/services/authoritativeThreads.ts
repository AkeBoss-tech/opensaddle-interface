import type { DurableThread, DurableThreadMessage, ThreadClient } from './contracts'

type DomainThread = {
  thread_id: string
  title: string
  version: number
  archived: boolean
  pinned: boolean
  harness?: string | null
  external_thread_id?: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

type DomainMessage = {
  message_id: string
  thread_id: string
  role: DurableThreadMessage['role'] | 'tool'
  content: string
  payload?: Record<string, unknown>
  created_at: string
  updated_at: string
  thread_version?: number
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function threadFromDomain(thread: DomainThread): DurableThread {
  const metadata = thread.metadata ?? {}
  return {
    id: thread.thread_id,
    ownerId: typeof metadata.owner_id === 'string' ? metadata.owner_id : 'local-admin',
    projectId: typeof metadata.project_id === 'string' ? metadata.project_id : 'local',
    title: thread.title,
    visibility: metadata.visibility === 'shared' || metadata.visibility === 'project'
      ? metadata.visibility
      : 'private',
    sharedWith: Array.isArray(metadata.shared_with)
      ? metadata.shared_with.filter((value): value is string => typeof value === 'string')
      : [],
    agentId: typeof metadata.agent_id === 'string' ? metadata.agent_id : undefined,
    runConfig: typeof metadata.run_config === 'object' && metadata.run_config
      ? metadata.run_config as DurableThread['runConfig']
      : undefined,
    continuation: typeof metadata.continuation === 'object' && metadata.continuation
      ? metadata.continuation as DurableThread['continuation']
      : undefined,
    branchedFromId: typeof metadata.branched_from_id === 'string'
      ? metadata.branched_from_id
      : undefined,
    pinned: thread.pinned,
    archivedAt: thread.archived ? timestamp(thread.updated_at) : undefined,
    createdAt: timestamp(thread.created_at),
    updatedAt: timestamp(thread.updated_at),
  }
}

function messageFromDomain(message: DomainMessage): DurableThreadMessage {
  return {
    id: message.message_id,
    threadId: message.thread_id,
    role: message.role === 'tool' ? 'system' : message.role,
    text: message.content,
    payload: message.payload,
    createdAt: timestamp(message.created_at),
    updatedAt: timestamp(message.updated_at || message.created_at),
  }
}

/** Client for the authoritative Python desktop-domain API. */
export class AuthoritativeThreadClient implements ThreadClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string
  private readonly versions = new Map<string, number>()
  private readonly metadata = new Map<string, Record<string, unknown>>()
  private readonly updateTails = new Map<string, Promise<void>>()

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
      headers: { ...this.headers(), ...init?.headers },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(body?.detail ?? `OpenSaddle HTTP ${response.status}`)
    }
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  private remember(thread: DomainThread): DurableThread {
    this.versions.set(thread.thread_id, thread.version)
    this.metadata.set(thread.thread_id, thread.metadata ?? {})
    return threadFromDomain(thread)
  }

  async list(input: Parameters<ThreadClient['list']>[0] = {}) {
    const query = new URLSearchParams()
    if (input.includeArchived) query.set('include_archived', 'true')
    if (input.limit) query.set('limit', String(Math.min(input.limit, 200)))
    if (input.cursor) query.set('cursor', input.cursor)
    const page = await this.request<{ items: DomainThread[]; next_cursor?: string | null }>(
      `/api/threads${query.size ? `?${query}` : ''}`,
    )
    const threads = page.items
      .map((thread) => this.remember(thread))
      .filter((thread) => !input.projectId || thread.projectId === input.projectId)
    return { threads, nextCursor: page.next_cursor ?? undefined }
  }

  async get(threadId: string): Promise<DurableThread> {
    return this.remember(await this.request<DomainThread>(`/api/threads/${encodeURIComponent(threadId)}`))
  }

  async create(input: Parameters<ThreadClient['create']>[0]): Promise<DurableThread> {
    let thread = await this.request<DomainThread>('/api/threads', {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        thread_id: input.id,
        title: input.title ?? '',
        project_id: input.projectId,
        metadata: {
          owner_id: this.getUserId(),
          visibility: input.visibility ?? 'private',
          shared_with: input.sharedWith ?? [],
          agent_id: input.agentId,
          run_config: input.runConfig,
          continuation: input.continuation,
          branched_from_id: input.branchedFromId,
        },
      }),
    })
    this.remember(thread)
    if (input.pinned) {
      thread = await this.request<DomainThread>(`/api/threads/${encodeURIComponent(thread.thread_id)}`, {
        method: 'PATCH',
        headers: this.headers(true),
        body: JSON.stringify({ expected_version: thread.version, pinned: true }),
      })
    }
    return this.remember(thread)
  }

  async update(threadId: string, input: Parameters<ThreadClient['update']>[1]): Promise<DurableThread> {
    const prior = this.updateTails.get(threadId) ?? Promise.resolve()
    const operation = prior.catch(() => undefined).then(
      () => this.updateAuthoritative(threadId, input),
    )
    const tail = operation.then(() => undefined, () => undefined)
    this.updateTails.set(threadId, tail)
    try {
      return await operation
    } finally {
      if (this.updateTails.get(threadId) === tail) this.updateTails.delete(threadId)
    }
  }

  private async updateAuthoritative(
    threadId: string,
    input: Parameters<ThreadClient['update']>[1],
  ): Promise<DurableThread> {
    // Runs can append messages while the renderer is idle—or between our read
    // and patch—advancing the thread version. Rebase one metadata mutation on
    // the latest authoritative thread rather than surfacing a transient 409.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.get(threadId)
      const metadata = {
        ...(this.metadata.get(threadId) ?? {}),
        ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
        ...(input.sharedWith === undefined ? {} : { shared_with: input.sharedWith }),
        ...(input.agentId === undefined ? {} : { agent_id: input.agentId }),
        ...(input.runConfig === undefined ? {} : { run_config: input.runConfig }),
        ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
      }
      try {
        const thread = await this.request<DomainThread>(`/api/threads/${encodeURIComponent(threadId)}`, {
          method: 'PATCH',
          headers: this.headers(true),
          body: JSON.stringify({
            expected_version: this.versions.get(threadId),
            title: input.title,
            pinned: input.pinned,
            archived: input.archived,
            metadata,
          }),
        })
        return this.remember(thread)
      } catch (error) {
        if (attempt === 1 || !(error instanceof Error) || !error.message.includes('invalid thread version')) {
          throw error
        }
      }
    }
    throw new Error('Thread update did not complete')
  }

  async remove(threadId: string): Promise<void> {
    await this.request<void>(`/api/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' })
    this.versions.delete(threadId)
    this.metadata.delete(threadId)
  }

  async messages(threadId: string, input: Parameters<ThreadClient['messages']>[1] = {}) {
    const query = new URLSearchParams()
    if (input.limit) query.set('limit', String(Math.min(input.limit, 200)))
    if (input.cursor) query.set('cursor', input.cursor)
    const page = await this.request<{ items: DomainMessage[]; next_cursor?: string | null }>(
      `/api/threads/${encodeURIComponent(threadId)}/messages${query.size ? `?${query}` : ''}`,
    )
    return {
      messages: page.items.map(messageFromDomain),
      nextCursor: page.next_cursor ?? undefined,
    }
  }

  async appendMessage(threadId: string, input: Parameters<ThreadClient['appendMessage']>[1]) {
    const message = await this.request<DomainMessage>(
      `/api/threads/${encodeURIComponent(threadId)}/messages`,
      {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify({
          message_id: input.id,
          role: input.role,
          content: input.text,
          payload: input.payload ?? {},
        }),
      },
    )
    if (message.thread_version !== undefined) this.versions.set(threadId, message.thread_version)
    return messageFromDomain(message)
  }

  async updateMessage(
    threadId: string,
    messageId: string,
    input: Parameters<ThreadClient['updateMessage']>[2],
  ) {
    const message = await this.request<DomainMessage>(
      `/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: 'PATCH',
        headers: this.headers(true),
        body: JSON.stringify({
          content: input.text,
          payload: input.payload,
        }),
      },
    )
    if (message.thread_version !== undefined) this.versions.set(threadId, message.thread_version)
    return messageFromDomain(message)
  }

  async search(input: Parameters<ThreadClient['search']>[0]) {
    const query = new URLSearchParams({ query: input.q })
    if (input.limit) query.set('limit', String(Math.min(input.limit, 200)))
    const page = await this.request<{
      items: Array<{
        kind: string
        thread_id: string
        item_id: string
        snippet: string
      }>
    }>(`/api/thread-search?${query}`)
    const results = await Promise.all(page.items.map(async (hit) => ({
      thread: await this.get(hit.thread_id),
      messageId: hit.kind === 'message' ? hit.item_id : undefined,
      snippet: hit.snippet,
      matchedIn: (hit.kind === 'message' ? 'message' : 'title') as 'message' | 'title',
    })))
    return input.projectId
      ? results.filter((result) => result.thread.projectId === input.projectId)
      : results
  }
}
