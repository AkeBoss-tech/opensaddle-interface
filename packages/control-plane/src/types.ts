export type DeploymentMode = 'local' | 'company'
export type ModelKey = 'auto' | 'gpt' | 'claude' | 'sonnet' | 'gemini' | 'llama'
export type Harness = 'chat' | 'research' | 'coding' | 'browser' | 'vm'
/** Implementation that executes coding/CLI-backed harnesses. */
export type CodingProvider =
  | 'auto'
  | 'opensaddle'
  | 'codex'
  | 'claude'
  | 'cursor'
  | 'gemini'
  | 'opencode'
  | 'antigravity'
  | 'custom'
export type RuntimeKind = 'local' | 'browser' | 'sandbox' | 'vm' | 'gpu' | 'restricted'
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type PrincipalKind = 'user' | 'group' | 'agent'
export type ResourceKind = 'organization' | 'project' | 'folder' | 'repository' | 'source' | 'tool' | 'workflow'

export interface AuthPrincipal {
  userId: string
  roles: string[]
  authType: 'local' | 'bearer'
}

export interface PermissionGrant {
  id: string
  principalKind: PrincipalKind
  principalId: string
  resourceKind: ResourceKind
  resourceId: string
  action: string
  effect: 'allow' | 'deny'
  approvalRequired?: boolean
  expiresAt?: number
  pathPrefix?: string
  createdAt: number
  createdBy: string
}

export interface EffectivePermission {
  allowed: boolean
  reason: string
  matchedGrantIds: string[]
  approvalRequired: boolean
}

export interface ModelRouteConfig {
  baseUrl: string
  model: string
  apiKey?: string
  apiKeyEnv?: string
  headers?: Record<string, string>
}

export interface RouteEstimate {
  modelKey: Exclude<ModelKey, 'auto'>
  modelId?: string
  harnessKey: Harness
  /** Coding/CLI provider selected for this route (opensaddle native or external CLI). */
  providerKey: Exclude<CodingProvider, 'auto'>
  /** External CLIs use their own configured router when no model override was requested. */
  nativeModelDefault?: boolean
  runtimeKey: RuntimeKind
  reasons: string[]
  cost: string
  alternatives: Array<{ modelKey: Exclude<ModelKey, 'auto'>; harnessKey: Harness; score: number }>
}

export interface RouteTelemetry {
  id: string
  projectId: string
  modelKey: Exclude<ModelKey, 'auto'>
  providerKey: Exclude<CodingProvider, 'auto'>
  harnessKey: Harness
  runtimeKey: RuntimeKind
  succeeded: boolean
  durationMs: number
  costUsd?: number
  createdAt: number
}

export type RunEventType =
  | 'session.created'
  | 'agent.started'
  | 'agent.output.delta'
  | 'diff.updated'
  | 'review.started'
  | 'review.completed'
  | 'review.failed'
  | 'approval.requested'
  | 'tool.requested'
  | 'tool.completed'
  | 'verification.started'
  | 'verification.completed'
  | 'agent.completed'
  | 'agent.failed'
  | 'session.closed'

export interface RunEvent {
  event_id: string
  session_id: string
  run_id: string
  sequence: number
  timestamp: string
  type: RunEventType
  payload: Record<string, unknown>
}

export interface ProvisionedRuntime {
  id: string
  kind: RuntimeKind
  status: 'provisioning' | 'running' | 'stopped' | 'failed'
  projectId: string
  ownerId: string
  workspacePath?: string
  containerId?: string
  createdAt: number
  expiresAt: number
}

export interface RunRecord {
  id: string
  sessionId: string
  projectId: string
  ownerId: string
  agentId?: string
  task: string
  route: RouteEstimate
  status: RunStatus
  runtimeId?: string
  createdAt: number
  updatedAt: number
  events: RunEvent[]
  error?: string
  reviewProviderKey?: Exclude<CodingProvider, 'auto'>
}

export interface ApprovalRecord {
  id: string
  requestedBy: string
  projectId: string
  agentId?: string
  action: string
  status: 'pending' | 'approved' | 'denied' | 'consumed'
  createdAt: number
  resolvedAt?: number
  resolvedBy?: string
}

/** Durable record of a client-side worker that can execute local capabilities. */
export interface LocalWorkerRecord {
  id: string
  ownerId: string
  kind: 'browser-sandbox' | 'desktop-sidecar'
  status: 'available' | 'unavailable'
  capabilities: string[]
  registeredAt: number
  lastSeenAt: number
}

/** Append-only operational history for authoritative runtime changes. */
export interface AuditEvent {
  id: string
  timestamp: number
  actorId: string
  type: string
  targetType: 'workspace' | 'project' | 'artifact' | 'run' | 'permission' | 'worker' | 'runtime'
  targetId?: string
  projectId?: string
  metadata?: Record<string, unknown>
}

export interface RuntimeProjectState {
  id: string
  updatedAt: number
  data: Record<string, unknown>
}

export interface RuntimeArtifactState {
  id: string
  projectId?: string
  kind: string
  updatedAt: number
  data: Record<string, unknown>
}

export interface PersistedState {
  grants: PermissionGrant[]
  runs: RunRecord[]
  runtimes: ProvisionedRuntime[]
  approvals: ApprovalRecord[]
}
