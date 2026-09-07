import { RemoteMalleableShellClient } from './remoteMalleableShell'

type Json = Record<string, unknown>

export class RemoteJourneyClient {
  private readonly baseUrl: string
  private readonly user: () => string
  private readonly token?: string
  constructor(baseUrl: string, user: () => string, token?: string) { this.baseUrl = baseUrl; this.user = user; this.token = token }

  private async request(path: string, method: string, body?: unknown): Promise<Json> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-OpenSaddle-User': this.user(), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!response.ok) { const value = await response.json().catch(() => null) as { detail?: unknown } | null; throw Error(typeof value?.detail === 'string' ? value.detail : `Connected journey request failed (${response.status})`) }
    return await response.json() as Json
  }

  createProject(projectId: string) { return this.request('/api/v2/projects', 'POST', { project_id: projectId }) }
  invitations(projectId: string) { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/invitations`, 'GET') }
  async invite(projectId: string, subject: string) { await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/invitations`, 'POST', { recipient_subject: subject, role: 'member', ttl_seconds: 3600 }) }
  addMember(projectId: string, subject: string, role: 'admin' | 'member' | 'requester' | 'approver' | 'auditor') { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/members`, 'PUT', { subject, role }) }
  acceptInvitation(projectId: string, id: string, expectedRevision: number) { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(id)}/accept`, 'POST', { expected_revision: expectedRevision }) }
  revokeInvitation(projectId: string, id: string, expectedRevision: number) { return this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/invitations/${encodeURIComponent(id)}/revoke`, 'POST', { expected_revision: expectedRevision }) }
  async enroll(projectId: string, workerId: string) { await this.registerWorker({ workerId, organizationId: projectId, projectIds: [projectId], runtimeKind: 'remote_worker' }) }
  registerWorker(input: { workerId: string; organizationId: string; projectIds: string[]; runtimeKind: 'remote_worker' | 'aws_firecracker' | 'gcp_microvm' | 'azure_microvm' }) { return this.request('/api/v2/workers', 'POST', { worker_id: input.workerId, organization_id: input.organizationId, project_ids: input.projectIds, runtime_kind: input.runtimeKind }) }
  createRun(input: { projectId: string; sourceId: string; task: string }) { return this.request('/api/v2/runs', 'POST', { project_id: input.projectId, source_id: input.sourceId, task: input.task }) }
  delegate(projectId: string, sourceId: string, task: string) { return this.createRun({ projectId, sourceId, task }) }
  run(runId: string) { return this.request(`/api/v2/runs/${encodeURIComponent(runId)}`, 'GET') }
  cancel(runId: string) { return this.request(`/api/v2/runs/${encodeURIComponent(runId)}/cancel`, 'POST', {}) }

  async snapshot(projectId: string) {
    const invitations = await this.invitations(projectId)
    if (invitations.project_id !== projectId) throw Error('Connected journey Project identity mismatch')
    const mappedInvitations = (Array.isArray(invitations.invitations) ? invitations.invitations : []).map(value => { const item = value as Json; return { invitationId: String(item.invitation_id), recipientSubject: String(item.recipient_subject), status: String(item.status), revision: Number(item.revision), expiresAt: String(item.expires_at) } })
    let members: Json, workers: Json, center: Json
    try { [members, workers, center] = await Promise.all([this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/members`, 'GET'), this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/workers`, 'GET'), this.request('/api/v2/command-center', 'GET')]) }
    catch (reason) { if (mappedInvitations.some(item => item.status === 'pending')) return { projectId, members: [], workers: [], invitations: mappedInvitations, rosterAvailable: false, canManage: false, currentSubject: this.user() }; throw reason }
    if (members.project_id !== projectId || workers.project_id !== projectId) throw Error('Connected journey Project identity mismatch')
    let participantDiscoveryAvailable = true, sourceDiscoveryAvailable = true
    const [participantList, sourceList] = await Promise.all([
      this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/participants?limit=100`, 'GET').catch(() => { participantDiscoveryAvailable = false; return { items: [] } }),
      this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/sources?limit=100`, 'GET').catch(() => { sourceDiscoveryAvailable = false; return { items: [] } }),
    ])
    if ((participantDiscoveryAvailable && (!('project_id' in participantList) || participantList.project_id !== projectId)) || (sourceDiscoveryAvailable && (!('project_id' in sourceList) || sourceList.project_id !== projectId))) throw Error('Connected journey discovery Project identity mismatch')
    const memberItems = Array.isArray(members.members) ? members.members : []
    return {
      projectId,
      members: memberItems.map(value => { const item = value as Json; return { subject: String(item.subject), role: String(item.role), status: String(item.status) } }),
      workers: (Array.isArray(workers.workers) ? workers.workers : []).map(value => { const item = value as Json; return { workerId: String(item.worker_id), runtimeKind: String(item.runtime_kind), status: String(item.status) } }),
      invitations: mappedInvitations,
      participantDiscoveryAvailable,
      participants: (Array.isArray(participantList.items) ? participantList.items : []).map(value => { const item = value as Json; return { participantId: String(item.participant_id), title: String(item.title), lifecycle: String(item.lifecycle) } }),
      sourceDiscoveryAvailable,
      sources: (Array.isArray(sourceList.items) ? sourceList.items : []).map(value => { const item = value as Json; return { sourceId: String(item.source_id), label: String(item.display_label) } }),
      activeRuns: (Array.isArray(center.active_runs) ? center.active_runs : []).flatMap(value => { const item = value as Json; return item.project_id === projectId && typeof item.run_id === 'string' ? [{ runId: item.run_id, task: String(item.task ?? 'Run'), status: String(item.status) }] : [] }),
      results: (Array.isArray(center.outcomes) ? center.outcomes : []).flatMap(value => { const item = value as Json; return item.project_id === projectId && typeof item.run_id === 'string' ? [{ runId: item.run_id, title: String(item.title), verified: item.verified === true }] : [] }),
      rosterAvailable: true,
      currentSubject: this.user(),
      canManage: memberItems.some(value => { const item = value as Json; return item.subject === this.user() && (item.role === 'owner' || item.role === 'admin') }),
    }
  }

  async review(projectId: string, runId: string) {
    const run = await this.run(runId); if (run.project_id !== projectId) throw Error('Connected journey Run Project mismatch')
    const listing = await this.request(`/api/v2/runs/${encodeURIComponent(runId)}/artifacts`, 'GET'); if (listing.run_id !== runId) throw Error('Connected journey artifact Run mismatch')
    const artifact = (Array.isArray(listing.artifacts) ? listing.artifacts : [])[0] as Json | undefined; if (!artifact) throw Error('This Run has no reviewable artifact.')
    const resource = { project_id: projectId, run_id: runId, artifact_id: String(artifact.artifact_id), digest: String(artifact.content_digest) }
    const content = await new RemoteMalleableShellClient(this.baseUrl, this.user, this.token).content(resource)
    return { runId, status: String(run.status), workerId: String(run.assigned_worker_id ?? 'unassigned'), resource, text: content.text }
  }
}
