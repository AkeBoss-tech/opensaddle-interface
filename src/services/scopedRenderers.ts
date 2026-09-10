import {StandalonePluginSettingsClient} from './standalonePluginSettings'
import {rendererSettingsContract} from './rendererSettings'
import {PersonalDevicesClient} from './personalDevices'
import type { ApplicationRendererCandidate, EnvironmentRevision } from './contracts'

export type ViewScope = { kind: 'user'; id: string } | { kind: 'team'; id: string }
export type ScopedEnvironment = Omit<EnvironmentRevision, 'project_id'> & { scope: ViewScope; viewer_subject: string }
export type RendererReference = { package_id: string; version: string; manifest_digest: string; application_id: string }
export type ScopedContentReference = RendererReference & { environment_revision: number; environment_digest: string; content_digest: string }
export type ScopedHostRequest = ScopedContentReference & { host_id: string; instance_id: string; generation: number }
export type ScopedHostSession = { session_id: string; scope: ViewScope; report_token: string; expires_at: string; next_sequence: number; host_id: string; instance_id: string; application_id: string; package_ref: Omit<RendererReference, 'application_id'>; environment_revision: number; environment_definition_digest: string; generation: number }
export type HostReport = { sequence: number; state: 'loading' | 'ready' | 'error'; error_code?: string }
export type ScopedHostReceipt = HostReport & { session_id: string; observed_at: string; authority: 'host_reported'; semantic_correctness: 'not_verified' }
const sameScope = (a: ViewScope | undefined, b: ViewScope) => a?.kind === b.kind && a.id === b.id
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const revision = (value: unknown, min = 0) => Number.isSafeInteger(value) && Number(value) >= min

/** Personal identity always comes from the authenticated account. Team authority is
 * checked by Core on every operation. This client never synthesizes a Project. */
export class ScopedRendererClient {
  private base: string; private user: () => string; private token?: string
  constructor(base: string, user: () => string, token?: string) { this.base = base.replace(/\/$/, ''); this.user = user; this.token = token }
  identity() { return this.user() }
  preferences() { return new StandalonePluginSettingsClient(this.base,this.user,this.token) }
  stateScope() { return JSON.stringify([this.base,this.user()]) }
  private async request(scope: ViewScope, path: string, init: RequestInit = {}) {
    const subject = this.user(), expected = { ...scope }
    if (!subject || !scope.id || !['user', 'team'].includes(scope.kind) || (scope.kind === 'user' && scope.id !== subject)) throw Error('Scoped view account mismatch')
    const root = scope.kind === 'user' ? '/api/v2/me' : `/api/v2/teams/${encodeURIComponent(scope.id)}`
    const response = await fetch(this.base + root + path, { ...init, cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(15000), headers: { ...init.headers, 'X-OpenSaddle-User': subject, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
    const check = () => { if (this.user() !== subject || !sameScope(scope, expected)) throw Error('Scoped view account changed') }
    check()
    if (!response.ok) { const body = await response.json().catch(() => null); check(); throw Error(typeof body?.detail === 'string' ? body.detail : `Scoped view request failed (${response.status})`) }
    return { response, subject, expected, check }
  }
  private async json(scope: ViewScope, path: string, init?: RequestInit) {
    const request = await this.request(scope, path, init), value = await request.response.json(); request.check()
    if (!sameScope(value.scope, request.expected) || ('viewer_subject' in value && value.viewer_subject !== request.subject)) throw Error('Scoped view response identity mismatch')
    return value
  }
  private environmentValue(value: ScopedEnvironment) {
    if (value.schema_version !== 'opensaddle.scoped-environment.v1' || !revision(value.revision) || !digest(value.definition_digest) || !value.definition || !Array.isArray(value.definition.commands) || !Array.isArray(value.definition.bindings) || !Array.isArray(value.definition.services)) throw Error('Invalid scoped environment')
    return value
  }
  async ownerDevices(scope:ViewScope, after='') {
    const owner=this.identity()
    if(scope.kind!=='user'||scope.id!==owner||typeof after!=='string'||after.length>512)throw Error('Owner device scope mismatch')
    const page=await new PersonalDevicesClient(this.base,this.user,this.token).list(after)
    if(this.identity()!==owner||scope.id!==owner||scope.kind!=='user')throw Error('Owner device account changed')
    return {schema_version:'opensaddle.owner-device-page.v1',task_authority:'not_evaluated',items:page.items.map(item=>({device_id:item.deviceId,display_name:item.displayName,platform:item.platform,pairing_state:item.pairingState,connection_state:item.connectionState})),next_cursor:page.nextCursor}
  }
  async ownerDeviceActivity(scope:ViewScope, deviceId:string) {
    const owner=this.identity()
    if(scope.kind!=='user'||scope.id!==owner||!/^device_[A-Za-z0-9_]{1,200}$/.test(deviceId))throw Error('Owner device scope mismatch')
    const activity=await new PersonalDevicesClient(this.base,this.user,this.token).activity(deviceId)
    if(this.identity()!==owner||scope.id!==owner||scope.kind!=='user')throw Error('Owner device account changed')
    return {schema_version:'opensaddle.owner-device-activity.v1',device_id:activity.deviceId,generated_at:activity.generatedAt,readiness:activity.readiness,active_runs:activity.activeRuns,task_authority:'not_evaluated',process_termination:'not_observed'}
  }
  async viewSettings(scope: ViewScope, ref: RendererReference, declaration: unknown) {
    const actor=this.identity(),contract=rendererSettingsContract(declaration)
    if(!contract||!contract.scopes.includes(scope.kind)||(scope.kind==='user'&&scope.id!==actor))throw Error('View settings unavailable')
    const rows=await new StandalonePluginSettingsClient(this.base,this.user,this.token).list(scope.kind==='team'?scope.id:undefined)
    if(actor!==this.identity())throw Error('View settings account changed')
    const matches=rows.filter(row=>row.application_id===ref.application_id&&row.package_ref.package_id===ref.package_id&&row.package_ref.version===ref.version&&row.package_ref.manifest_digest===ref.manifest_digest)
    const canonical=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,JSON.parse(canonical(item))])):value)
    if(matches.length>1||matches.some(row=>canonical(row.contract)!==canonical(contract)))throw Error('View settings declaration changed')
    const layer=matches[0]?.layer
    return {schema_version:'opensaddle.scoped-view-settings.v1',scope:{...scope},settings_version:contract.settings_version,revision:layer?.revision??0,values:{...contract.defaults,...layer?.values},authority:'presentation_only'}
  }
  async environment(scope: ViewScope, signal?: AbortSignal): Promise<ScopedEnvironment> { return this.environmentValue(await this.json(scope, '/environment', { signal })) }
  async candidates(scope: ViewScope, signal?: AbortSignal): Promise<{ scope: ViewScope; activation_supported: boolean; items: ApplicationRendererCandidate[] }> {
    const value = await this.json(scope, '/application-renderer-candidates', { signal })
    if (value.schema_version !== 'opensaddle.scoped-renderer-candidates.v1' || typeof value.activation_supported !== 'boolean' || !Array.isArray(value.items)) throw Error('Invalid scoped renderer catalog')
    return value
  }
  async enable(scope: ViewScope, ref: RendererReference, expected_revision?: number) {
    const value = await this.json(scope, `/application-renderer-candidates/${encodeURIComponent(ref.package_id)}/enable`, { method: 'POST', body: JSON.stringify({ version: ref.version, manifest_digest: ref.manifest_digest, expected_revision }) })
    if (value.code_loaded !== false || value.enablement?.status !== 'enabled' || value.enablement?.version !== ref.version || !revision(value.enablement.revision, 1)) throw Error('Scoped enablement could not be confirmed')
    return value.enablement as { status: 'enabled'; version: string; revision: number }
  }
  async disable(scope: ViewScope, packageId: string, expected_revision: number) {
    const value = await this.json(scope, `/application-renderer-candidates/${encodeURIComponent(packageId)}/disable`, { method: 'POST', body: JSON.stringify({ expected_revision }) })
    if (value.code_loaded !== false || value.enablement?.status !== 'disabled' || value.enablement.revision !== expected_revision + 1) throw Error('Scoped disablement could not be confirmed')
    return value.enablement as { status: 'disabled'; version: string; revision: number }
  }
  async select(scope: ViewScope, expected_revision: number, selection: RendererReference | null, reason: string): Promise<ScopedEnvironment> {
    const value = this.environmentValue(await this.json(scope, '/environment/selection', { method: 'POST', body: JSON.stringify({ expected_revision, selection, reason }) }))
    if (value.revision !== expected_revision + 1 || (value as ScopedEnvironment & {code_loaded?: boolean}).code_loaded !== false) throw Error('Scoped selection could not be confirmed')
    return value
  }
  async content(scope: ViewScope, ref: ScopedContentReference, signal?: AbortSignal): Promise<Response> {
    const query = new URLSearchParams(Object.entries(ref).map(([key, value]) => [key, String(value)]))
    const request = await this.request(scope, `/environment/content?${query}`, { signal })
    // Buffer the bounded fragment so account changes during body delivery cannot
    // release old-account executable content. The shared host verifies its hash.
    const reader = request.response.body?.getReader(); if (!reader) throw Error('Scoped renderer bytes unavailable')
    const chunks: Uint8Array[] = []; let size = 0
    try { for (;;) { const { done, value } = await reader.read(); request.check(); if (done) break; size += value.byteLength; if (size > 262144) throw Error('Scoped renderer content too large'); chunks.push(value) } }
    catch (error) { await reader.cancel().catch(() => {}); throw error }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return new Response(bytes, { headers: request.response.headers })
  }
  async createHost(scope: ViewScope, ref: ScopedHostRequest): Promise<ScopedHostSession> {
    const value = await this.json(scope, '/renderer-host-sessions', { method: 'POST', body: JSON.stringify(ref) })
    if (!value.session_id || !value.report_token || value.next_sequence !== 1 || value.application_id !== ref.application_id || value.instance_id !== ref.instance_id || value.host_id !== ref.host_id || value.generation !== ref.generation || value.environment_revision !== ref.environment_revision || value.environment_definition_digest !== ref.environment_digest || value.package_ref?.package_id !== ref.package_id || value.package_ref?.version !== ref.version || value.package_ref?.manifest_digest !== ref.manifest_digest) throw Error('Scoped host session identity mismatch')
    return value
  }
  async report(scope: ViewScope, session: ScopedHostSession, report: HostReport): Promise<ScopedHostReceipt> {
    if (!sameScope(session.scope, scope)) throw Error('Scoped host session scope mismatch')
    const request = await this.request(scope, `/renderer-host-sessions/${encodeURIComponent(session.session_id)}/observations`, { method: 'POST', headers: { 'X-OpenSaddle-Renderer-Host-Token': session.report_token }, body: JSON.stringify(report) })
    const value = await request.response.json(); request.check()
    if (value.session_id !== session.session_id || value.sequence !== report.sequence || value.state !== report.state || value.authority !== 'host_reported' || value.semantic_correctness !== 'not_verified') throw Error('Scoped host receipt mismatch')
    return value
  }
}
