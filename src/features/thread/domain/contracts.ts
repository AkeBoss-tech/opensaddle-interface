import type {
  AgentRunBlock,
  AgentSession,
  Artifact,
  Chat,
  DiffFile,
  MessageRole,
  Project,
  RunStatus,
  Task,
  ToolCall,
  Visibility,
  WorkflowRun,
} from '../../../types'

export type ThreadId = string
export type TurnId = string
export type ThreadRunId = string

export type ThreadStatus =
  | 'draft'
  | 'planning'
  | 'ready_to_run'
  | 'running'
  | 'needs_input'
  | 'needs_approval'
  | 'blocked'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'stopped'

export type NormalizedRunStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'needs_input'
  | 'needs_approval'
  | 'blocked'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'paused'

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped'

export interface PlanItem {
  id: string
  label: string
  status: PlanItemStatus
  position: number
}

export type ActivityKind =
  | 'status'
  | 'tool'
  | 'approval'
  | 'input'
  | 'review'
  | 'verification'
  | 'error'

export interface ActivityItem {
  id: string
  runId: ThreadRunId
  threadId: ThreadId
  turnId: TurnId
  kind: ActivityKind
  title: string
  detail?: string
  timestamp?: number
  duration?: string
  cost?: string
  isError: boolean
}

export interface EvidenceMetric {
  label: string
  value: string | number
}

interface EvidenceBase {
  id: string
  runId: ThreadRunId
  threadId: ThreadId
  turnId: TurnId
  title: string
  subtitle?: string
  metrics: EvidenceMetric[]
}

export interface ChangesEvidence extends EvidenceBase {
  kind: 'changes'
  artifactId: string
  files: DiffFile[]
}

export interface ChecksEvidence extends EvidenceBase {
  kind: 'checks'
  artifactId: string
  headers: string[]
  rows: string[][]
  passed?: boolean
}

export interface ArtifactEvidence extends EvidenceBase {
  kind: 'artifact'
  artifactId: string
  artifactType: Artifact['type']
  artifact: Artifact
}

export interface CostEvidence extends EvidenceBase {
  kind: 'cost'
  cost: string
}

export type EvidenceItem = ChangesEvidence | ChecksEvidence | ArtifactEvidence | CostEvidence

/**
 * Durable presentation linkage for a run embedded in a legacy assistant message.
 * `id` is namespaced by its owner, while `sourceRunId` retains the runtime's ID.
 */
export interface RunRecord {
  id: ThreadRunId
  sourceRunId: string
  threadId: ThreadId
  turnId: TurnId
  messageId: string
  projectId: string
  createdAt: number
  kind: AgentRunBlock['kind']
}

export interface RunRoutePresentation {
  model: string
  harness: string
  runtime: string
  routingNote?: string
}

export interface RunPresentation extends RunRecord {
  title: string
  status: NormalizedRunStatus
  statusLabel: string
  isTerminal: boolean
  duration?: string
  cost?: string
  route: RunRoutePresentation
  plan: PlanItem[]
  activity: ActivityItem[]
  evidence: EvidenceItem[]
  tools: ToolCall[]
  artifactCount: number
  changedFileCount: number
  additions: number
  deletions: number
}

export interface ThreadTurn {
  id: TurnId
  threadId: ThreadId
  messageId: string
  role: MessageRole
  text: string
  lightHtml?: string
  routingNote?: string
  createdAt: number
  runId?: ThreadRunId
}

export interface ProjectReference {
  id: string
  name: string
  color: string
  lineage: string[]
}

export interface ThreadSummary {
  id: ThreadId
  chatId: string
  projectId: string
  title: string
  project: ProjectReference
  status: ThreadStatus
  statusLabel: string
  createdAt: number
  updatedAt: number
  visibility: Visibility
  archived: boolean
  branchedFromId?: ThreadId
  agentId?: string
  sharedWith: string[]
  messageCount: number
  runCount: number
  changedFileCount: number
  additions: number
  deletions: number
  totalCost?: string
  latestTurnPreview?: string
  latestRunId?: ThreadRunId
  needsAttention: boolean
}

export interface ThreadDetail {
  summary: ThreadSummary
  chat: Chat
  project: Project
  turns: ThreadTurn[]
  runs: RunPresentation[]
  plan: PlanItem[]
  activity: ActivityItem[]
  evidence: EvidenceItem[]
}

export type AttentionKind = 'thread' | 'task' | 'workflow_run' | 'agent_session'
export type AttentionPriority = 'urgent' | 'high' | 'normal' | 'low'
export type AttentionStatus =
  | 'needs_input'
  | 'needs_approval'
  | 'blocked'
  | 'failed'
  | 'running'
  | 'ready'
  | 'paused'
  | 'completed'

interface AttentionSourceBase {
  sourceType: AttentionKind
  sourceStatus: string
}

export interface ThreadAttentionSource extends AttentionSourceBase {
  sourceType: 'thread'
  threadId: ThreadId
}

export interface TaskAttentionSource extends AttentionSourceBase {
  sourceType: 'task'
  task: Task
}

export interface WorkflowRunAttentionSource extends AttentionSourceBase {
  sourceType: 'workflow_run'
  workflowRun: WorkflowRun
}

export interface AgentSessionAttentionSource extends AttentionSourceBase {
  sourceType: 'agent_session'
  agentSession: AgentSession
}

export type AttentionSource =
  | ThreadAttentionSource
  | TaskAttentionSource
  | WorkflowRunAttentionSource
  | AgentSessionAttentionSource

export interface AttentionItem {
  id: string
  kind: AttentionKind
  status: AttentionStatus
  priority: AttentionPriority
  title: string
  detail: string
  projectId: string
  projectName: string
  href: string
  updatedAt?: number
  progress?: number
  ownerId?: string
  agentId?: string
  source: AttentionSource
}

export interface ThreadListOptions {
  projectId?: string
  includeArchived?: boolean
  query?: string
  statuses?: readonly ThreadStatus[]
}

export interface AttentionOptions {
  projectId?: string
  includeCompleted?: boolean
  includeScheduled?: boolean
}

export interface OperationalStatusInput {
  status: RunStatus | Task['status'] | AgentSession['status']
  detail?: string
  approvalRequired?: boolean
}
