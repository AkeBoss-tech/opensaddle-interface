export type RuntimeProcessStatus = 'starting' | 'running' | 'stopped' | 'failed' | 'cancelled'

export type RuntimeEventType =
  | 'process.started'
  | 'process.stdout'
  | 'process.stderr'
  | 'process.completed'
  | 'process.failed'
  | 'process.cancelled'
  | 'tool.started'
  | 'tool.output'
  | 'tool.completed'
  | 'tool.failed'
  | 'capability.requested'
  | 'capability.denied'
  | 'artifact.created'
  | 'filesystem.changed'

export interface RuntimeEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  sequence: number
  timestamp: string
  type: RuntimeEventType
  processId?: string
  invocationId?: string
  payload: TPayload
}

export interface CapabilityRequest {
  capability: string
  pathPrefix?: string
  origins?: string[]
  maxBytes?: number
  expiresAt?: number
}

export interface CapabilityGrant extends CapabilityRequest {
  id: string
  effect: 'allow' | 'deny'
  approvalRequired?: boolean
}

export interface CapabilityDecision {
  allowed: boolean
  reason: string
  matchedGrantIds: string[]
  approvalRequired: boolean
}

export interface RuntimeLimits {
  timeoutMs?: number
  maxOutputBytes?: number
  maxArtifactBytes?: number
}

export interface RuntimeProcess {
  id: string
  label: string
  status: RuntimeProcessStatus
  startedAt: number
  finishedAt?: number
  exitCode?: number
  error?: string
  stdout: string
  stderr: string
  kill(reason?: string): Promise<void>
}

export interface VirtualFileStat {
  path: string
  kind: 'file' | 'directory'
  size: number
  updatedAt: number
}

export interface VirtualDirectoryEntry extends VirtualFileStat {
  name: string
}

export interface VirtualFileSystem {
  read(path: string): Promise<Uint8Array>
  write(path: string, data: Uint8Array): Promise<void>
  list(path?: string): Promise<VirtualDirectoryEntry[]>
  stat(path: string): Promise<VirtualFileStat | null>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
}
