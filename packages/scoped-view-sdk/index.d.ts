/** Bundle this package into a signed fragment; never load it remotely at runtime. */
export type ScopedViewKind = 'user' | 'team'
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue}
export interface ScopedViewInitialization<S extends ScopedViewKind> {
  scope: {kind: S; id: string}
  /** Granted capabilities; presence does not grant task execution authority. */
  capabilities: string[]
  /** Validate restored state against your signed state schema before using it. */
  state: unknown
}
export interface ScopedViewOptions<S extends ScopedViewKind> {
  scope: S
  /** Initialize local presentation only. Resource reads become available afterward. */
  onInit(value: ScopedViewInitialization<S>): void | Promise<void>
  /** Resource timeout in milliseconds, 1–30000; defaults to 10000. */
  timeoutMs?: number
}
export interface ScopedViewSettings<S extends ScopedViewKind> {
  schema_version: 'opensaddle.scoped-view-settings.v1'
  scope: {kind: S; id: string}
  settings_version: number
  revision: number
  values: Record<string, JsonValue>
  authority: 'presentation_only'
}
export interface OwnerDevice {
  device_id: string
  display_name: string
  platform: 'macos' | 'linux' | 'windows' | 'other'
  pairing_state: 'unpaired' | 'paired' | 'revoked'
  connection_state: 'connected' | 'unknown'
}
export interface OwnerDevicePage {
  schema_version: 'opensaddle.owner-device-page.v1'
  task_authority: 'not_evaluated'
  items: OwnerDevice[]
  next_cursor: string | null
}
export interface OwnerDeviceActivity {
  schema_version: 'opensaddle.owner-device-activity.v1'
  device_id: string
  generated_at: string
  readiness: Array<{
    worker_id: string; project_id: string; adapter_id: string
    reported_ready: boolean; current: boolean
    unavailable_reason: string | null
    observed_at: string; expires_at: string
  }>
  active_runs: Array<{
    run_id: string; project_id: string; worker_id: string
    status: 'provisioning' | 'running'
  }>
  task_authority: 'not_evaluated'
  process_termination: 'not_observed'
}
export interface ScopedViewCommon<S extends ScopedViewKind> {
  /** Proposes state; returning does not acknowledge durable persistence. */
  saveState(state: JsonValue): void
  /** Requires the signed view.settings.read capability and settings contract. */
  readSettings(): Promise<ScopedViewSettings<S>>
  /** Removes listeners and rejects any pending resource request. */
  dispose(): void
}
export interface OwnerDeviceReads {
  /** Requires owner.devices.read. Cursor length is at most 512 characters. */
  readDevices(after?: string): Promise<OwnerDevicePage>
  /** Requires owner.device-activity.read and a device ID delivered by the host. */
  readDeviceActivity(deviceId: string): Promise<OwnerDeviceActivity>
}
export type ScopedViewClient<S extends ScopedViewKind> = ScopedViewCommon<S> &
  (S extends 'user' ? OwnerDeviceReads : {})
/** Types guide authors; the signed host and Core still authorize every operation. */
export function connectScopedView<S extends ScopedViewKind>(options: ScopedViewOptions<S>): ScopedViewClient<S>
