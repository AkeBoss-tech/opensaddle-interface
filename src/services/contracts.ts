import type { AgentRunBlock, AppData, CodingProvider, Harness, ModelKey, RunExecutionMode, RuntimeKind, SitePage } from '../types'

export type RunEventType =
  | 'session.created'
  | 'session.attached'
  | 'session.continued'
  | 'agent.started'
  | 'agent.output.delta'
  | 'agent.input.requested'
  | 'user.input.submitted'
  | 'agent.queued'
  | 'agent.queue.updated'
  | 'agent.dequeued'
  | 'tool.requested'
  | 'tool.completed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'file.changed'
  | 'diff.updated'
  | 'review.started'
  | 'review.completed'
  | 'review.failed'
  | 'verification.started'
  | 'verification.completed'
  | 'agent.paused'
  | 'agent.resumed'
  | 'agent.completed'
  | 'agent.failed'
  | 'plan.updated'
  | 'command.started'
  | 'command.output.delta'
  | 'command.completed'
  | 'file.change.updated'
  | 'usage.updated'
  | 'input.requested'
  | 'warning'
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
  nativeModelDefault?: boolean
  harnessKey: Harness
  providerKey?: CodingProvider
  runtimeKey: RuntimeKind
  reasons: string[]
  cost: string
  alternatives?: Array<{ modelKey: ModelKey; harnessKey: Harness; score: number }>
}

export interface RuntimeRunSummary {
  runId: string
  sessionId: string
  projectId: string
  task: string
  agentId?: string
  parentRunId?: string
  queuedAfterRunId?: string
  status: 'queued' | 'provisioning' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed' | 'cancelled'
  route: RouteEstimate
  providerSessionId?: string
  providerSessionMode?: 'resume' | 'fork'
  providerTurnId?: string
  executionMode?: RunExecutionMode
  createdAt: number
  updatedAt: number
  error?: string
  lastEventType?: RunEventType
}

export interface GitStatusResult {
  repository: string
  branch: string | null
  detached: boolean
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  clean: boolean
  additions: number
  deletions: number
  files: Array<{
    path: string
    originalPath?: string
    index: string
    worktree: string
    staged: boolean
    modified: boolean
    untracked: boolean
  }>
  diffFiles: Array<{ path: string; additions: number | null; deletions: number | null; binary: boolean }>
}

export interface GitComparisonResult {
  repository: string
  base: string
  head: string
  mergeBase: string
  additions: number
  deletions: number
  files: GitStatusResult['diffFiles']
  patch: string
  truncated: boolean
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
    threadId?: string
    task: string
    agentId?: string
    parentRunId?: string
    sourceIds?: string[]
    providerSessionId?: string
    providerSessionMode?: 'resume' | 'fork'
    providerTurnId?: string
    modelKey?: ModelKey
    modelId?: string
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
    executionMode?: RunExecutionMode
    capabilityIds?: string[]
    repo?: string
    approvalId?: string
    reviewProviderKey?: CodingProvider
  }): Promise<{ runId: string; sessionId: string; mode?: string; route?: RouteEstimate }>
  listRuns?(): Promise<RuntimeRunSummary[]>
  subscribe(runId: string, onEvent: (event: SessionEvent) => void): () => void
  cancel(runId: string): Promise<void>
  pause(runId: string): Promise<void>
  resume(runId: string): Promise<void>
  retry(runId: string): Promise<{ runId: string; sessionId: string; parentRunId?: string; route?: RouteEstimate }>
  steer(runId: string, text: string): Promise<void>
  queue(runId: string, text: string): Promise<{
    runId: string
    sessionId: string
    parentRunId?: string
    queuedAfterRunId?: string
    route?: RouteEstimate
  }>
  updateQueue(runId: string, text: string): Promise<void>
  respondToRequest(runId: string, requestId: string, response: {
    approved?: boolean
    scope?: 'once' | 'session'
    text?: string
    answers?: Record<string, string[]>
    form?: Record<string, unknown>
  }): Promise<void>
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
  gitStatus?(projectId: string, repo: string): Promise<GitStatusResult>
  gitCompare?(projectId: string, repo: string, base: string, head?: string): Promise<GitComparisonResult>
  gitCreateBranch?(input: {
    projectId: string
    repo: string
    branch: string
    startPoint?: string
    approvalId?: string
  }): Promise<{ repository: string; branch: string; startPoint: string; summary: string }>
  gitCommit?(input: {
    projectId: string
    repo: string
    message: string
    paths?: string[]
    includeAll?: boolean
    approvalId?: string
  }): Promise<{ repository: string; commit: string; summary: string }>
  gitPush?(input: {
    projectId: string
    repo: string
    remote?: string
    branch?: string
    approvalId: string
  }): Promise<{ repository: string; remote: string; branch: string; summary: string }>
  gitCreatePullRequest?(input: {
    projectId: string
    repo: string
    title: string
    body: string
    base: string
    head?: string
    draft?: boolean
    approvalId: string
  }): Promise<{
    repository: string
    number: number
    url: string
    title: string
    state: string
    base: string
    head: string
  }>
}

export interface WorkspaceClient {
  load(): Promise<AppData | null>
  save(workspace: AppData): Promise<{ updatedAt: number; documents: number }>
}

/** Server-owned conversation metadata, deliberately separate from AppData's
 * legacy snapshot collections. */
export interface DurableThread {
  id: string
  ownerId: string
  projectId: string
  title: string
  visibility: 'private' | 'shared' | 'project'
  sharedWith: string[]
  agentId?: string
  runConfig?: {
    auto: boolean
    providerKey: string
    modelKey: string
    harnessKey: string
    runtimeKey: string
    executionMode: RunExecutionMode
    tools: string[]
    openRouterModelId?: string
  }
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

export interface DurableThreadMessage {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: number
  updatedAt: number
  payload?: Record<string, unknown>
}

export interface ThreadClient {
  list(input?: {
    projectId?: string
    includeArchived?: boolean
    limit?: number
    cursor?: string
  }): Promise<{ threads: DurableThread[]; nextCursor?: string }>
  get(threadId: string): Promise<DurableThread>
  create(input: {
    id?: string
    projectId: string
    title?: string
    visibility?: DurableThread['visibility']
    sharedWith?: string[]
    agentId?: string
    runConfig?: DurableThread['runConfig']
    continuation?: DurableThread['continuation']
    branchedFromId?: string
    pinned?: boolean
  }): Promise<DurableThread>
  update(threadId: string, input: Partial<Pick<DurableThread, 'title' | 'visibility' | 'sharedWith' | 'agentId' | 'continuation' | 'runConfig' | 'pinned'>> & { archived?: boolean }): Promise<DurableThread>
  remove(threadId: string): Promise<void>
  messages(threadId: string, input?: { limit?: number; cursor?: string }): Promise<{
    messages: DurableThreadMessage[]
    nextCursor?: string
  }>
  appendMessage(threadId: string, input: {
    id?: string
    role: DurableThreadMessage['role']
    text: string
    payload?: Record<string, unknown>
  }): Promise<DurableThreadMessage>
  updateMessage(threadId: string, messageId: string, input: {
    text?: string
    payload?: Record<string, unknown>
  }): Promise<DurableThreadMessage>
  search(input: { q: string; projectId?: string; limit?: number }): Promise<Array<{
    thread: DurableThread
    messageId?: string
    snippet: string
    matchedIn: 'title' | 'message'
  }>>
}

export interface HarnessCapability {
  id: string
  label: string
  description: string
  kind: 'native' | 'cli'
  availability: 'available' | 'missing' | 'disabled'
  readiness: 'ready' | 'needs_auth' | 'unknown' | 'unavailable'
  command?: string
  resolvedPath?: string
  version?: string
  unavailableReason?: string
  auth: {
    state: 'configured' | 'not_detected' | 'not_required' | 'unknown'
    detectedBy?: 'environment' | 'cli'
    message?: string
    setupCommand?: string
  }
  models: Array<{ id: string; configured: boolean }>
  capabilities: {
    streaming: boolean
    tools: boolean
    mcp: boolean
    skills: boolean
    reasoningControls: boolean
    contextMetadata: boolean
    cancellation: boolean
    policyControls: 'native' | 'sandbox-only' | 'provider-defined'
  }
}

export interface LocalSessionSummary {
  provider: 'codex' | 'claude'
  sessionId: string
  path: string
  cwd?: string
  updatedAt: number
  version?: string
  originator?: string
  branch?: string
}

export interface ProjectFileEntry {
  path: string
  name: string
  kind: 'file' | 'directory' | 'symlink'
  size: number | null
  modifiedAt: number | null
  symlinkTarget?: string
}

export interface ProjectArtifactManifest {
  root: string
  generatedAt: number
  artifacts: Array<{
    kind: 'instruction' | 'skill' | 'agent' | 'documentation' | 'site'
    path: string
    name: string
    modifiedAt: number | null
    location: string
  }>
  counts: Record<'instruction' | 'skill' | 'agent' | 'documentation' | 'site', number>
  truncated: boolean
}

export interface ManagedArtifactArchive {
  archivedPath: string
  originalPath: string
  kind: 'agent' | 'skill'
  name: string
  archivedAt: number
  bytes: number
}

export interface LocalProjectClient {
  readonly supportsManagedArchives?: boolean
  registerProject?(projectId: string, root: string): Promise<{ projectId: string; root: string }>
  harnessCapabilities(): Promise<{ generatedAt: string; harnesses: HarnessCapability[] }>
  refreshHarnessCapabilities(): Promise<{ generatedAt: string; harnesses: HarnessCapability[] }>
  localSessions(provider?: LocalSessionSummary['provider']): Promise<LocalSessionSummary[]>
  listFiles(projectId: string, input?: { path?: string; limit?: number }): Promise<{
    root: string
    path: string
    entries: ProjectFileEntry[]
    truncated: boolean
  }>
  statFile(projectId: string, path: string): Promise<ProjectFileEntry & { root: string; readable: boolean }>
  readFile(projectId: string, path: string): Promise<{
    root: string
    path: string
    content: string
    bytes: number
    truncated: boolean
  }>
  writeManagedArtifact(projectId: string, input: { path: string; content: string }): Promise<{
    root: string
    path: string
    bytes: number
    modifiedAt: number
  }>
  archiveManagedArtifact(projectId: string, path: string): Promise<{
    root: string
    path: string
    archivedPath: string
    archivedAt: number
  }>
  listManagedArchives(projectId: string): Promise<ManagedArtifactArchive[]>
  restoreManagedArtifact(projectId: string, archivedPath: string): Promise<{
    root: string
    path: string
    archivedPath: string
    restoredAt: number
  }>
  searchFiles(projectId: string, query: string, limit?: number): Promise<{
    root: string
    query: string
    matches: Array<{ path: string; line: number; column: number; preview: string }>
    scannedFiles: number
    scannedBytes: number
    truncated: boolean
  }>
  rescan(projectId: string): Promise<ProjectArtifactManifest>
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
export type ResourceKind = 'organization' | 'project' | 'folder' | 'repository' | 'source' | 'tool' | 'workflow' | 'thread' | 'agent'
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
  scope?: 'once' | 'thread' | 'project' | 'organization'
  scopeId?: string
  usesRemaining?: number
  consumedAt?: number
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
  consume(grantId: string): Promise<PermissionGrant>
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
