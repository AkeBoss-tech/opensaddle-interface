export interface PersonalDevice {
  deviceId: string
  ownerSubject: string
  displayName: string
  platform: 'macos' | 'linux' | 'windows' | 'other'
  pairingState: 'unpaired' | 'paired' | 'revoked'
  connectionState: 'connected' | 'unknown'
  enrollmentRevision?: number
}
export interface DevicePage { items: PersonalDevice[]; nextCursor: string | null }
export interface DeviceRegistration { registration_key: string; display_name: string; platform: PersonalDevice['platform'] }
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid device response')
  return value as Record<string, unknown>
}
function device(value: unknown): PersonalDevice {
  const row = record(value)
  for (const key of ['device_id', 'owner_subject', 'display_name']) if (typeof row[key] !== 'string' || !row[key]) throw Error('Invalid device identity')
  if (!['macos','linux','windows','other'].includes(String(row.platform)) || !['unpaired','paired','revoked'].includes(String(row.pairing_state)) || !['connected','unknown'].includes(String(row.connection_state))) throw Error('Invalid device status')
  if (row.enrollment_revision != null && (!Number.isSafeInteger(row.enrollment_revision) || Number(row.enrollment_revision) < 1)) throw Error('Invalid device enrollment revision')
  return { enrollmentRevision: row.enrollment_revision == null ? undefined : Number(row.enrollment_revision), deviceId: row.device_id as string, ownerSubject: row.owner_subject as string, displayName: row.display_name as string, platform: row.platform as PersonalDevice['platform'], pairingState: row.pairing_state as PersonalDevice['pairingState'], connectionState: row.connection_state as PersonalDevice['connectionState'] }
}
export class PersonalDevicesClient {
  private baseUrl: string
  private getUser: () => string
  private token?: string
  readonly pairingAvailable: boolean
  readonly assignmentsAvailable: boolean
  constructor(baseUrl: string, getUser: () => string, token?: string, pairingAvailable = false, assignmentsAvailable = false) { this.baseUrl = baseUrl; this.getUser = getUser; this.token = token; this.pairingAvailable = pairingAvailable; this.assignmentsAvailable = assignmentsAvailable }
  identity() { return this.getUser() }
  private async request(path: string, body?: unknown, method?: string) {
    const identity = this.identity()
    const response = await fetch(this.baseUrl.replace(/\/$/, '') + path, {
      method: method ?? (body ? 'POST' : 'GET'), cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { 'X-OpenSaddle-User': identity, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body ? { 'Content-Type':'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (this.identity() !== identity) throw Error('Device account changed during the request')
    if (!response.ok) throw Error(`Device request failed (${response.status}). Refresh your connection and try again.`)
    const value: unknown = await response.json()
    if (this.identity() !== identity) throw Error('Device account changed during the request')
    return value
  }
  async list(after = ''): Promise<DevicePage> {
    const owner=this.identity()
    const row = record(await this.request('/api/v2/devices?limit=50&after=' + encodeURIComponent(after)))
    if (!Array.isArray(row.items) || row.items.length > 50 || (row.next_cursor !== null && typeof row.next_cursor !== 'string')) throw Error('Invalid device page')
    const items = row.items.map(device)
    if (new Set(items.map(item => item.deviceId)).size !== items.length || new Set(items.map(item => item.ownerSubject)).size > 1) throw Error('Invalid device inventory')
    if(owner!==this.identity()||items.some(item=>item.ownerSubject!==owner))throw Error('Device owner identity changed. Refresh your connection.')
    return {items, nextCursor: row.next_cursor as string | null}
  }
  async register(body: DeviceRegistration) {
    const owner=this.identity(),created=device(await this.request('/api/v2/devices', body))
    if(owner!==this.identity()||created.ownerSubject!==owner)throw Error('Device owner identity changed. Refresh your connection.')
    return created
  }
  async beginPairing(deviceId: string) {
    const value = record(await this.request('/api/v2/devices/'+encodeURIComponent(deviceId)+'/pairing', {}))
    if (value.protocol !== 'opensaddle.device-pairing.v1' || value.device_id !== deviceId || typeof value.pairing_id !== 'string' || !/^pairing_[A-Za-z0-9_]+$/.test(value.pairing_id) || typeof value.secret !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(value.secret) || typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at))) throw Error('Invalid pairing challenge')
    return {pairingId:value.pairing_id, code:`${value.pairing_id}:${deviceId}:${value.secret}`, expiresAt:value.expires_at}
  }
  async inspectPairing(pairingId: string, deviceId: string) {
    const value = record(await this.request('/api/v2/device-pairings/'+encodeURIComponent(pairingId)))
    if (value.pairing_id !== pairingId || value.device_id !== deviceId || !['issued','claimed','confirmed','revoked','expired'].includes(String(value.state)) || (value.fingerprint != null && (typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)))) throw Error('Invalid pairing inspection')
    return {state:String(value.state),fingerprint:value.fingerprint as string | null}
  }
  async confirmPairing(pairingId: string, deviceId: string, fingerprint: string) {
    const value = record(await this.request('/api/v2/device-pairings/'+encodeURIComponent(pairingId)+'/confirm',{fingerprint}))
    if (value.device_id !== deviceId || value.pairing_state !== 'paired' || value.fingerprint !== fingerprint) throw Error('Invalid pairing confirmation')
  }
  async unpair(deviceId: string, revision: number) {
    const value = record(await this.request('/api/v2/devices/'+encodeURIComponent(deviceId)+'/unpair',{expected_revision:revision}))
    if (value.device_id !== deviceId || value.pairing_state !== 'revoked' || value.revision !== revision + 1) throw Error('Invalid unpair response')
  }
  async assignments(deviceId: string): Promise<DeviceAssignment[]> {
    const value = record(await this.request(`/api/v2/devices/${encodeURIComponent(deviceId)}/assignments`))
    if (!Array.isArray(value.items) || value.items.length > 100) throw Error('Invalid assignments')
    return value.items.map(item => assignment(item, deviceId))
  }
  async projectAssignments(projectId: string): Promise<DeviceAssignment[]> {
    const value=record(await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/devices`))
    if(!Array.isArray(value.items) || value.items.length>100)throw Error('Invalid project assignments')
    const items=value.items.map(raw=>{const row=record(raw);if(typeof row.device_id!=='string')throw Error('Invalid device identity');return assignment(raw,row.device_id,projectId)})
    if(new Set(items.map(item=>item.device_id)).size!==items.length)throw Error('Duplicate device assignment')
    return items
  }
  async assignmentContext(projectId: string) {
    const path = `/api/v2/projects/${encodeURIComponent(projectId)}`
    const [roster, sources] = await Promise.all([this.request(path+'/members'),this.request(path+'/sources')]).then(values=>values.map(record))
    if (roster.project_id !== projectId || sources.project_id !== projectId || !Array.isArray(roster.members) || !Array.isArray(sources.items)) throw Error('Invalid project context')
    const members = roster.members.map(raw=>{const item=record(raw);if(typeof item.subject!=='string' || typeof item.role!=='string' || typeof item.status!=='string')throw Error('Invalid member');return {subject:item.subject,role:item.role,status:item.status}}).filter(item=>item.status==='active')
    return {members, sources:sources.items.map(raw=>{const item=record(raw);if(typeof item.source_id!=='string' || typeof item.display_label!=='string')throw Error('Invalid source');return {id:item.source_id,label:item.display_label}}), canManage:roster.viewer_can_manage===true && typeof roster.viewer_subject==='string' && members.some(item=>item.subject===roster.viewer_subject && ['owner','admin'].includes(item.role))}
  }
  async proposeAssignment(deviceId: string, projectId: string, policy: AssignmentPolicy) {
    return assignment(await this.request(`/api/v2/devices/${encodeURIComponent(deviceId)}/assignments/${encodeURIComponent(projectId)}`,policy,'PUT'),deviceId,projectId)
  }
  async decideAssignment(deviceId: string, projectId: string, revision: number, accept: boolean) {
    return assignment(await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/devices/${encodeURIComponent(deviceId)}/decision`,{expected_revision:revision,accept}),deviceId,projectId)
  }
  async revokeAssignment(deviceId: string, projectId: string, revision: number) {
    return assignment(await this.request(`/api/v2/devices/${encodeURIComponent(deviceId)}/assignments/${encodeURIComponent(projectId)}/revoke`,{expected_revision:revision}),deviceId,projectId)
  }

}

export interface AssignmentPolicy {expected_revision:number;audience:'owner_only'|'selected_members'|'project_members'|'team_members';team_id?:string|null;subjects:string[];source_ids:string[];adapter_ids:string[]}
export interface DeviceAssignment extends Omit<AssignmentPolicy,'expected_revision'> {device_id:string;project_id:string;revision:number;state:string;owner_subject:string;display_name?:string;consent_allows_requester:boolean}
function assignment(raw:unknown,deviceId:string,projectId?:string):DeviceAssignment {
  const value=record(raw)
  if(value.device_id!==deviceId || typeof value.project_id!=='string' || (projectId && value.project_id!==projectId) || typeof value.owner_subject!=='string' || !Number.isSafeInteger(value.revision) || Number(value.revision)<1 || !['proposed','accepted','removed','revoked'].includes(String(value.state)) || !['owner_only','selected_members','project_members','team_members'].includes(String(value.audience)) || typeof value.consent_allows_requester!=='boolean')throw Error('Invalid assignment identity')
  if(value.audience==='team_members' && (typeof value.team_id!=='string'||!value.team_id))throw Error('Invalid named team policy')
  for(const field of ['subjects','source_ids','adapter_ids'])if(!Array.isArray(value[field]) || !(value[field] as unknown[]).every(item=>typeof item==='string'))throw Error('Invalid assignment policy')
  return value as unknown as DeviceAssignment
}
