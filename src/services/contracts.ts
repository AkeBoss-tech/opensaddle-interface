import type { AgentRunBlock, AppData, CodingProvider, Harness, ModelKey, RuntimeKind, SitePage } from '../types'

export type RunEventType =
  | 'session.created'
  | 'session.attached'
  | 'agent.started'
  | 'agent.output.delta'
  | 'agent.input.requested'
  | 'user.input.submitted'
  | 'tool.requested'
  | 'tool.completed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'file.changed'
  | 'diff.updated'
  | 'review.started'
  | 'review.completed'
  | 'verification.started'
  | 'verification.completed'
  | 'agent.paused'
  | 'agent.resumed'
  | 'agent.completed'
  | 'agent.failed'
  | 'session.closed'

export interface SessionEvent {
  event_id: string
  session_id: string
  run_id: string
  sequence: number
  timestamp: string
  type: RunEventType
  payload: Record<string, unknown>
}

export interface RouteEstimate {
  modelKey: ModelKey
  modelId?: string
  harnessKey: Harness
  providerKey?: CodingProvider
  runtimeKey: RuntimeKind
  reasons: string[]
  cost: string
  alternatives?: Array<{ modelKey: ModelKey; harnessKey: Harness; score: number }>
}

export interface RuntimeClient {
  estimate(task: string, prefs?: {
    projectId?: string
    routingPref?: string
    modelKey?: ModelKey
    modelId?: string
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
  }): Promise<RouteEstimate>
  startRun(input: {
    projectId: string
    task: string
    agentId?: string
    modelKey?: ModelKey
    modelId?: string
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
    repo?: string
    approvalId?: string
    reviewProviderKey?: CodingProvider
  }): Promise<{ runId: string; sessionId: string; mode?: string; route?: RouteEstimate }>
  subscribe(runId: string, onEvent: (event: SessionEvent) => void): () => void
  cancel(runId: string): Promise<void>
  requestApproval?(input: {
    projectId: string
    agentId?: string
    action: string
  }): Promise<{ id: string; status: 'pending' | 'approved' | 'denied' | 'consumed' }>
  resolveApproval?(approvalId: string, allow: boolean): Promise<void>
  getDiff?(runId: string): Promise<AgentRunBlock['artifacts']>
  resolveDiff?(runId: string, filePath: string, hunkIndex: number, decision: 'accepted' | 'rejected'): Promise<void>
  listOpenRouterFreeModels?(): Promise<Array<{ id: string; name: string; contextLength?: number }>>
  generateSite?(input: { projectId: string; prompt: string }): Promise<{
    name: string
    description: string
    slug: string
    accent: string
    pages: SitePage[]
  }>
}

export interface WorkspaceClient {
  load(): Promise<AppData | null>
  save(workspace: AppData): Promise<{ updatedAt: number; documents: number }>
}

export interface FileEntry {
  path: string
  name: string
  kind: 'file' | 'directory'
  size: number
  updatedAt: number
  mime?: string
  projectId?: string
}

export interface FileStore {
  list(path?: string): Promise<FileEntry[]>
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
  move(from: string, to: string): Promise<void>
  stat(path: string): Promise<FileEntry | null>
  quota?(): Promise<{ used: number; available: number }>
  importFiles?(files: FileList | File[]): Promise<string[]>
  exportFile?(path: string): Promise<Blob>
}

export interface ToolManifest {
  id: string
  name: string
  provider: string
  description: string
  scopes: string[]
  actions: Array<{ id: string; label: string; write: boolean }>
  connected: boolean
  accountLabel?: string
}

export interface ToolCallRequest {
  toolId: string
  action: string
  args: Record<string, unknown>
  projectId: string
  agentId?: string
  userId: string
}

export interface ToolCallResult {
  ok: boolean
  data?: unknown
  error?: string
  requiresApproval?: boolean
  approvalId?: string
}

export interface ToolClient {
  list(): Promise<ToolManifest[]>
  connect(toolId: string): Promise<{ authUrl: string } | { connected: true }>
  disconnect(toolId: string): Promise<void>
  call(req: ToolCallRequest): Promise<ToolCallResult>
  resolveApproval?(approvalId: string, allow: boolean): Promise<void>
}

export type PrincipalKind = 'user' | 'group' | 'agent'
export type ResourceKind = 'organization' | 'project' | 'folder' | 'repository' | 'source' | 'tool' | 'workflow'
export type CapabilityAction = 'read' | 'write' | 'execute' | 'administer' | string

export interface PermissionGrant {
  id: string
  principalKind: PrincipalKind
  principalId: string
  resourceKind: ResourceKind
  resourceId: string
  action: CapabilityAction
  effect: 'allow' | 'deny'
  inheritance?: 'direct' | 'inherited' | 'override'
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

export interface PermissionClient {
  list(projectId?: string): Promise<PermissionGrant[]>
  upsert(grant: Omit<PermissionGrant, 'id' | 'createdAt'> & { id?: string }): Promise<PermissionGrant>
  revoke(grantId: string): Promise<void>
  check(input: {
    userId: string
    agentId?: string
    resourceKind: ResourceKind
    resourceId: string
    action: CapabilityAction
    path?: string
  }): Promise<EffectivePermission>
}

export interface SandboxResult {
  ok: boolean
  stdout: string
  stderr: string
  durationMs: number
  artifacts?: Array<{ path: string; content: string }>
}

export interface SandboxClient {
  run(input: {
    language: 'javascript' | 'typescript' | 'python'
    code: string
    files?: Record<string, string>
    timeoutMs?: number
  }): Promise<SandboxResult>
}
