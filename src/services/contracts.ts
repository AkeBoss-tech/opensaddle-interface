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
  | 'agent.steered'
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
  | 'agent.cancelled'
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
  reasoningEffort?: string
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
  threadId?: string
  sourceMessageId?: string
  assistantMessageId?: string
  task: string
  agentId?: string
  parentRunId?: string
  retryOfRunId?: string
  retryCheckpointId?: string
  queuedAfterRunId?: string
  status: 'queued' | 'provisioning' | 'running' | 'waiting' | 'awaiting_input' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'timed_out'
  /** Whether the authoritative daemon still owns a live harness process. */
  attached?: boolean
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

/** A server-registered view that is visible within one Project. */
export interface RegisteredSurface {
  id: string
  projectId: string
  title: string
}

export interface WorkflowDefinition {
  workflowId: string
  name: string
  status: 'active' | 'paused'
  version: number
  concurrencyLimit: number
  trigger: Record<string, unknown>
  task: Record<string, unknown>
  budgetPolicy: Record<string, unknown>
  permissionPolicy: Record<string, unknown>
  approvalPolicy: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface WorkflowExecution {
  executionId: string
  workflowId: string
  workflowVersion: number
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  triggerKey?: string
  triggerPayload: Record<string, unknown>
  retryOfExecutionId?: string
  attempt: number
  workerId?: string
  cancellationReason?: string
  result?: Record<string, unknown>
  queuedAt: number
  startedAt?: number
  finishedAt?: number
}

export interface WorkflowTimelineEvent {
  timelineId: number
  eventType: string
  data: Record<string, unknown>
  recordedAt: number
}

export interface WorkflowClient {
  list(): Promise<WorkflowDefinition[]>
  executions(input?: {
    workflowId?: string
    statuses?: WorkflowExecution['status'][]
    limit?: number
  }): Promise<WorkflowExecution[]>
  pause(workflowId: string): Promise<WorkflowDefinition>
  resume(workflowId: string): Promise<WorkflowDefinition>
  trigger(workflowId: string): Promise<WorkflowExecution>
  cancel(executionId: string, reason?: string): Promise<WorkflowExecution>
  retry(executionId: string): Promise<WorkflowExecution>
  timeline(executionId: string): Promise<WorkflowTimelineEvent[]>
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
    reasoningEffort?: string
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
  }): Promise<RouteEstimate>
  startRun(input: {
    projectId: string
    threadId?: string
    sourceMessageId?: string
    assistantMessageId?: string
    task: string
    agentId?: string
    agentDefinitionPath?: string
    skillPaths?: string[]
    parentRunId?: string
    sourceIds?: string[]
    providerSessionId?: string
    providerSessionMode?: 'resume' | 'fork'
    providerTurnId?: string
    modelKey?: ModelKey
    modelId?: string
    reasoningEffort?: string
    harnessKey?: Harness
    providerKey?: CodingProvider
    runtimeKey?: RuntimeKind
    executionMode?: RunExecutionMode
    capabilityIds?: string[]
    repo?: string
    approvalId?: string
    reviewProviderKey?: CodingProvider
  }): Promise<{
    runId: string
    sessionId: string
    threadId?: string
    sourceMessageId?: string
    assistantMessageId?: string
    mode?: string
    route?: RouteEstimate
  }>
  listRuns?(): Promise<RuntimeRunSummary[]>
  listSurfaces?(projectId?: string): Promise<RegisteredSurface[]>
  subscribe(runId: string, onEvent: (event: SessionEvent) => void, onError?: (error: Error) => void): () => void
  cancel(runId: string): Promise<void>
  pause(runId: string): Promise<void>
  resume(runId: string): Promise<void>
  retry(runId: string): Promise<{
    runId: string
    sessionId: string
    threadId?: string
    sourceMessageId?: string
    assistantMessageId?: string
    parentRunId?: string
    route?: RouteEstimate
  }>
  steer(runId: string, text: string): Promise<void>
  queue(runId: string, text: string): Promise<{
    runId: string
    sessionId: string
    threadId?: string
    sourceMessageId?: string
    assistantMessageId?: string
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
    reasoningEffort?: string
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
  models: Array<{
    id: string
    configured: boolean
    displayName?: string
    description?: string
    isDefault?: boolean
    source?: 'account' | 'cli_alias' | 'configured'
    reasoningEfforts?: string[]
    defaultReasoningEffort?: string
    inputModalities?: string[]
  }>
  capabilities: {
    streaming: boolean
    tools: boolean
    mcp: boolean
    skills: boolean
    reasoningControls: boolean
    reasoningEfforts?: string[]
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

export interface ProjectSessionSummary {
  projectId: string
  root: string
  inspectionMode: 'metadata_only'
  sessions: LocalSessionSummary[]
  availableActions: Array<'resume' | 'fork'>
  authorityModes: Array<'source_managed' | 'opensaddle_managed' | 'hybrid'>
}

export type ProjectMemoryState = 'not_configured' | 'initializing' | 'indexing' | 'ready' | 'degraded' | 'invalid' | 'failed'
export type ProjectMemoryOperationKind = 'initialize' | 'doctor' | 'reindex'
export type ProjectMemoryOperationStage = 'registering' | 'initializing' | 'indexing' | 'ready' | 'failed'

export interface ProjectMemorySource {
  id: string
  label: string
  path?: string
  kind: string
  status: 'pending' | 'indexed' | 'stale' | 'failed' | 'excluded'
  indexedItems: number
  lastIndexedAt?: string
  error?: string
}

export interface ProjectMemoryOperation {
  operationId: string
  projectId: string
  kind: ProjectMemoryOperationKind
  stage: ProjectMemoryOperationStage
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  createdAt: string
  updatedAt: string
  retryable: boolean
  message?: string
  error?: string
}

export interface ProjectMemoryStatus {
  projectId: string
  provider: 'krail'
  detected: boolean
  authority: 'backend'
  inspectionMode: 'read_only' | 'managed'
  root: string
  status: ProjectMemoryState
  manifestPath?: string
  manifestVersion?: string | number
  error?: string
  retryable?: boolean
  project?: {
    name?: string
    slug?: string
    description?: string
    mode?: string
  }
  runtime: {
    installed: boolean
    version?: string | null
    cliAvailable: boolean
  }
  workspace?: {
    collections: Array<{
      kind: string
      path: string
      exists: boolean
      fileCount: number
      truncated: boolean
    }>
  }
  capabilities: Array<{
    id: string
    mode: 'read' | 'effectful'
    enabled: boolean
  }>
  mcp?: {
    transport: 'stdio'
    command: string
    args: string[]
    available: boolean
  }
  workflowBridge?: {
    format: string
    claudeImportSupported: boolean
    executionRequiresExplicitAction: boolean
  }
  health?: {
    status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
    checkedAt?: string
    summary?: string
    issues: Array<{ code: string; message: string; retryable: boolean }>
  }
  integrity?: {
    status: 'verified' | 'warning' | 'failed' | 'unknown'
    checkedAt?: string
    summary?: string
  }
  sources?: ProjectMemorySource[]
  lastOperation?: ProjectMemoryOperation
}

/** @deprecated Use ProjectMemoryStatus. Kept for clients compiled against the read-only bridge. */
export type KrailKnowledgeStatus = ProjectMemoryStatus

export interface ProjectMemoryInitPlan {
  projectId: string
  planId: string
  state: 'already_configured' | 'not_configured' | 'repair_required'
  root: string
  summary: string
  effects: Array<{
    id: string
    kind: 'create' | 'update' | 'index' | 'register' | 'command'
    target: string
    description: string
  }>
  warnings: string[]
  canApply: boolean
}

export interface ProjectMemoryDoctorResult {
  projectId: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  checkedAt: string
  checks: Array<{ id: string; label: string; status: 'passed' | 'warning' | 'failed'; detail?: string }>
  operation?: ProjectMemoryOperation
}

export interface ProjectMemoryContextBrief {
  projectId: string
  query: string
  briefDigest?: string
  summary: string
  evidence: Array<{
    id: string
    sourceId: string
    title: string
    path?: string
    excerpt: string
    locator?: string
  }>
  gaps: string[]
  truncated: boolean
  maxItems: number
  maxTotalBytes: number
}

export interface ProjectMemoryCandidate {
  candidateId: string
  kind: 'source' | 'claim' | 'artifact'
  title: string
  summary: string
  status: 'candidate' | 'proposed' | 'promoted' | 'rejected'
  sourceIds: string[]
  createdAt: string
  reviewedAt?: string
  reviewReason?: string
  proposal?: { proposalId?: string; protectedInputDigest?: string; status?: string } | null
}

export interface ProjectMemoryCandidateReview {
  candidateId: string
  decision: 'promote' | 'reject'
  reason?: string
}

export type ProjectOnboardingRunner = 'codex_cli' | 'claude_code'
export type ProjectOnboardingStatus =
  | 'not_prepared'
  | 'ready'
  | 'running'
  | 'approval_required'
  | 'committed'
  | 'applied'
  | 'failed'
  | 'interrupted'

export interface ProjectOnboardingEvidence {
  path: string
  revision?: string | null
  span?: { startLine: number; endLine: number }
  digest?: string
}

export interface ProjectOnboardingVerification {
  name: string
  command: string
  evidence: string[]
  timeoutSeconds?: number
}

export interface ProjectOnboardingRecommendationOption {
  recommendationId: string
  kind: 'proposal_generation' | 'project_action'
  title: string
  summary: string
  instruction: string
  allowedPaths: string[]
  verification: ProjectOnboardingVerification[]
  commitMessage: string
}

export interface ProjectOnboardingClaim {
  text: string
  evidence: ProjectOnboardingEvidence[]
}

export interface ProjectOnboardingReviewedProposal {
  contract: 'krail.project-profile/v1' | 'krail.automation-recommendations/v1'
  summary?: string
  claims: ProjectOnboardingClaim[]
  review: {
    status: 'proposed' | 'accepted' | 'rejected'
    reviewedBy?: string
  }
}

export interface ProjectOnboardingProfile extends ProjectOnboardingReviewedProposal {
  contract: 'krail.project-profile/v1'
}

export interface ProjectOnboardingAutomationRecommendations extends ProjectOnboardingReviewedProposal {
  contract: 'krail.automation-recommendations/v1'
}

export interface ProjectOnboardingDiscovery {
  contract: 'krail.project-discovery/v1'
  root: string
  mode: 'onboard' | 'refresh'
  fingerprint: string
  languages: string[]
  fileCount: number
  repository?: {
    kind?: 'git' | 'directory'
    revision?: string | null
    dirty?: boolean
  }
  commands: Array<{
    command: string
    kind: string
    evidence: ProjectOnboardingEvidence[]
  }>
}

export interface ProjectOnboardingState {
  contract: 'opensaddle.project-onboarding/v1'
  projectId: string
  status: ProjectOnboardingStatus
  runner?: ProjectOnboardingRunner | null
  fingerprint?: string | null
  discovery?: ProjectOnboardingDiscovery | null
  profile?: ProjectOnboardingProfile | null
  automationRecommendations?: ProjectOnboardingAutomationRecommendations | null
  recommendationOptions: ProjectOnboardingRecommendationOption[]
  activeRunId?: string | null
  executionHead?: string | null
  executionReady: boolean
  executionBarriers: ProjectOnboardingReadinessCheck[]
  refreshRequired: boolean
  error?: string | null
}

export type ProjectOnboardingReadinessCheck =
  | 'registered_project'
  | 'root_exists'
  | 'git_repository'
  | 'git_head'
  | 'git_clean'
  | 'runner_executable'
  | 'runner_authenticated'
  | 'krail_discovery'
  | 'state_root_external'
  | 'source_has_no_opensaddle_state'
  | 'state_root_writable'

export interface ProjectOnboardingReadiness {
  contract: 'opensaddle.onboarding-readiness/v1'
  projectId: string
  runner: ProjectOnboardingRunner
  ready: boolean
  discoveryReady: boolean
  executionReady: boolean
  discoveryBarriers: ProjectOnboardingReadinessCheck[]
  executionBarriers: ProjectOnboardingReadinessCheck[]
  informationalChecks: ProjectOnboardingReadinessCheck[]
  checks: Record<ProjectOnboardingReadinessCheck, boolean>
  root: string
  head?: string | null
  runnerPath?: string | null
  harness: {
    id: string
    installed: boolean
    readiness?: string | null
    loginGuidance?: string | null
  }
  state: {
    database: string
    worktrees: string
    receipts: string
    episodes: string
  }
  error?: string | null
  isolation: 'detached_git_worktree_only'
  warning: string
  warnings: string[]
}

export interface ProjectOnboardingActivity {
  kind: string
  label: string
  detail?: string
  timestamp?: string
}

export interface ProjectOnboardingChange {
  contract:
    | 'opensaddle.onboarding-change-proposal/v1'
    | 'opensaddle.onboarding-change-receipt/v1'
  projectId?: string
  runId: string
  recommendationId?: string
  fingerprint?: string
  status:
    | 'running'
    | 'approval_required'
    | 'committed'
    | 'verification_failed'
    | 'rejected'
    | 'applied'
    | 'failed'
    | 'interrupted'
  diffDigest?: string | null
  changedFiles: string[]
  patch?: string | null
  verification: ProjectOnboardingVerification[]
  activity: ProjectOnboardingActivity[]
  checks: Array<{ name: string; passed: boolean; exitCode?: number | null }>
  profile?: ProjectOnboardingProfile | null
  automationRecommendations?: ProjectOnboardingAutomationRecommendations | null
  recommendationOptions: ProjectOnboardingRecommendationOption[]
  commit?: string | null
  ref?: string | null
  baseCommit?: string | null
  author?: { name: string; email: string } | null
  recommendationKind?: ProjectOnboardingRecommendationOption['kind']
  summary?: string | null
  error?: string | null
  recoverable?: boolean
}

export interface ProjectOnboardingDiff {
  contract: 'opensaddle.onboarding-diff/v1'
  runId: string
  diffDigest: string
  changedFiles: string[]
  patch: string
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

export interface RegisteredLocalProject {
  projectId: string
  root: string
  createdAt: number
}

export interface LocalProjectClient {
  readonly supportsManagedArchives?: boolean
  registerProject?(projectId: string, root: string): Promise<{ projectId: string; root: string }>
  listProjects?(): Promise<RegisteredLocalProject[]>
  harnessCapabilities(): Promise<{ generatedAt: string; harnesses: HarnessCapability[] }>
  refreshHarnessCapabilities(): Promise<{ generatedAt: string; harnesses: HarnessCapability[] }>
  localSessions(provider?: LocalSessionSummary['provider']): Promise<LocalSessionSummary[]>
  projectSessions?(projectId: string, provider?: LocalSessionSummary['provider']): Promise<ProjectSessionSummary>
  memoryStatus?(projectId: string): Promise<ProjectMemoryStatus>
  memoryInitPlan?(projectId: string, input?: { root?: string }): Promise<ProjectMemoryInitPlan>
  memoryInitApply?(projectId: string, planId: string): Promise<ProjectMemoryOperation>
  memoryDoctor?(projectId: string): Promise<ProjectMemoryDoctorResult>
  memoryReindex?(projectId: string): Promise<ProjectMemoryOperation>
  memoryOperation?(projectId: string, operationId: string): Promise<ProjectMemoryOperation>
  memoryContextBrief?(projectId: string, input: { query: string; maxItems?: number; maxTotalBytes?: number }): Promise<ProjectMemoryContextBrief>
  memoryCandidates?(projectId: string): Promise<ProjectMemoryCandidate[]>
  reviewMemoryCandidate?(projectId: string, review: ProjectMemoryCandidateReview): Promise<ProjectMemoryCandidate>
  onboardingState?(projectId: string): Promise<ProjectOnboardingState>
  onboardingReadiness?(projectId: string, runner: ProjectOnboardingRunner): Promise<ProjectOnboardingReadiness>
  prepareOnboarding?(projectId: string, input: { runner: ProjectOnboardingRunner }): Promise<ProjectOnboardingState>
  startOnboardingRecommendation?(projectId: string, input: { recommendationId: string; model?: string }): Promise<ProjectOnboardingChange>
  onboardingChange?(projectId: string, runId: string): Promise<ProjectOnboardingChange>
  onboardingDiff?(projectId: string, runId: string): Promise<ProjectOnboardingDiff>
  approveOnboardingChange?(projectId: string, runId: string, input: {
    approvedBy: string
    expectedDiffDigest: string
  }): Promise<ProjectOnboardingChange>
  rejectOnboardingChange?(projectId: string, runId: string, input: {
    rejectedBy: string
    reason?: string
  }): Promise<ProjectOnboardingChange>
  applyOnboardingCommit?(projectId: string, runId: string, input: {
    appliedBy: string
    expectedHead: string
    expectedCommit: string
  }): Promise<ProjectOnboardingChange>
  /** @deprecated Compatibility alias for the former read-only knowledge bridge. */
  knowledgeStatus?(projectId: string): Promise<KrailKnowledgeStatus>
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
