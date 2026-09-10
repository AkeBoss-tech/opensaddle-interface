import type { ProjectKnowledgeAuthority, ProjectKnowledgeCapture, ProjectKnowledgeContent, ProjectKnowledgeDocument, SourceAvailability } from '../features/projects/ProjectKnowledgePanel'

type Json = Record<string, unknown>
function object(value: unknown): Json { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Project knowledge response is invalid'); return value as Json }
function text(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 2048) throw Error('Project knowledge identity is invalid'); return value }
function digest(value: unknown): string { const result = text(value); if (!/^sha256:[a-f0-9]{64}$/.test(result)) throw Error('Project knowledge digest is invalid'); return result }
function commit(value: unknown): string { const result = text(value); if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result)) throw Error('Project knowledge Git revision is invalid'); return result }
function availability(value: unknown): SourceAvailability {
  const row = object(value)
  if ((row.state !== 'available' && row.state !== 'withdrawn') || !Number.isSafeInteger(row.revision) || (row.revision as number) < 0) throw Error('Project knowledge availability is invalid')
  return { state: row.state, revision: row.revision as number }
}
export class RegisteredProjectKnowledgeClient implements ProjectKnowledgeAuthority {
  private readonly baseUrl: string
  private readonly user: () => string
  private readonly token?: string
  constructor(baseUrl: string, user: () => string, token?: string) { this.baseUrl = baseUrl; this.user = user; this.token = token }
  private route(projectId: string) { return `/api/v2/projects/${encodeURIComponent(projectId)}/retained-evidence` }
  private async request(path: string, body?: unknown) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-OpenSaddle-User': this.user(), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok) throw Error(`Project knowledge unavailable (${response.status}). Refresh to check current access and source state.`)
    return object(await response.json())
  }
  private captureRecord(raw: unknown): ProjectKnowledgeCapture {
    const item = object(raw)
    if (item.state !== 'captured' && item.state !== 'reviewed') throw Error('Project knowledge review state is invalid')
    return { sourceId: text(item.source_id), ...(item.availability === undefined ? {} : { availability: availability(item.availability) }), captureId: text(item.capture_id), path: text(item.path), commit: commit(item.commit), digest: digest(item.content_digest), state: item.state }
  }
  async list(projectId: string) {
    const value = await this.request(this.route(projectId))
    if (value.schema_version !== 'opensaddle.registered-git-evidence-list.v1' || value.project_id !== projectId || typeof value.initialized !== 'boolean' || typeof value.truncated !== 'boolean' || !Array.isArray(value.files) || !Array.isArray(value.captures) || value.files.length > 100 || value.captures.length > 100) throw Error('Project knowledge catalog identity is invalid')
    const revision = commit(object(value.repository).commit)
    const documents = value.files.map(raw => { const row = object(raw); if (row.commit !== revision) throw Error('Project knowledge document revision does not match repository'); return { path: text(row.path), commit: revision } })
    const captures = value.captures.map(raw => this.captureRecord(raw))
    if (new Set(documents.map(item => item.path)).size !== documents.length || new Set(captures.map(item => item.captureId)).size !== captures.length) throw Error('Project knowledge catalog contains duplicate identities')
    return { initialized: value.initialized, truncated: value.truncated, documents, captures }
  }
  setup(projectId: string, intentId: string) { return this.request(`${this.route(projectId)}/setup`, { setup_id: intentId }) }
  capture(projectId: string, document: ProjectKnowledgeDocument, intentId: string) { return this.request(`${this.route(projectId)}/captures`, { commit: document.commit, path: document.path, capture_id: intentId }) }
  async inspect(projectId: string, capture: ProjectKnowledgeCapture): Promise<ProjectKnowledgeContent> {
    if (capture.availability?.state === 'withdrawn') throw Error('Source access is withdrawn; restore access before inspection')
    const value = await this.request(`${this.route(projectId)}/captures/${encodeURIComponent(capture.captureId)}/inspection`)
    const row = this.captureRecord(value)
    if (row.availability?.state === 'withdrawn') throw Error('Source access is withdrawn; retained bytes are unavailable')
    if (value.schema_version !== 'opensaddle.registered-git-evidence-inspection.v1' || value.project_id !== projectId || row.captureId !== capture.captureId || row.path !== capture.path || row.commit !== capture.commit || row.digest !== capture.digest || value.media_type !== 'text/plain' || value.semantic_authority !== (row.state === 'reviewed' ? 'source_document_review' : 'unreviewed_source_document')) throw Error('Project knowledge inspection identity changed; refresh before review')
    if (typeof value.content_base64 !== 'string' || value.content_base64.length > 350000) throw Error('Project knowledge document exceeds the inspection bound')
    const bytes = Uint8Array.from(atob(value.content_base64), character => character.charCodeAt(0))
    if (bytes.byteLength > 262144) throw Error('Project knowledge document exceeds the inspection bound')
    const actual = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
    if (actual !== row.digest) throw Error('Project knowledge retained bytes do not match the selected digest')
    return { ...row, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  }
  async setAvailability(projectId: string, capture: ProjectKnowledgeCapture, state: SourceAvailability['state']): Promise<SourceAvailability> {
    if (!capture.availability || !capture.sourceId || state === capture.availability.state) throw Error('Refresh source availability before changing access')
    const value = await this.request(`${this.route(projectId)}/captures/${encodeURIComponent(capture.captureId)}/availability`, { state, expected_content_digest: capture.digest, expected_revision: capture.availability.revision })
    const result = availability(value)
    if (value.schema_version !== 'opensaddle.registered-git-evidence-availability.v1' || value.project_id !== projectId || value.capture_id !== capture.captureId || value.source_id !== capture.sourceId || value.content_digest !== capture.digest || result.state !== state || result.revision !== capture.availability.revision + 1) throw Error('Source availability response changed identity or version; refresh before retry')
    return result
  }
  review(projectId: string, capture: ProjectKnowledgeContent, intentId: string) { return this.request(`${this.route(projectId)}/captures/${encodeURIComponent(capture.captureId)}/review`, { review_id: intentId, expected_content_digest: capture.digest }) }
}
