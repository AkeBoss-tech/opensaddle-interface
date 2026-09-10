export interface PersonalDevice {
  deviceId: string
  ownerSubject: string
  displayName: string
  platform: 'macos' | 'linux' | 'windows' | 'other'
  pairingState: 'unpaired' | 'paired' | 'revoked'
  connectionState: 'connected' | 'unknown'
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
  return { deviceId: row.device_id as string, ownerSubject: row.owner_subject as string, displayName: row.display_name as string, platform: row.platform as PersonalDevice['platform'], pairingState: row.pairing_state as PersonalDevice['pairingState'], connectionState: row.connection_state as PersonalDevice['connectionState'] }
}
export class PersonalDevicesClient {
  private baseUrl: string
  private getUser: () => string
  private token?: string
  constructor(baseUrl: string, getUser: () => string, token?: string) { this.baseUrl = baseUrl; this.getUser = getUser; this.token = token }
  identity() { return this.getUser() }
  private async request(path: string, body?: DeviceRegistration) {
    const identity = this.identity()
    const response = await fetch(this.baseUrl.replace(/\/$/, '') + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000),
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
    const row = record(await this.request('/api/v2/devices?limit=50&after=' + encodeURIComponent(after)))
    if (!Array.isArray(row.items) || row.items.length > 50 || (row.next_cursor !== null && typeof row.next_cursor !== 'string')) throw Error('Invalid device page')
    const items = row.items.map(device)
    if (new Set(items.map(item => item.deviceId)).size !== items.length || new Set(items.map(item => item.ownerSubject)).size > 1) throw Error('Invalid device inventory')
    return {items, nextCursor: row.next_cursor as string | null}
  }
  async register(body: DeviceRegistration) { return device(await this.request('/api/v2/devices', body)) }
}
