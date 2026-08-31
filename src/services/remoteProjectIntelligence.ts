import type {
  ProjectIntelligenceClient,
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceView,
} from './contracts'

interface SnapshotWire {
  schema_version: ProjectIntelligenceSnapshot['schemaVersion']
  snapshot_id: string
  snapshot_digest: string
  project_id: string
  version: number
  revision: {
    oid: string; tree_oid: string; author_name: string; authored_at: string; subject: string
  }
  summary: {
    file_count: number; total_bytes: number
    languages: Array<{ language: string; file_count: number }>
    components: Array<{ name: string; file_count: number; size_bytes: number }>
  }
  evidence: Array<{
    evidence_id: string; kind: string; locator: string; digest?: string
  }>
  recent_changes: Array<{
    oid: string; author_name: string; authored_at: string; subject: string
  }>
  uncertainties: Array<{
    code: string; severity: 'material' | 'informational'; detail: string
  }>
  created_at: string
}

interface ViewWire {
  snapshot: SnapshotWire
  source_freshness: {
    observed_at: string; current_head_oid: string; snapshot_revision_oid: string
    status: 'fresh' | 'stale' | 'unknown'; working_tree_dirty: boolean
    working_tree_change_count: number
  }
}

function view(value: ViewWire): ProjectIntelligenceView {
  const snapshot = value.snapshot
  return {
    snapshot: {
      schemaVersion: snapshot.schema_version,
      snapshotId: snapshot.snapshot_id,
      snapshotDigest: snapshot.snapshot_digest,
      projectId: snapshot.project_id,
      version: snapshot.version,
      revision: {
        oid: snapshot.revision.oid,
        treeOid: snapshot.revision.tree_oid,
        authorName: snapshot.revision.author_name,
        authoredAt: snapshot.revision.authored_at,
        subject: snapshot.revision.subject,
      },
      summary: {
        fileCount: snapshot.summary.file_count,
        totalBytes: snapshot.summary.total_bytes,
        languages: snapshot.summary.languages.map((item) => ({
          language: item.language, fileCount: item.file_count,
        })),
        pathGroups: snapshot.summary.components.map((item) => ({
          name: item.name, fileCount: item.file_count, sizeBytes: item.size_bytes,
        })),
      },
      evidence: snapshot.evidence.map((item) => ({
        evidenceId: item.evidence_id, kind: item.kind,
        locator: item.locator, digest: item.digest,
      })),
      recentChanges: snapshot.recent_changes.map((item) => ({
        oid: item.oid, authorName: item.author_name,
        authoredAt: item.authored_at, subject: item.subject,
      })),
      uncertainties: snapshot.uncertainties,
      createdAt: snapshot.created_at,
    },
    sourceFreshness: {
      observedAt: value.source_freshness.observed_at,
      currentHeadOid: value.source_freshness.current_head_oid,
      snapshotRevisionOid: value.source_freshness.snapshot_revision_oid,
      status: value.source_freshness.status,
      workingTreeDirty: value.source_freshness.working_tree_dirty,
      workingTreeChangeCount: value.source_freshness.working_tree_change_count,
    },
  }
}

export class RemoteProjectIntelligenceClient implements ProjectIntelligenceClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string

  constructor(baseUrl: string, getUserId: () => string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getUserId = getUserId
    this.token = token
  }

  private path(projectId: string, suffix = '') {
    return `${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/intelligence-snapshots${suffix}`
  }

  private async request(projectId: string, suffix = '', init?: RequestInit) {
    const response = await fetch(this.path(projectId, suffix), {
      ...init,
      headers: {
        'X-OpenSaddle-User': this.getUserId(),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...init?.headers,
      },
    })
    if (response.status === 404 && !init) return null
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(body?.detail ?? `OpenSaddle HTTP ${response.status}`)
    }
    return view(await response.json() as ViewWire)
  }

  latest(projectId: string) {
    return this.request(projectId, '/latest')
  }

  async create(projectId: string, revision = 'HEAD') {
    const result = await this.request(projectId, '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision, sources: ['git'], recent_commit_limit: 25 }),
    })
    if (!result) throw new Error('OpenSaddle returned no intelligence snapshot')
    return result
  }
}
