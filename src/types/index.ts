export type Theme = 'dark' | 'light' | 'hc'
export type Visibility = 'private' | 'shared' | 'project'
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

export interface Member {
  id: string
  name: string
  initials: string
  role: 'Admin' | 'Editor' | 'Reviewer' | 'Viewer'
  email: string
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
}

export interface ToolCall {
  id: string
  name: string
  icon: string
  input: string
  output: string
  duration: string
  cost: string
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

export interface AgentRunBlock {
  id: string
  kind: 'coding' | 'research' | 'browser' | 'ops'
  title: string
  model: string
  harness: string
  runtime: string
  statusText: string
  done: boolean
  duration?: string
  tools: ToolCall[]
  plan: AgentPlanStep[]
  artifacts: Artifact[]
  cost?: string
}

export interface Message {
  id: string
  chatId: string
  role: MessageRole
  text: string
  createdAt: number
  routingNote?: string
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
  runtime: RuntimeKind
  tools: string[]
  knowledgeSourceIds: string[]
  interfaceId?: string
  visibility: Visibility
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
  status: 'Idle' | 'Running' | 'Stopped'
  os: string
  cpu: string
  network: string
  secrets: string
  packages: string[]
  idleTimeout: string
  cost: string
  mounts?: string
  region?: string
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
