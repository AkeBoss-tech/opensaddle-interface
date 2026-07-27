import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ControlPlaneConfig } from './config.js'
import type {
  ApprovalRecord,
  PermissionGrant,
  PersistedState,
  ProvisionedRuntime,
  RouteTelemetry,
  RunRecord,
  ThreadMessageRecord,
  ThreadRecord,
  ThreadSearchResult,
} from './types.js'

const EMPTY_STATE: PersistedState = { grants: [], runs: [], runtimes: [], approvals: [] }

export class StateStore {
  private readonly path: string
  private readonly legacyPath: string
  private readonly db: DatabaseSync

  constructor(private readonly config: ControlPlaneConfig) {
    this.path = resolve(config.dataDir, 'opensaddle.sqlite')
    this.legacyPath = resolve(config.dataDir, 'control-plane.json')
    this.db = new DatabaseSync(this.path)
  }

  async init(): Promise<void> {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS grants (
        id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS grants_principal_idx ON grants(principal_id);
      CREATE INDEX IF NOT EXISTS grants_resource_idx ON grants(resource_id);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_owner_updated_idx ON runs(owner_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS runtimes (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runtimes_owner_idx ON runtimes(owner_id);
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        requested_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS approvals_requester_idx ON approvals(requested_by, created_at DESC);
      CREATE TABLE IF NOT EXISTS workspace_snapshots (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_documents (
        workspace_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        document_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        PRIMARY KEY (workspace_id, collection, document_id)
      );
      CREATE INDEX IF NOT EXISTS workspace_documents_collection_idx
        ON workspace_documents(workspace_id, collection, updated_at DESC);
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        archived_at INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS threads_project_updated_idx
        ON threads(project_id, archived_at, pinned DESC, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS threads_owner_updated_idx
        ON threads(owner_id, updated_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS thread_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        text_value TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS thread_messages_thread_created_idx
        ON thread_messages(thread_id, created_at ASC, id ASC);
      CREATE INDEX IF NOT EXISTS thread_messages_text_idx ON thread_messages(text_value);
      CREATE TABLE IF NOT EXISTS route_telemetry (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        succeeded INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS route_telemetry_project_idx
        ON route_telemetry(project_id, created_at DESC);
    `)
    await this.migrateLegacyJson()
    this.seedThreadsFromWorkspace()

    if (!this.grants().some((grant) => grant.principalId === this.config.bootstrapAdminId)) {
      await this.replaceGrant({
        id: 'bootstrap-admin',
        principalKind: 'user',
        principalId: this.config.bootstrapAdminId,
        resourceKind: 'organization',
        resourceId: 'org-default',
        action: 'administer',
        effect: 'allow',
        createdAt: Date.now(),
        createdBy: 'system',
      })
    }
  }

  grants(): PermissionGrant[] {
    return this.rows<PermissionGrant>('SELECT data_json FROM grants ORDER BY rowid ASC')
  }

  async replaceGrant(grant: PermissionGrant): Promise<void> {
    this.db.prepare(`
      INSERT INTO grants (id, principal_id, resource_id, data_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        principal_id = excluded.principal_id,
        resource_id = excluded.resource_id,
        data_json = excluded.data_json
    `).run(grant.id, grant.principalId, grant.resourceId, JSON.stringify(grant))
  }

  async removeGrant(id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM grants WHERE id = ?').run(id).changes > 0
  }

  runs(): RunRecord[] {
    return this.rows<RunRecord>('SELECT data_json FROM runs ORDER BY updated_at DESC LIMIT 500')
  }

  run(id: string): RunRecord | undefined {
    return this.row<RunRecord>('SELECT data_json FROM runs WHERE id = ?', id)
  }

  async saveRun(run: RunRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO runs (id, owner_id, project_id, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        project_id = excluded.project_id,
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
    `).run(run.id, run.ownerId, run.projectId, run.updatedAt, JSON.stringify(run))
    this.db.exec(`DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY updated_at DESC LIMIT 500)`)
  }

  runtimes(): ProvisionedRuntime[] {
    return this.rows<ProvisionedRuntime>('SELECT data_json FROM runtimes ORDER BY rowid DESC LIMIT 500')
  }

  runtime(id: string): ProvisionedRuntime | undefined {
    return this.row<ProvisionedRuntime>('SELECT data_json FROM runtimes WHERE id = ?', id)
  }

  async saveRuntime(runtime: ProvisionedRuntime): Promise<void> {
    this.db.prepare(`
      INSERT INTO runtimes (id, owner_id, expires_at, data_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        expires_at = excluded.expires_at,
        data_json = excluded.data_json
    `).run(runtime.id, runtime.ownerId, runtime.expiresAt, JSON.stringify(runtime))
    this.db.exec(`DELETE FROM runtimes WHERE id NOT IN (SELECT id FROM runtimes ORDER BY rowid DESC LIMIT 500)`)
  }

  approvals(): ApprovalRecord[] {
    return this.rows<ApprovalRecord>('SELECT data_json FROM approvals ORDER BY created_at DESC LIMIT 1000')
  }

  approval(id: string): ApprovalRecord | undefined {
    return this.row<ApprovalRecord>('SELECT data_json FROM approvals WHERE id = ?', id)
  }

  async saveApproval(approval: ApprovalRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO approvals (id, requested_by, created_at, data_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        requested_by = excluded.requested_by,
        created_at = excluded.created_at,
        data_json = excluded.data_json
    `).run(approval.id, approval.requestedBy, approval.createdAt, JSON.stringify(approval))
    this.db.exec(`DELETE FROM approvals WHERE id NOT IN (SELECT id FROM approvals ORDER BY created_at DESC LIMIT 1000)`)
  }

  routeTelemetry(projectId?: string): RouteTelemetry[] {
    return projectId
      ? this.rows<RouteTelemetry>(
        'SELECT data_json FROM route_telemetry WHERE project_id = ? ORDER BY created_at DESC LIMIT 500',
        projectId,
      )
      : this.rows<RouteTelemetry>('SELECT data_json FROM route_telemetry ORDER BY created_at DESC LIMIT 1000')
  }

  async saveRouteTelemetry(item: RouteTelemetry): Promise<void> {
    this.db.prepare(`
      INSERT INTO route_telemetry (id, project_id, created_at, succeeded, duration_ms, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json
    `).run(item.id, item.projectId, item.createdAt, item.succeeded ? 1 : 0, item.durationMs, JSON.stringify(item))
    this.db.exec(`DELETE FROM route_telemetry WHERE id NOT IN (
      SELECT id FROM route_telemetry ORDER BY created_at DESC LIMIT 5000
    )`)
  }

  workspace(): Record<string, unknown> | undefined {
    return this.row<Record<string, unknown>>(
      'SELECT data_json FROM workspace_snapshots WHERE id = ?',
      'org-default',
    )
  }

  workspaceInfo(): { updatedAt: number; updatedBy: string; documents: number } | undefined {
    const row = this.db.prepare(
      'SELECT updated_at, updated_by FROM workspace_snapshots WHERE id = ?',
    ).get('org-default') as { updated_at: number; updated_by: string } | undefined
    if (!row) return undefined
    const count = this.db.prepare(
      'SELECT COUNT(*) AS count FROM workspace_documents WHERE workspace_id = ?',
    ).get('org-default') as { count: number }
    return { updatedAt: row.updated_at, updatedBy: row.updated_by, documents: count.count }
  }

  async saveWorkspace(workspace: Record<string, unknown>, updatedBy: string): Promise<void> {
    const now = Date.now()
    const version = typeof workspace.version === 'number' ? workspace.version : 1
    const upsertSnapshot = this.db.prepare(`
      INSERT INTO workspace_snapshots (id, version, updated_at, updated_by, data_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by,
        data_json = excluded.data_json
    `)
    const insertDocument = this.db.prepare(`
      INSERT INTO workspace_documents (workspace_id, collection, document_id, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?)
    `)

    this.db.exec('BEGIN IMMEDIATE')
    try {
      upsertSnapshot.run('org-default', version, now, updatedBy, JSON.stringify(workspace))
      this.db.prepare('DELETE FROM workspace_documents WHERE workspace_id = ?').run('org-default')
      for (const [collection, value] of Object.entries(workspace)) {
        if (!Array.isArray(value)) continue
        value.forEach((document, index) => {
          if (!document || typeof document !== 'object' || Array.isArray(document)) return
          const record = document as Record<string, unknown>
          const documentId = typeof record.id === 'string' ? record.id : `${collection}-${index}`
          const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : now
          insertDocument.run('org-default', collection, documentId, updatedAt, JSON.stringify(record))
        })
      }
      this.syncThreadsFromWorkspace(workspace, updatedBy, now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  storageInfo(): { engine: 'sqlite'; path: string } {
    return { engine: 'sqlite', path: this.path }
  }

  threads(options: {
    projectId?: string
    ownerId?: string
    includeArchived?: boolean
    limit?: number
    cursor?: { pinned: boolean; updatedAt: number; id: string }
  } = {}): ThreadRecord[] {
    const where: string[] = []
    const params: Array<string | number> = []
    if (options.projectId) {
      where.push('project_id = ?')
      params.push(options.projectId)
    }
    if (options.ownerId) {
      where.push('owner_id = ?')
      params.push(options.ownerId)
    }
    if (!options.includeArchived) where.push('archived_at IS NULL')
    if (options.cursor) {
      where.push('(pinned < ? OR (pinned = ? AND (updated_at < ? OR (updated_at = ? AND id < ?))))')
      const pinned = options.cursor.pinned ? 1 : 0
      params.push(pinned, pinned, options.cursor.updatedAt, options.cursor.updatedAt, options.cursor.id)
    }
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const sql = `SELECT data_json FROM threads${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT ?`
    return this.rows<ThreadRecord>(sql, ...params, limit)
  }

  thread(id: string): ThreadRecord | undefined {
    return this.row<ThreadRecord>('SELECT data_json FROM threads WHERE id = ?', id)
  }

  async saveThread(thread: ThreadRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO threads (id, owner_id, project_id, title, archived_at, pinned, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        project_id = excluded.project_id,
        title = excluded.title,
        archived_at = excluded.archived_at,
        pinned = excluded.pinned,
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
    `).run(
      thread.id,
      thread.ownerId,
      thread.projectId,
      thread.title,
      thread.archivedAt ?? null,
      thread.pinned ? 1 : 0,
      thread.updatedAt,
      JSON.stringify(thread),
    )
  }

  async removeThread(id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM threads WHERE id = ?').run(id).changes > 0
  }

  messages(threadId: string, options: {
    limit?: number
    cursor?: { createdAt: number; id: string }
  } = {}): ThreadMessageRecord[] {
    const params: Array<string | number> = [threadId]
    let where = 'thread_id = ?'
    if (options.cursor) {
      where += ' AND (created_at > ? OR (created_at = ? AND id > ?))'
      params.push(options.cursor.createdAt, options.cursor.createdAt, options.cursor.id)
    }
    const limit = Math.max(1, Math.min(options.limit ?? 100, 250))
    params.push(limit)
    return this.rows<ThreadMessageRecord>(
      `SELECT data_json FROM thread_messages WHERE ${where} ORDER BY created_at ASC, id ASC LIMIT ?`,
      ...params,
    )
  }

  message(id: string): ThreadMessageRecord | undefined {
    return this.row<ThreadMessageRecord>('SELECT data_json FROM thread_messages WHERE id = ?', id)
  }

  async appendMessage(message: ThreadMessageRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO thread_messages (id, thread_id, created_at, updated_at, text_value, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.threadId,
      message.createdAt,
      message.updatedAt,
      message.text,
      JSON.stringify(message),
    )
  }

  async saveMessage(message: ThreadMessageRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO thread_messages (id, thread_id, created_at, updated_at, text_value, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        thread_id = excluded.thread_id,
        updated_at = excluded.updated_at,
        text_value = excluded.text_value,
        data_json = excluded.data_json
    `).run(
      message.id,
      message.threadId,
      message.createdAt,
      message.updatedAt,
      message.text,
      JSON.stringify(message),
    )
  }

  searchThreads(query: string, options: { projectId?: string; limit?: number } = {}): ThreadSearchResult[] {
    const needle = `%${query.toLowerCase()}%`
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const threadWhere = options.projectId ? 'AND t.project_id = ?' : ''
    const params: Array<string | number> = [needle]
    if (options.projectId) params.push(options.projectId)
    params.push(needle)
    if (options.projectId) params.push(options.projectId)
    params.push(limit)
    const rows = this.db.prepare(`
      SELECT t.data_json AS thread_json, NULL AS message_id, t.title AS snippet, 'title' AS matched_in
      FROM threads t
      WHERE lower(t.title) LIKE ? ${threadWhere}
      UNION ALL
      SELECT t.data_json AS thread_json, m.id AS message_id, m.text_value AS snippet, 'message' AS matched_in
      FROM thread_messages m JOIN threads t ON t.id = m.thread_id
      WHERE lower(m.text_value) LIKE ? ${threadWhere}
      ORDER BY matched_in ASC, snippet ASC
      LIMIT ?
    `).all(...params) as Array<{ thread_json: string; message_id: string | null; snippet: string; matched_in: 'title' | 'message' }>
    return rows.map((row) => ({
      thread: JSON.parse(row.thread_json) as ThreadRecord,
      messageId: row.message_id ?? undefined,
      snippet: row.snippet.slice(0, 320),
      matchedIn: row.matched_in,
    }))
  }

  private rows<T>(sql: string, ...params: Array<string | number>): T[] {
    const rows = this.db.prepare(sql).all(...params) as Array<{ data_json: string }>
    return rows.map((candidate) => JSON.parse(candidate.data_json) as T)
  }

  private row<T>(sql: string, ...params: Array<string | number>): T | undefined {
    const candidate = this.db.prepare(sql).get(...params) as { data_json: string } | undefined
    return candidate ? JSON.parse(candidate.data_json) as T : undefined
  }

  private async migrateLegacyJson(): Promise<void> {
    const migrated = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('legacy_json_migrated')
    if (migrated) return
    let state = structuredClone(EMPTY_STATE)
    try {
      state = JSON.parse(await readFile(this.legacyPath, 'utf8')) as PersistedState
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
      if (!missing) throw error
    }
    for (const grant of state.grants ?? []) await this.replaceGrant(grant)
    for (const run of state.runs ?? []) await this.saveRun(run)
    for (const runtime of state.runtimes ?? []) await this.saveRuntime(runtime)
    for (const approval of state.approvals ?? []) await this.saveApproval(approval)
    this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('legacy_json_migrated', new Date().toISOString())
  }

  private seedThreadsFromWorkspace(): void {
    const workspace = this.workspace()
    if (!workspace) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.syncThreadsFromWorkspace(workspace, 'workspace-migration', Date.now())
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Import legacy snapshot conversations without deleting newer granular data. */
  private syncThreadsFromWorkspace(workspace: Record<string, unknown>, updatedBy: string, now: number): void {
    const chats = Array.isArray(workspace.chats) ? workspace.chats : []
    const messages = Array.isArray(workspace.messages) ? workspace.messages : []
    const upsertThread = this.db.prepare(`
      INSERT INTO threads (id, owner_id, project_id, title, archived_at, pinned, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        project_id = excluded.project_id,
        title = excluded.title,
        archived_at = excluded.archived_at,
        pinned = excluded.pinned,
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
      WHERE excluded.updated_at >= threads.updated_at
    `)
    const insertMessage = this.db.prepare(`
      INSERT OR IGNORE INTO thread_messages (id, thread_id, created_at, updated_at, text_value, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const knownThreadIds = new Set<string>()
    for (const candidate of chats) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      const chat = candidate as Record<string, unknown>
      const id = typeof chat.id === 'string' && chat.id ? chat.id : undefined
      const projectId = typeof chat.projectId === 'string' && chat.projectId ? chat.projectId : undefined
      if (!id || !projectId) continue
      const createdAt = typeof chat.createdAt === 'number' ? chat.createdAt : now
      const updatedAt = typeof chat.updatedAt === 'number' ? chat.updatedAt : Math.max(createdAt, now)
      const visibility = chat.visibility === 'shared' || chat.visibility === 'project' ? chat.visibility : 'private'
      const sharedWith = Array.isArray(chat.sharedWith)
        ? chat.sharedWith.filter((value): value is string => typeof value === 'string').slice(0, 200)
        : []
      const record: ThreadRecord = {
        id,
        ownerId: typeof chat.ownerId === 'string' ? chat.ownerId : typeof workspace.currentUserId === 'string' ? workspace.currentUserId : updatedBy,
        projectId,
        title: typeof chat.title === 'string' && chat.title.trim() ? chat.title.trim().slice(0, 500) : 'Untitled thread',
        visibility,
        sharedWith,
        agentId: typeof chat.agentId === 'string' ? chat.agentId : undefined,
        continuation: legacyThreadContinuation(chat.continuation),
        branchedFromId: typeof chat.branchedFromId === 'string' ? chat.branchedFromId : undefined,
        pinned: chat.pinned === true,
        archivedAt: chat.archived === true ? updatedAt : undefined,
        createdAt,
        updatedAt,
      }
      knownThreadIds.add(id)
      upsertThread.run(record.id, record.ownerId, record.projectId, record.title, record.archivedAt ?? null, record.pinned ? 1 : 0, record.updatedAt, JSON.stringify(record))
    }
    for (const candidate of messages) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      const message = candidate as Record<string, unknown>
      const id = typeof message.id === 'string' && message.id ? message.id : undefined
      const threadId = typeof message.chatId === 'string' && message.chatId ? message.chatId : undefined
      if (!id || !threadId || !knownThreadIds.has(threadId)) continue
      const createdAt = typeof message.createdAt === 'number' ? message.createdAt : now
      const record: ThreadMessageRecord = {
        id,
        threadId,
        role: message.role === 'assistant' || message.role === 'system' ? message.role : 'user',
        text: typeof message.text === 'string' ? message.text.slice(0, 200_000) : '',
        createdAt,
        updatedAt: typeof message.updatedAt === 'number' ? message.updatedAt : createdAt,
        payload: Object.fromEntries(Object.entries(message).filter(([key]) => !['id', 'chatId', 'role', 'text', 'createdAt', 'updatedAt'].includes(key))),
      }
      insertMessage.run(record.id, record.threadId, record.createdAt, record.updatedAt, record.text, JSON.stringify(record))
    }
  }
}

function legacyThreadContinuation(value: unknown): ThreadRecord['continuation'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const provider = input.provider === 'codex'
    || input.provider === 'claude'
    || input.provider === 'cursor'
    || input.provider === 'gemini'
    ? input.provider
    : undefined
  const authority = input.authority === 'source_managed'
    || input.authority === 'opensaddle_managed'
    || input.authority === 'hybrid'
    ? input.authority
    : undefined
  const sessionId = typeof input.sessionId === 'string' && input.sessionId.trim()
    ? input.sessionId.slice(0, 300)
    : undefined
  const sourcePath = typeof input.sourcePath === 'string' && input.sourcePath.trim()
    ? input.sourcePath.slice(0, 2_000)
    : undefined
  return provider && authority && sessionId && sourcePath
    ? { provider, authority, sessionId, sourcePath }
    : undefined
}
