import type { AgentRunBlock, AppData, CodingProvider, Harness, ModelKey, RunExecutionMode, RuntimeKind, SitePage } from '../types'
import type { ApplicationStateMigration, ApplicationStateSchema } from '../applications/applicationState'

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

export interface DelegationRequest {
  idempotencyKey: string
  task: string
  title?: string
  sourceBoundarySequence?: number
  /** Harness selected from the server-owned delegation allowlist. */
  harnessId?: string
  modelId?: string
  reasoningEffort?: string
  executionMode?: RunExecutionMode
  sessionStrategy?: 'new' | 'fork_if_supported' | 'fork_required'
  repo?: string
}

export interface DelegationPolicySummary {
  enabled: boolean
  allowedHarnesses: string[]
  maxDepth: number
  maxActiveChildrenPerChannel: number
  maxTotalChildrenPerChannel: number
  defaultSessionStrategy: 'new' | 'fork_if_supported' | 'fork_required'
  allowNetwork: boolean
  allowWrite: boolean
  maxBudgetUsdPerChild: number
  maxMinutesPerChild: number
}

export interface AutonomyPolicySummary {
  enabled: boolean
  allowedHarnesses: string[]
  maxActiveSessions: number
  maxRunsPerSession: number
  maxActiveChildrenPerSession: number
  maxMinutesPerSession: number
  defaultExecutionMode: 'plan' | 'project'
  allowWrite: boolean
  allowNetwork: boolean
  requiresExplicitGoal: boolean
  requiresApprovals: boolean
}

export type ProjectGoalStatus = 'ready' | 'planning' | 'working' | 'needs_approval'
  | 'paused' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'exhausted'

export interface ProjectGoal {
  goalId: string
  projectId: string
  version: number
  revision: number
  objective: string
  acceptanceCriteria: string[]
  status: ProjectGoalStatus
  policyReceipt: Record<string, unknown>
  rootThreadId?: string
  supervisorRunId?: string
  evidence: Array<Record<string, unknown>>
  createdAt: string
  updatedAt: string
  availableActions: { start: boolean; pause: boolean; resume: boolean; stop: boolean }
}

export interface ProjectGoalClient {
  get(projectId: string): Promise<ProjectGoal | null>
  set(projectId: string, input: { objective: string; acceptanceCriteria: string[] }): Promise<ProjectGoal>
  revise?(projectId: string, input: { expectedRevision: number; objective: string; acceptanceCriteria: string[] }): Promise<ProjectGoal>
  start(projectId: string, input: { harness: string; modelId?: string; reasoningEffort?: string; idempotencyKey: string }): Promise<ProjectGoal>
  pause(projectId: string, revision: number): Promise<ProjectGoal>
  resume(projectId: string, revision: number): Promise<ProjectGoal>
  stop(projectId: string, revision: number): Promise<ProjectGoal>
}

export interface CommandCenterPriority {
  projectId: string
  goalId?: string
  goalRevision?: number
  objective: string
  acceptanceCriteria: string[]
  status: ProjectGoalStatus | 'unknown'
  updatedAt?: string
}

export interface CommandCenterAttentionItem {
  id: string
  kind: 'approval' | 'run'
  projectId: string
  runId?: string
  approvalId?: string
  /** Immutable proposal identity for a governed KRAIL review. */
  proposalId?: string
  recordDigest?: string
  title: string
  detail: string
  reason: string
  requestedAction: string
  urgency?: string
  updatedAt?: string
  availableActions: string[]
}

export interface CommandCenterRun {
  runId: string
  projectId: string
  task?: string
  status: string
  updatedAt?: string
}

export interface CommandCenterProject {
  projectId: string
  status: 'active' | 'blocked' | 'paused' | 'done' | 'unknown'
  objective?: string
  nextAction?: string
  latestActivity?: string
  updatedAt?: string
}

export interface CommandCenterOutcome {
  id: string
  projectId: string
  runId?: string
  title: string
  summary?: string
  verified: boolean
  completedAt: string
}

export interface CommandCenterSnapshot {
  generatedAt: string
  priority: CommandCenterPriority | null
  priorityStatus: { state: 'available' | 'empty' | 'ambiguous' | 'unavailable'; reason?: string }
  attentionItems: CommandCenterAttentionItem[]
  activeRuns: CommandCenterRun[]
  projects: CommandCenterProject[]
  outcomes: CommandCenterOutcome[]
  unavailableSections: Array<'priority' | 'work' | 'recurring_jobs' | 'inbox' | 'operation_proposals'>
}

export interface CommandCenterClient {
  get(): Promise<CommandCenterSnapshot>
}

export interface ExternalOperationSession {
  sessionId: string
  projectId: string
  harness: 'codex' | 'claude_code' | 'other'
  externalSessionId: string
  transcriptLocator: string
  workspaceLocator?: string
  authorityMode: 'source_managed' | 'opensaddle_managed' | 'hybrid'
  sourceCapabilities: Record<string, boolean>
  checkpointDigest?: string
  authorityHash: string
  linkedRunId?: string
  createdAt: string
  updatedAt: string
}

export interface OperationsSessionClient {
  sessions(projectId: string): Promise<ExternalOperationSession[]>
  run(runId: string): Promise<OperationRunDetail>
}

export interface OperationRunDetail { runId: string; projectId: string; sourceRef: string; task: string; requestedBy: string; status: string; cancellationRequested: boolean; assignedWorkerId?: string; leaseEpoch: number; leaseExpiresAt?: string; createdAt: string; updatedAt: string; policy: Record<string, unknown> }

export interface OperationProposalTarget {
  issuer: string
  resourceType: string
  resourceId: string
  resourceVersion: string
  expectedVersion: string
  digest: string
  source: { sourceId: string; origin: string; version: string; digest: string }
}

/** A proposal record is immutable: its ID is the approval precondition. */
export interface OperationProposal {
  proposalId: string
  projectId: string
  recordDigest: string
  protectedInputDigest: string
  registeredActionId: string
  registeredActionVersion: number
  actor: string
  delegationChain: string[]
  targets: OperationProposalTarget[]
  declaredEffects: Array<{ effectClass: string; bounds: Record<string, unknown> }>
  policy: { outcome: string; id: string; version: string; hash: string; reason: string | null }
  requiredApprovals: Array<{ kind: string; role: string; count: number }>
  costEstimate: { currency: string; estimatedMicrounits: number; budgetMicrounits: number | null }
  validationResults: Array<{ code: string; passed: boolean; message: string | null }>
  blockers: Array<{ code: string; message: string }>
  expiresAt: string
  createdAt: string
}

export interface KrailProposalApproval {
  approvalId: string
  proposalId: string
  approvedBy: string
  expiresAt: string
  recordDigest: string
}

export interface KrailProposalClient {
  get(proposalId: string): Promise<OperationProposal>
  approve(proposalId: string, ttlSeconds: number): Promise<KrailProposalApproval>
}
export interface Participant { participantId: string; projectId: string; source: string; ownerSubject: string; title: string; commandId: string; commandVersion: number; commandDescriptorDigest: string; lifecycle: 'waiting' | 'paused' | 'retired'; revision: number }
export interface ParticipantMessage { messageId: string; participantId: string; projectId: string; status: string; runId: string; invocationId?: string; resource: ExactArtifactRef; input: Record<string, unknown> }
export interface ParticipantClient { create(projectId: string, input: { source: string; title: string; commandId: string }): Promise<Participant>; get(id: string): Promise<Participant>; lifecycle(id: string, revision: number, lifecycle: Participant['lifecycle']): Promise<Participant>; send(id: string, revision: number, resource: ExactArtifactRef, input: Record<string, unknown>, idempotencyKey: string): Promise<ParticipantMessage>; message(id: string): Promise<ParticipantMessage>; messages(id: string): Promise<ParticipantMessage[]> }

export interface ExactArtifactRef { project_id: string; run_id: string; artifact_id: string; digest: string; artifact_type?:string;size_bytes?:number;created_at?:string;redaction_class?:string }
export interface ArtifactContent { text:string;mediaType:string;sizeBytes:number;digest:string }
export interface ShellCommandDescriptor { command_id: string; version: number; descriptor_digest: string; title: string; description: string; effect: 'read' | 'write' | 'execute'; required_actions: string[]; available: { available: boolean; reason?: string }; input_schema: Record<string, unknown>; output_schema: Record<string, unknown>; package_ref?: { package_id: string; version: string; manifest_digest: string }; contribution_id?: string; handler_id?: string; handler_version?: number }
export interface ShellCommandResult { invocation_id: string; project_id: string; command_id: string; version: number; descriptor_digest: string; invoked_by: string; created_at: string; resource: ExactArtifactRef; input: Record<string, unknown>; status: string; result: { summary?: string; artifacts?: Array<Record<string, unknown>>; verified?: boolean }; receipt: { effect: string; resource_digest: string; verified: boolean } }
export interface RunConnectorCapability { connector: string; protocol_version: string; status: { state: 'available' | 'offline'; reason: string | null }; actions: Array<{ action: string; title: string; description: string; effect: 'read'; input: { required: string[]; properties?: Record<string, unknown> }; result: { type: 'object'; additional_properties: true } }> }
export interface ConnectorInvocationResult { result: Record<string, unknown>; receipt: { connector: string; action: string; request_digest: string; response_digest: string; credential_lease_id: string } }
export type ApplicationDensity='compact'|'comfortable'
export type ApplicationPresentation='document'|'split'|'focus'
export interface ApplicationPresentationValues{density:ApplicationDensity;presentation:ApplicationPresentation;order:number}
export interface ApplicationSourceRef{authority:string;resource_type:string;resource_id:string;version:string;digest:string}
export interface EnvironmentApplicationInstance{instance_id:string;defaults:ApplicationPresentationValues}
export interface EnvironmentApplicationDefinition{application_id:string;version:number;definition_digest:string;source_ref:ApplicationSourceRef;package_ref:null|{package_id:string;version:string;manifest_digest:string};instances:EnvironmentApplicationInstance[]}
export interface PersonalEnvironmentOverride{density?:ApplicationDensity;presentation?:ApplicationPresentation;order?:number}
export interface PersonalEnvironmentOverrides{instances:Record<string,PersonalEnvironmentOverride>}
export interface EffectiveApplicationInstance{instance_id:string;application_id:string;application_version:number;definition_digest:string;source_ref:ApplicationSourceRef;package_ref:EnvironmentApplicationDefinition['package_ref'];defaults:ApplicationPresentationValues;effective:ApplicationPresentationValues}
export interface PersonalEnvironmentRevision{schema_version:string;project_id:string;subject:string;revision:number;base_environment_revision:number;base_definition_digest:string;overrides:PersonalEnvironmentOverrides;effective_instances:EffectiveApplicationInstance[];conflicts:string[];changed_by:string|null;reason:string|null;parent_revision:number|null;created_at:string|null}
export interface PersonalEnvironmentPreview{schema_version:string;project_id:string;subject:string;base_revision:number;base_environment_revision:number;base_definition_digest:string;diff:{before:PersonalEnvironmentOverrides;after:PersonalEnvironmentOverrides};activatable:boolean;requirements:string[]}
export interface EnvironmentRevision { schema_version: string; project_id: string; revision: number; definition: { commands: Array<{ command_id: string; version: number; descriptor_digest: string }>; bindings: string[]; services: Array<{ id: string; status: string }>; packages?: unknown[];applications?:EnvironmentApplicationDefinition[] }; definition_digest: string; changed_by: string | null; reason: string | null; parent_revision: number | null; created_at: string | null }
export interface EnvironmentPreview { schema_version: string; project_id: string; base_revision: number; base_definition_digest: string; proposed_definition_digest: string; diff: Record<'commands' | 'bindings' | 'services', { added: unknown[]; removed: unknown[] }>; requirements: string[]; activatable: boolean; observed_service_health: { available: false; reason: string } }
export interface ApplicationRendererDescriptor{application_id:string;instance_id:string;entry_file:string;content_digest:string;size:number;media_type:'text/html; profile=opensaddle-renderer-fragment.v1; charset=utf-8';package_ref:{package_id:string;version:string;manifest_digest:string};input_schema:Record<string,unknown>;output_schema:Record<string,unknown>;state_schema_version:number;state_max_bytes:number;state_schema:ApplicationStateSchema;state_migrations:ApplicationStateMigration[];sandbox_policy:{scripts:true;same_origin:false;network_isolation:'unavailable';navigation_containment:'host_observed_only'};authority:'core';execution_trust:'trusted_signed_publisher'}
export interface ApplicationRendererCandidate{application_id:string;title:string;package_id:string;package_version:string;manifest_digest:string;content_digest:string;size_bytes:number;state_schema_version:number;state_max_bytes:number;state_compatibility:null|{accepts_from_versions:number[]};state_schema:ApplicationStateSchema;state_migrations:ApplicationStateMigration[];available:{available:boolean;reason:string|null};enablement:null|{status:'enabled'|'disabled';version:string;revision:number};activation:{desired:boolean;observed_health:'unavailable';receipt:null};environment_application:EnvironmentApplicationDefinition|null}
export interface ApplicationRendererEnablement{schema_version:'opensaddle.application-renderer-enablement.v1';project_id:string;package_id:string;package_version:string;manifest_digest:string;enablement:{status:'enabled';version:string;revision:number};activation:{desired:'enabled';observed_health:'unavailable';receipt:null}}
export interface MalleableShellClient {
  commands(projectId?: string): Promise<ShellCommandDescriptor[]>; artifacts(runId: string, projectId: string): Promise<ExactArtifactRef[]>; invoke(descriptor: ShellCommandDescriptor, resource: ExactArtifactRef, input?: Record<string, unknown>): Promise<ShellCommandResult>; invocations(projectId: string): Promise<ShellCommandResult[]>; invocation(invocationId: string): Promise<ShellCommandResult>
  content?(resource:ExactArtifactRef):Promise<ArtifactContent>;applicationRenderers?(projectId:string):Promise<ApplicationRendererDescriptor[]>;applicationRendererContent?(projectId:string,renderer:ApplicationRendererDescriptor,signal?:AbortSignal):Promise<Response>;applicationRendererCandidates?(projectId:string):Promise<ApplicationRendererCandidate[]>;enableApplicationRendererCandidate?(projectId:string,candidate:ApplicationRendererCandidate):Promise<ApplicationRendererEnablement>
  personalEnvironment?(projectId:string):Promise<PersonalEnvironmentRevision>;previewPersonalEnvironment?(projectId:string,expectedRevision:number,overrides:PersonalEnvironmentOverrides,reason:string):Promise<PersonalEnvironmentPreview>;applyPersonalEnvironment?(projectId:string,expectedRevision:number,overrides:PersonalEnvironmentOverrides,reason:string,expectedBaseEnvironmentRevision:number,baseDefinitionDigest:string):Promise<PersonalEnvironmentRevision>;revertPersonalEnvironment?(projectId:string,expectedRevision:number,targetRevision:number,reason:string):Promise<PersonalEnvironmentRevision>
  connectors(runId: string): Promise<RunConnectorCapability[]>; invokeConnector(runId: string, connector: string, action: string, args: Record<string, unknown>): Promise<ConnectorInvocationResult>; environment(projectId: string): Promise<EnvironmentRevision>; preview(projectId: string, expectedRevision: number, definition: EnvironmentRevision['definition'], reason: string, baseDefinitionDigest: string): Promise<EnvironmentPreview>; apply(projectId: string, expectedRevision: number, definition: EnvironmentRevision['definition'], reason: string, baseDefinitionDigest: string): Promise<EnvironmentRevision>; revert(projectId: string, expectedRevision: number, targetRevision: number, reason: string): Promise<EnvironmentRevision>
}

export interface ProjectExtensionEnablement {
  projectId: string
  packageId: string
  version: string
  status: 'enabled' | 'disabled'
  revision: number
  policyReceipt: Record<string, unknown>
}

export interface ExtensionContribution {
  kind: 'resource_type' | 'action' | 'workflow_blueprint' | 'factory_blueprint'
    | 'participant' | 'evaluator' | 'perspective' | 'artifact_type' | 'runtime_requirement'
  contributionId: string
  title: string
  description: string
  packageId: string
  packageVersion: string
  manifestDigest: string
  effect?: 'read' | 'write'
  approvalRequired?: boolean
  surfaceKind?: 'board' | 'dashboard' | 'document' | 'table' | 'timeline'
  requiredCapabilities: string[]
  descriptor: Record<string, unknown>
}

export interface ExtensionCatalogClient {
  projectExtensions(projectId: string): Promise<ProjectExtensionEnablement[]>
  contributions(projectId: string, kind?: ExtensionContribution['kind']): Promise<ExtensionContribution[]>
}

export interface ProjectIntelligenceSnapshot {
  schemaVersion: 'opensaddle.project-intelligence-snapshot.v1'
  snapshotId: string
  snapshotDigest: string
  projectId: string
  version: number
  revision: {
    oid: string
    treeOid: string
    authorName: string
    authoredAt: string
    subject: string
  }
  summary: {
    fileCount: number
    totalBytes: number
    languages: Array<{ language: string; fileCount: number }>
    pathGroups: Array<{ name: string; fileCount: number; sizeBytes: number }>
  }
  evidence: Array<{
    evidenceId: string
    kind: string
    locator: string
    digest?: string
  }>
  recentChanges: Array<{
    oid: string
    authorName: string
    authoredAt: string
    subject: string
  }>
  uncertainties: Array<{
    code: string
    severity: 'material' | 'informational'
    detail: string
  }>
  createdAt: string
}

export interface ProjectIntelligenceView {
  snapshot: ProjectIntelligenceSnapshot
  sourceFreshness: {
    observedAt: string
    currentHeadOid: string
    snapshotRevisionOid: string
    status: 'fresh' | 'stale' | 'unknown'
    workingTreeDirty: boolean
    workingTreeChangeCount: number
  }
}

export interface ProjectIntelligenceClient {
  latest(projectId: string): Promise<ProjectIntelligenceView | null>
  create(projectId: string, revision?: string): Promise<ProjectIntelligenceView>
}

export interface DelegationResult {
  delegationId: string
  parentThreadId: string
  childThreadId: string
  runId: string
  status: 'pending' | 'bound' | 'cancelled'
  parentBoundarySequence: number
  selectedRoute: Record<string, unknown>
  effectivePolicy: Record<string, unknown>
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
  delegate(parentRunId: string, input: DelegationRequest): Promise<DelegationResult>
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
  materialization?: ProjectOnboardingMaterialization | null
}

export interface ProjectOnboardingMaterialization {
  recommendationId: string
  discoveryFingerprint: string
  artifactKind: 'codex_skill' | 'claude_skill' | 'krail_workflow'
  targetPath: string
  targetContract: 'codex.project-skill/v1' | 'claude.project-skill/v1' | 'krail.workflow/v1'
}

export interface ProjectOnboardingMaterializationValidation {
  contract: 'opensaddle.materialization-validation/v1'
  status: 'valid'
  recommendationId: string
  artifactKind: ProjectOnboardingMaterialization['artifactKind']
  targetPath: string
  targetContract: ProjectOnboardingMaterialization['targetContract']
  semanticName: string
  descriptionDigest: string
  contentDigest: string
  byteCount: number
  activationBoundary: 'project'
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
  ecosystems: string[]
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
  | 'runner_compatible'
  | 'krail_discovery'
  | 'state_root_external'
  | 'source_has_no_opensaddle_state'
  | 'state_root_writable'

export interface ProjectOnboardingRunnerCompatibility {
  status: 'compatible' | 'incompatible' | 'unknown' | 'unavailable'
  command: string[]
  requiredOptions: string[]
  missingOptions: string[]
  probeStatus: 'ok' | 'failed' | 'timeout' | 'not_run'
  reason?: string | null
  upgradeGuidance?: string | null
}

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
  runnerCompatibility: ProjectOnboardingRunnerCompatibility
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
  materializationValidation?: ProjectOnboardingMaterializationValidation | null
}

export interface OnboardingRunSummary {
  runId: string
  projectId: string
  recommendationId?: string | null
  recommendationKind?: ProjectOnboardingRecommendationOption['kind'] | null
  status: ProjectOnboardingChange['status']
  fingerprint?: string | null
  diffDigest?: string | null
  changedFileCount: number
  checks: Array<{ name: string; passed: boolean; exitCode?: number | null }>
  commit?: string | null
  ref?: string | null
  recoverable: boolean
  materializationValidation?: {
    contract: 'opensaddle.materialization-validation/v1'
    status: 'valid'
    artifactKind: ProjectOnboardingMaterialization['artifactKind']
    targetContract: ProjectOnboardingMaterialization['targetContract']
    semanticName: string
    descriptionDigest: string
    contentDigest: string
    byteCount: number
    activationBoundary: 'project'
  } | null
  lastActivity?: { kind?: string; type?: string; label?: string; at?: string; timestamp?: string } | null
  createdAt: number
  updatedAt: number
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
  listOnboardingRuns?(limit?: number): Promise<OnboardingRunSummary[]>
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
  onboardingReadiness?(projectId: string, runner: ProjectOnboardingRunner, model?: string): Promise<ProjectOnboardingReadiness>
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
