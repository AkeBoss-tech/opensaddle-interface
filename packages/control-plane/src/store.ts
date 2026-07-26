import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ControlPlaneConfig } from './config.js'
import type {
  ApprovalRecord,
  AuditEvent,
  LocalWorkerRecord,
  PermissionGrant,
  PersistedState,
  ProvisionedRuntime,
  RouteTelemetry,
  RunRecord,
  RuntimeArtifactState,
  RuntimeProjectState,
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
      CREATE TABLE IF NOT EXISTS runtime_projects (
        id TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_artifacts (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        kind TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runtime_artifacts_project_idx
        ON runtime_artifacts(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        actor_id TEXT NOT NULL,
        project_id TEXT,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_events_timestamp_idx ON audit_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_id, timestamp DESC);
      CREATE TABLE IF NOT EXISTS local_workers (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        last_seen_at INTEGER NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS local_workers_owner_idx ON local_workers(owner_id, last_seen_at DESC);
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

  projectStates(): RuntimeProjectState[] {
    return this.rows<RuntimeProjectState>('SELECT data_json FROM runtime_projects ORDER BY updated_at DESC')
  }

  artifactStates(projectId?: string): RuntimeArtifactState[] {
    return projectId
      ? this.rows<RuntimeArtifactState>(
        'SELECT data_json FROM runtime_artifacts WHERE project_id = ? ORDER BY updated_at DESC',
        projectId,
      )
      : this.rows<RuntimeArtifactState>('SELECT data_json FROM runtime_artifacts ORDER BY updated_at DESC')
  }

  auditEvents(limit = 100): AuditEvent[] {
    return this.rows<AuditEvent>('SELECT data_json FROM audit_events ORDER BY timestamp DESC LIMIT ?', String(Math.min(Math.max(limit, 1), 1000)))
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    this.db.prepare(`
      INSERT INTO audit_events (id, timestamp, actor_id, project_id, data_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(event.id, event.timestamp, event.actorId, event.projectId ?? null, JSON.stringify(event))
    this.db.exec(`DELETE FROM audit_events WHERE id NOT IN (
      SELECT id FROM audit_events ORDER BY timestamp DESC LIMIT 10000
    )`)
  }

  workers(): LocalWorkerRecord[] {
    return this.rows<LocalWorkerRecord>('SELECT data_json FROM local_workers ORDER BY last_seen_at DESC LIMIT 500')
  }

  async saveWorker(worker: LocalWorkerRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO local_workers (id, owner_id, last_seen_at, data_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        last_seen_at = excluded.last_seen_at,
        data_json = excluded.data_json
    `).run(worker.id, worker.ownerId, worker.lastSeenAt, JSON.stringify(worker))
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
    const insertProject = this.db.prepare(`
      INSERT INTO runtime_projects (id, updated_at, data_json)
      VALUES (?, ?, ?)
    `)
    const insertArtifact = this.db.prepare(`
      INSERT INTO runtime_artifacts (id, project_id, kind, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?)
    `)

    this.db.exec('BEGIN IMMEDIATE')
    try {
      upsertSnapshot.run('org-default', version, now, updatedBy, JSON.stringify(workspace))
      this.db.prepare('DELETE FROM workspace_documents WHERE workspace_id = ?').run('org-default')
      this.db.exec('DELETE FROM runtime_projects')
      this.db.exec('DELETE FROM runtime_artifacts')
      for (const [collection, value] of Object.entries(workspace)) {
        if (!Array.isArray(value)) continue
        value.forEach((document, index) => {
          if (!document || typeof document !== 'object' || Array.isArray(document)) return
          const record = document as Record<string, unknown>
          const documentId = typeof record.id === 'string' ? record.id : `${collection}-${index}`
          const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : now
          insertDocument.run('org-default', collection, documentId, updatedAt, JSON.stringify(record))
          if (collection === 'projects') {
            insertProject.run(documentId, updatedAt, JSON.stringify({ id: documentId, updatedAt, data: record }))
          } else if (isRuntimeArtifact(collection, record)) {
            insertArtifact.run(
              `${collection}:${documentId}`,
              typeof record.projectId === 'string' ? record.projectId : null,
              collection,
              updatedAt,
              JSON.stringify({
                id: `${collection}:${documentId}`,
                projectId: typeof record.projectId === 'string' ? record.projectId : undefined,
                kind: collection,
                updatedAt,
                data: record,
              }),
            )
          }
        })
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  storageInfo(): { engine: 'sqlite'; path: string } {
    return { engine: 'sqlite', path: this.path }
  }

  private rows<T>(sql: string, ...params: string[]): T[] {
    const rows = this.db.prepare(sql).all(...params) as Array<{ data_json: string }>
    return rows.map((candidate) => JSON.parse(candidate.data_json) as T)
  }

  private row<T>(sql: string, ...params: string[]): T | undefined {
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
}

function isRuntimeArtifact(collection: string, record: Record<string, unknown>): boolean {
  return typeof record.projectId === 'string' && [
    'agents', 'sites', 'apis', 'dashboards', 'interfaces', 'knowledge',
    'sources', 'workflows', 'workflowRuns', 'agentSessions',
  ].includes(collection)
}
