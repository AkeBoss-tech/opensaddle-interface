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
export type RunStatus = 'queued' | 'waiting' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type PrincipalKind = 'user' | 'group' | 'agent'
export type ResourceKind = 'organization' | 'project' | 'folder' | 'repository' | 'source' | 'tool' | 'workflow' | 'thread' | 'agent'
export interface HarnessExecutionPolicy {
  sandbox: 'read-only' | 'workspace-write' | 'full-access'
  approvals: 'always' | 'on-request' | 'never'
  network: boolean
  allowedTools: string[]
  deniedTools: string[]
}

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

/**
 * Durable conversation metadata. This deliberately remains independent from
 * the legacy workspace snapshot so clients can progressively adopt granular
 * thread APIs without a flag-day migration.
 */
export interface ThreadRecord {
  id: string
  ownerId: string
  projectId: string
  title: string
  visibility: 'private' | 'shared' | 'project'
  sharedWith: string[]
  agentId?: string
  continuation?: {
    provider: 'codex' | 'claude' | 'cursor' | 'gemini'
    sessionId: string
    sourcePath: string
    authority: 'source_managed' | 'opensaddle_managed' | 'hybrid'
    mode?: 'resume' | 'fork'
    checkpointId?: string
  }
  branchedFromId?: string
  pinned: boolean
  archivedAt?: number
  createdAt: number
  updatedAt: number
}

/** A durable transcript entry. `payload` preserves rich client-only fields
 * (run blocks, rendered HTML, attachments) without coupling the daemon to UI
 * presentation types. */
export interface ThreadMessageRecord {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: number
  updatedAt: number
  payload?: Record<string, unknown>
}

export interface ThreadSearchResult {
  thread: ThreadRecord
  messageId?: string
  snippet: string
  matchedIn: 'title' | 'message'
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
  | 'approval.resolved'
  | 'tool.requested'
  | 'tool.completed'
  | 'verification.started'
  | 'verification.completed'
  | 'agent.completed'
  | 'agent.failed'
  | 'plan.updated'
  | 'command.started'
  | 'command.output.delta'
  | 'command.completed'
  | 'file.change.updated'
  | 'usage.updated'
  | 'input.requested'
  | 'user.input.submitted'
  | 'agent.queued'
  | 'agent.dequeued'
  | 'agent.paused'
  | 'agent.resumed'
  | 'warning'
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
  /** Original project folder that receives explicitly accepted review hunks. */
  sourceWorkspacePath?: string
  isolatedChanges?: boolean
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
  parentRunId?: string
  /** Immediate predecessor whose terminal state releases this queued turn. */
  queuedAfterRunId?: string
  sourceIds?: string[]
  task: string
  route: RouteEstimate
  status: RunStatus
  runtimeId?: string
  createdAt: number
  updatedAt: number
  events: RunEvent[]
  error?: string
  reviewProviderKey?: Exclude<CodingProvider, 'auto'>
  /** Local-only dynamic harness snapshot. Stored with the run so retries and
   * recovery never depend on mutable project configuration. */
  harnessProfile?: import('./harness/types.js').HarnessProfile
  /** Existing provider-native session/thread selected for the first turn. */
  providerSessionId?: string
  /** Resume the source session or create a provider-native fork before the turn. */
  providerSessionMode?: 'resume' | 'fork'
  /** Provider turn checkpoint used to truncate a historical fork, inclusive. */
  providerTurnId?: string
  /** Git tree for the exact visible worktree before this run started. */
  workspaceBaseline?: string
  executionMode?: import('./executionModes.js').RunExecutionMode
  executionPolicy?: HarnessExecutionPolicy
  /** Durable promotion target for changes prepared in Review mode. */
  reviewTargetPath?: string
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

export interface PersistedState {
  grants: PermissionGrant[]
  runs: RunRecord[]
  runtimes: ProvisionedRuntime[]
  approvals: ApprovalRecord[]
}
