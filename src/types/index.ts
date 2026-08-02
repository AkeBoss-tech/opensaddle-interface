export type Theme = 'dark' | 'light' | 'liquid' | 'hc'
export type Visibility = 'private' | 'shared' | 'project'
export type PresenceState = 'online' | 'away' | 'offline'
export type DirectMessagePrincipalKind = 'human' | 'agent'
export type Inheritance = 'org' | 'parent' | 'override' | 'denied'
export type Harness = 'chat' | 'research' | 'coding' | 'browser' | 'vm'
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
export type ModelKey = 'auto' | 'gpt' | 'claude' | 'sonnet' | 'gemini' | 'llama'
export type InterfaceKind = 'chat' | 'form' | 'dashboard' | 'document' | 'custom'
export type TaskType = 'now' | 'scheduled' | 'background' | 'monitor'
export type RunStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'paused'
export type MessageRole = 'user' | 'assistant' | 'system'
export type EntityKind = 'user' | 'agent' | 'artifact' | 'thread' | 'run' | 'skill' | 'project'
export type ActionabilityState = 'blocked' | 'actionable' | 'claimed' | 'in-progress' | 'done'

/** Read-only evidence collected by the desktop process before a workspace exists. */
export interface WorkspaceScanSnapshot {
  folderPath: string
  folderName: string
  directories: string[]
  configPaths: string[]
  packageScripts: string[]
  makefile: string | null
  envExamplePaths: string[]
  git: {
    readable: boolean
    reason?: string
    branches: string[]
    commitCount: number
    /** Commits touching each top-level directory, so channel provenance is specific. */
    directoryCommitCounts?: Record<string, number>
    authors: Array<{ name: string; email: string; commitCount: number }>
    hasRemote: boolean
  }
}

export interface WorkspaceProposalItem {
  id: string
  label: string
  provenance: string
  recommended: boolean
}

export interface WorkspaceChannelProposal extends WorkspaceProposalItem {
  kind: 'directory' | 'branch'
}

/** Git identities are intentionally proposal-only and individually deselectable. */
export interface WorkspaceMemberProposal extends WorkspaceProposalItem {
  name: string
  email: string
  commitCount: number
  deselectable: true
}

export interface WorkspaceAgentProposal extends WorkspaceProposalItem {
  harness: 'claude' | 'codex' | 'cursor' | 'opensaddle'
  triggerPath: string
}

export interface WorkspacePermissionProposal extends WorkspaceProposalItem {
  scope: 'workspace-write' | 'secret-handling' | 'repository-read' | 'run-tests'
  needsApproval: boolean
}

/** A disposable projection of a folder. Applying it is a separate, explicit action. */
export interface WorkspaceProposal {
  id: string
  folderPath: string
  label: string
  channels: WorkspaceChannelProposal[]
  members: WorkspaceMemberProposal[]
  agents: WorkspaceAgentProposal[]
  permissions: WorkspacePermissionProposal[]
  memberAnalysis: {
    source: 'git log'
    reason: string
  }
  notes: string[]
}

/** A source-backed artifact attached to a message or rendered in an unfurl. */
export interface ArtifactRef {
  id: string
  provider: string
  kind: string
  title: string
  state: ActionabilityState
  fetchedAt: number
  degraded?: boolean
}

/** A durable, typed link from a message to a substrate entity. */
export interface EntityReference {
  kind: EntityKind
  id: string
  label: string
}
export type LocalSandboxMode = 'read-only' | 'workspace-write' | 'full-access'
export type LocalApprovalMode = 'always' | 'on-request' | 'never'
export type RunExecutionMode = 'plan' | 'review' | 'project' | 'full-access'

export interface AgentPermissionPolicy {
  sandbox: LocalSandboxMode
  approvals: LocalApprovalMode
  network: boolean
  allowedTools: string[]
  deniedTools: string[]
}

export interface LocalHarnessDefinition {
  id: string
  label: string
  command: string
  description: string
  protocol?: 'cli' | 'acp'
  promptMode: 'final_arg' | 'flag' | 'stdin'
  promptFlag?: string
  args: string[]
  modelFlag?: string
  /** CLI-native model ids offered by this project-local harness. */
  models?: string[]
  supportsStreaming: boolean
}

export interface LocalSkillDefinition {
  id: string
  name: string
  description: string
  path: string
  enabled: boolean
}

export interface LocalProjectDocument {
  id: string
  title: string
  path: string
  status: 'detected' | 'generated' | 'stale'
  updatedAt: number
}

export interface LocalProjectSettings {
  rootPath: string
  importedFrom: 'folder' | 'codex' | 'claude' | 'cursor' | 'other'
  importedAt: number
  defaultHarnessId: string
  permissionPreset: 'read-only' | 'workspace-write' | 'full-access' | 'custom'
  adminAccess: true
  detectedConfigs: string[]
  harnesses: LocalHarnessDefinition[]
  skills: LocalSkillDefinition[]
  documents: LocalProjectDocument[]
}

export interface Member {
  id: string
  name: string
  initials: string
  role: 'Admin' | 'Editor' | 'Reviewer' | 'Viewer'
  email: string
  presence?: PresenceState
}

export interface Project {
  id: string
  name: string
  parentId: string | null
  description: string
  iconColor: string
  knowledgeCount: number
  serviceCount: number
  childCount: number
  autoConfidence: number
  lineage: string[]
  workspaceKind?: 'enterprise' | 'local'
  local?: LocalProjectSettings
  routingDefaults?: {
    modelKey: ModelKey
    providerKey: CodingProvider
    runtimeKey: RuntimeKind
    reviewProviderKey?: CodingProvider
  }
}

export interface PinnedArtifact {
  kind: 'project' | 'site' | 'wiki'
  id: string
}

export interface Chat {
  id: string
  projectId: string
  title: string
  visibility: Visibility
  createdAt: number
  updatedAt: number
  branchedFromId?: string
  sharedWith: string[]
  archived?: boolean
  agentId?: string
  /** The principal at the other end of a one-to-one direct message. */
  directMessageWith?: {
    kind: DirectMessagePrincipalKind
    id: string
  }
  /** Projected unread messages for a direct-message row. */
  unreadCount?: number
  runConfig?: {
    auto: boolean
    providerKey: CodingProvider
    modelKey: ModelKey | 'auto'
    harnessKey: Harness | 'auto'
    runtimeKey: RuntimeKind | 'auto'
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
    /** Provider checkpoint used for an exact historical fork when supported. */
    checkpointId?: string
  }
}

export interface ToolCall {
  id: string
  name: string
  icon: string
  input: string
  output: string
  duration: string
  cost: string
  status?: 'running' | 'success' | 'error'
}

export interface DiffHunk {
  id: string
  range: string
  lines: Array<{ t: 'ctx' | 'add' | 'del'; n: string; c: string }>
  status?: 'accepted' | 'rejected'
}

export interface DiffFile {
  path: string
  add: number
  del: number
  hunks: DiffHunk[]
}

export interface Artifact {
  id: string
  type: 'diff' | 'report' | 'table' | 'preview'
  title: string
  subtitle?: string
  diff?: DiffFile[]
  reportHtml?: string
  table?: { headers: string[]; rows: string[][] }
}

export interface AgentPlanStep {
  label: string
  status: 'pending' | 'active' | 'done'
}

export interface AgentActivityEntry {
  id: string
  kind: 'status' | 'tool' | 'change' | 'check' | 'review' | 'error'
  label: string
  detail?: string
  timestamp: string
}

export interface RunSourceRef {
  id: string
  kind: 'file' | 'repository' | 'attachment' | 'connector' | 'web'
  label: string
  detail?: string
}

export interface ProviderSubagentState {
  id: string
  type: string
  status: 'running' | 'completed' | 'failed'
  statusText: string
  lastTool?: string
  output?: string
}

export interface AgentRunBlock {
  id: string
  parentRunId?: string
  executionMode?: RunExecutionMode
  /** Canonical provider-native session to use for the next turn. A forked
   * run replaces its source ID with the newly created child session. */
  providerSessionId?: string
  providerSessionMode?: 'resume' | 'fork'
  providerTurnId?: string
  providerKey?: CodingProvider
  /** Whether the local daemon still owns the active harness process. */
  runtimeAttached?: boolean
  kind: 'coding' | 'research' | 'browser' | 'ops'
  title: string
  model: string
  reasoningEffort?: string
  harness: string
  runtime: string
  statusText: string
  /** User-authored prompt for a durable follow-up that has not started yet. */
  queuedTask?: string
  /** Exact transcript message that owns the queued prompt. */
  queuedPromptMessageId?: string
  /** Human-readable agent narration. This is kept alongside structured run
   * state so mock, restored, and remote runs all have a visible transcript. */
  output?: string
  done: boolean
  duration?: string
  tools: ToolCall[]
  plan: AgentPlanStep[]
  artifacts: Artifact[]
  /** Bounded, persisted event history used by the conversation and state rail. */
  activity?: AgentActivityEntry[]
  /** Sources actually observed in this run, distinct from project availability. */
  sources?: RunSourceRef[]
  /** Provider-native delegated work (for example Claude Code Agent tasks) that
   * does not have a separate OpenSaddle child run. */
  providerSubagents?: ProviderSubagentState[]
  inputRequest?: {
    kind: 'clarification' | 'approval'
    id?: string
    prompt: string
    detail?: string
    questions?: Array<{
      id: string
      header?: string
      prompt: string
      options?: Array<{ label: string; description?: string }>
      multiSelect?: boolean
      allowOther?: boolean
      secret?: boolean
    }>
    availableDecisions?: string[]
  }
  /** Last durable runtime event folded into this run; used for safe reattach. */
  lastSequence?: number
  cost?: string
  usage?: {
    inputTokens?: number
    cachedInputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    totalTokens?: number
    contextWindow?: number
    contextPercent?: number
  }
  warnings?: Array<{
    message: string
    severity?: string
  }>
  /** A provider-agnostic recovery hint derived from the native harness failure. */
  failure?: {
    kind: 'authentication' | 'permission' | 'harness' | 'context' | 'interrupted' | 'runtime'
    title: string
    message: string
    recovery: string
    retryable: boolean
  }
}

export interface Message {
  id: string
  chatId: string
  role: MessageRole
  text: string
  /**
   * Who wrote this. A member id for `user` messages, an agent id for
   * `assistant` ones. Without it a channel can only ever attribute messages to
   * the viewer, which is why multi-person transcripts used to be hardcoded.
   */
  authorId?: string
  /** Entity links are data, never inferred by re-parsing message prose. */
  references?: EntityReference[]
  /** External artifacts unfurled beneath the message body. */
  artifactRefs?: ArtifactRef[]
  createdAt: number
  routingNote?: string
  /** Durable server run projected through this conversation message. */
  runtimeRunId?: string
  run?: AgentRunBlock
  lightHtml?: string
}

export interface CustomAgent {
  id: string
  projectId: string
  name: string
  description: string
  systemPrompt: string
  modelPolicy: ModelKey
  harness: Harness
  /** Runtime provider/profile used by local coding agents. Built-ins use
   * codex/claude/cursor/etc.; custom profiles use their project-local id. */
  harnessId?: string
  /** Project-relative source for file-backed local agents. OpenSaddle owns
   * lifecycle actions only for definitions under `.opensaddle/agents`. */
  definitionPath?: string
  runtime: RuntimeKind
  permissionPolicy?: AgentPermissionPolicy
  skillIds?: string[]
  tools: string[]
  knowledgeSourceIds: string[]
  interfaceId?: string
  visibility: Visibility
  presence?: PresenceState
  createdAt: number
}

export interface SitePage {
  id: string
  title: string
  body: string
  agentRail: boolean
  eyebrow?: string
  ctaLabel?: string
  ctaUrl?: string
  sections?: Array<{ id: string; title: string; body: string }>
}

export interface SiteVersion {
  id: string
  label: string
  summary: string
  status: 'draft' | 'published' | 'archived'
  createdAt: number
  createdBy: string
  snapshot?: {
    name: string
    description: string
    accent: string
    pages: SitePage[]
    agentId?: string
    agentPlacement: 'bubble' | 'rail'
  }
}

export interface Site {
  id: string
  projectId: string
  name: string
  description: string
  slug: string
  accent: string
  pages: SitePage[]
  versions: SiteVersion[]
  publishedVersionId?: string
  agentId?: string
  agentPlacement: 'bubble' | 'rail'
  visibility: Visibility
  createdAt: number
  updatedAt: number
}

export interface ApiField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date'
}

export interface ApiRecord {
  id: string
  data: Record<string, string | number | boolean>
}

export interface QuickApi {
  id: string
  projectId: string
  name: string
  description: string
  path: string
  fields: ApiField[]
  records: ApiRecord[]
  transformScript: string
  visibility: Visibility
  runHistory: Array<{ at: number; action: string; detail: string }>
  createdAt: number
}

export interface DashboardWidget {
  id: string
  type: 'kpi' | 'chart' | 'table'
  title: string
  value?: string
  delta?: string
  chartBars?: number[]
  table?: { headers: string[]; rows: string[][] }
}

export interface Dashboard {
  id: string
  projectId: string
  name: string
  description: string
  widgets: DashboardWidget[]
  visibility: Visibility
  createdAt: number
}

export interface AgentInterface {
  id: string
  projectId: string
  name: string
  kind: InterfaceKind
  description: string
  layout: {
    showChat: boolean
    showForm: boolean
    showMetrics: boolean
    showDocument: boolean
    formFields?: string[]
    heroTitle?: string
  }
  agentId?: string
  visibility: Visibility
  createdAt: number
}

export interface KnowledgeSource {
  id: string
  projectId: string
  name: string
  kind: string
  status: 'Indexed' | 'Live' | 'Partial' | 'Error'
  items: number
  lastSync: string
  sensitivity: 'Public' | 'Internal' | 'Restricted'
  owner: string
}

export interface ServiceConn {
  id: string
  projectId: string
  name: string
  logo: string
  status: string
  subtitle: string
}

export interface CapabilityRow {
  capability: string
  value: string
  source: Inheritance
  sourceLabel: string
}

export interface Task {
  id: string
  projectId: string
  name: string
  type: TaskType
  schedule: string
  harness: string
  status: RunStatus | 'active' | 'paused' | 'armed'
  trigger?: string
  action?: string
  approval?: string
  progress?: number
  timeline?: Array<{ time: string; title: string; detail: string; kind?: string }>
}

export interface Environment {
  id: string
  name: string
  subtitle: string
  kind: RuntimeKind
  status: 'Idle' | 'Provisioning' | 'Running' | 'Stopped'
  os: string
  cpu: string
  network: string
  secrets: string
  packages: string[]
  idleTimeout: string
  cost: string
  mounts?: string
  region?: string
  taskId?: string
}

export interface Plugin {
  id: string
  name: string
  publisher: string
  category: 'developer' | 'data' | 'productivity' | 'sales' | 'harness' | 'model' | 'template'
  description: string
  logo: string
  installed: boolean
  rating: string
  projects: number
  type: 'tool' | 'connector' | 'harness' | 'model' | 'skill' | 'template' | 'runtime'
}

export interface NotificationItem {
  id: string
  title: string
  body: string
  at: number
  read: boolean
  href?: string
}

export interface UsageDay {
  label: string
  gpt: number
  claude: number
  gemini: number
}

export interface Budget {
  id: string
  name: string
  used: number
  limit: number
}

export interface WikiSummary {
  id: string
  projectId: string
  scope: 'team' | 'member'
  memberId?: string
  headline: string
  overview: string
  highlights: string[]
  blockers: string[]
  sourceIds: string[]
  updatedAt: number
}

export interface WikiSettings {
  individualSummariesEnabled: boolean
  selectedProjectId: string
  refreshCadence: 'manual' | 'daily' | 'weekly'
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

export interface ProjectFolder {
  id: string
  projectId: string
  name: string
  path: string
  description: string
}

export interface ProjectSource {
  id: string
  projectId: string
  kind: 'github' | 'jira' | 'slack' | 'sharepoint' | 'drive'
  name: string
  externalId: string
  url?: string
  status: 'connected' | 'error' | 'pending'
  branch?: string
  folderPath?: string
  lastSyncAt: number
}

export interface WorkflowDef {
  id: string
  projectId: string
  name: string
  description: string
  trigger: 'manual' | 'cron' | 'webhook' | 'source_event'
  schedule?: string
  agentIds: string[]
  steps: Array<{ id: string; label: string; kind: string }>
  status: 'active' | 'paused' | 'draft'
  approvalRequired: boolean
  budgetLimit?: number
  lastRunAt?: number
  createdAt: number
}

export interface WorkflowRun {
  id: string
  workflowId: string
  projectId: string
  ownerId?: string
  agentId?: string
  status: RunStatus
  startedAt: number
  finishedAt?: number
  summary: string
}

export interface AgentSession {
  id: string
  agentId: string
  projectId: string
  status: 'idle' | 'running' | 'waiting' | 'paused'
  harness: string
  model: string
  startedAt: number
  title: string
}

export interface SettingsState {
  theme: Theme
  displayName: string
  email: string
  timezone: string
  routingPref: 'quality' | 'fast' | 'cost' | 'local' | 'enterprise'
  askAboveCost: number
  enterpriseModelsOnly: boolean
  keepDataLocal: boolean
  notifications: {
    email: boolean
    desktop: boolean
    budgetAlerts: boolean
    permissionRequests: boolean
    runFailures: boolean
  }
  retentionDays: number
  toolRetentionDays: number
  region: string
  trainingDisabled: boolean
  approvedModels: ModelKey[]
  ssoEnabled: boolean
  scimEnabled: boolean
  piiRestricted: boolean
  networkPolicy: string
  demoMode: boolean
}

export interface AppData {
  version: number
  workspaceName: string
  currentUserId: string
  members: Member[]
  projects: Project[]
  chats: Chat[]
  messages: Message[]
  agents: CustomAgent[]
  sites: Site[]
  apis: QuickApi[]
  dashboards: Dashboard[]
  interfaces: AgentInterface[]
  knowledge: KnowledgeSource[]
  services: ServiceConn[]
  capabilities: Record<string, CapabilityRow[]>
  tasks: Task[]
  environments: Environment[]
  plugins: Plugin[]
  notifications: NotificationItem[]
  usageDays: UsageDay[]
  budgets: Budget[]
  wikiSummaries: WikiSummary[]
  wikiSettings: WikiSettings
  permissionGrants: PermissionGrant[]
  folders: ProjectFolder[]
  sources: ProjectSource[]
  workflows: WorkflowDef[]
  workflowRuns: WorkflowRun[]
  agentSessions: AgentSession[]
  settings: SettingsState
  recentChatIds: string[]
  pinnedArtifacts?: PinnedArtifact[]
  activeProjectId: string
  activeChatId: string | null
}
