import type {
  AgentPlanStep,
  AgentRunBlock,
  AgentSession,
  Artifact,
  Chat,
  Message,
  Project,
  Task,
  WorkflowDef,
  WorkflowRun,
} from '../../../types'
import type {
  ActivityItem,
  AttentionItem,
  AttentionPriority,
  AttentionStatus,
  EvidenceItem,
  NormalizedRunStatus,
  OperationalStatusInput,
  PlanItem,
  RunPresentation,
  ThreadStatus,
  ThreadSummary,
  ThreadTurn,
} from './contracts'
import {
  toActivityItemId,
  toEvidenceItemId,
  toPlanItemId,
  toThreadId,
  toThreadRunId,
  toTurnId,
} from './ids'

const ATTENTION_STATUSES = new Set<ThreadStatus>(['needs_input', 'needs_approval', 'blocked', 'failed'])

function includesAny(value: string, terms: readonly string[]): boolean {
  const normalized = value.toLowerCase()
  return terms.some((term) => normalized.includes(term))
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusLabel(status: ThreadStatus | NormalizedRunStatus): string {
  return titleCase(status)
}

function fallbackRunSourceId(message: Message): string {
  const sourceId = message.run?.id.trim()
  return sourceId && sourceId !== 'pending' ? sourceId : `legacy-${message.id}`
}

export function normalizeRunStatus(run: AgentRunBlock): NormalizedRunStatus {
  const text = run.statusText.toLowerCase()

  if (includesAny(text, ['fail', 'error'])) return 'failed'
  if (includesAny(text, ['stop', 'cancel'])) return 'stopped'
  if (includesAny(text, ['blocked', 'denied'])) return 'blocked'
  if (includesAny(text, ['approval', 'permission'])) return 'needs_approval'
  if (includesAny(text, ['input', 'question', 'waiting for user'])) return 'needs_input'
  if (run.done || includesAny(text, ['complete', 'done'])) return 'completed'
  if (includesAny(text, ['review'])) return 'reviewing'
  if (includesAny(text, ['pause'])) return 'paused'
  if (includesAny(text, ['queue'])) return 'queued'
  if (includesAny(text, ['plan'])) return 'planning'
  return 'running'
}

export function normalizeThreadStatus(messages: readonly Message[], runs: readonly RunPresentation[]): ThreadStatus {
  const latestRun = runs.at(-1)
  if (latestRun) {
    // A queued follow-up is ordered after the active turn in the transcript,
    // but it does not replace the thread's current operational state. Prefer
    // the newest nonterminal run that is actually executing or waiting.
    const activeRun = [...runs].reverse().find((run) =>
      !run.isTerminal && run.status !== 'queued')
    if (activeRun) {
      return activeRun.status === 'queued' ? 'ready_to_run' : activeRun.status
    }
    if (latestRun.status === 'queued') return 'ready_to_run'
    return latestRun.status
  }

  const latestMessage = messages.at(-1)
  if (!latestMessage) return 'draft'
  return latestMessage.role === 'user' ? 'ready_to_run' : 'completed'
}

export function normalizePlanStep(step: AgentPlanStep, runId: string, position: number): PlanItem {
  return {
    id: toPlanItemId(runId, position),
    label: step.label,
    status: step.status === 'done' ? 'completed' : step.status === 'active' ? 'in_progress' : 'pending',
    position,
  }
}

function adaptArtifact(
  artifact: Artifact,
  runId: string,
  threadId: string,
  turnId: string,
): EvidenceItem {
  const base = {
    id: toEvidenceItemId(runId, artifact.id),
    runId,
    threadId,
    turnId,
    title: artifact.title,
    subtitle: artifact.subtitle,
  }

  if (artifact.type === 'diff') {
    const files = artifact.diff ?? []
    const additions = files.reduce((total, file) => total + file.add, 0)
    const deletions = files.reduce((total, file) => total + file.del, 0)
    return {
      ...base,
      kind: 'changes',
      artifactId: artifact.id,
      files,
      metrics: [
        { label: 'Files', value: files.length },
        { label: 'Additions', value: additions },
        { label: 'Deletions', value: deletions },
      ],
    }
  }

  if (artifact.type === 'table' && artifact.table && includesAny(artifact.title, ['verification', 'check', 'test'])) {
    const resultColumn = artifact.table.headers.findIndex((header) => includesAny(header, ['result', 'status']))
    const results = resultColumn < 0 ? [] : artifact.table.rows.map((row) => row[resultColumn]?.toLowerCase() ?? '')
    const passed = results.length ? results.every((result) => includesAny(result, ['pass', 'success', 'ok'])) : undefined
    return {
      ...base,
      kind: 'checks',
      artifactId: artifact.id,
      headers: artifact.table.headers,
      rows: artifact.table.rows,
      passed,
      metrics: [
        { label: 'Checks', value: artifact.table.rows.length },
        ...(passed === undefined ? [] : [{ label: 'Result', value: passed ? 'Passed' : 'Failed' }]),
      ],
    }
  }

  return {
    ...base,
    kind: 'artifact',
    artifactId: artifact.id,
    artifactType: artifact.type,
    artifact,
    metrics: [],
  }
}

export function adaptRun(message: Message, projectId: string): RunPresentation | null {
  const run = message.run
  if (!run) return null

  const threadId = toThreadId(message.chatId)
  const turnId = toTurnId(message.id)
  const sourceRunId = fallbackRunSourceId(message)
  const id = toThreadRunId(threadId, turnId, sourceRunId)
  const status = normalizeRunStatus(run)
  const activity: ActivityItem[] = [
    {
      id: toActivityItemId(id, 'status'),
      runId: id,
      threadId,
      turnId,
      kind: status === 'failed' ? 'error' : status === 'reviewing' ? 'review' : 'status',
      title: run.statusText || statusLabel(status),
      timestamp: message.createdAt,
      isError: status === 'failed',
    },
    ...run.tools.map((tool) => ({
      id: toActivityItemId(id, `tool-${tool.id}`),
      runId: id,
      threadId,
      turnId,
      kind: 'tool' as const,
      title: tool.name,
      detail: tool.output || tool.input,
      timestamp: message.createdAt,
      duration: tool.duration,
      cost: tool.cost,
      isError: includesAny(tool.output, ['fail', 'error']),
    })),
  ]
  const evidence = run.artifacts.map((artifact) => adaptArtifact(artifact, id, threadId, turnId))
  if (run.cost) {
    evidence.push({
      id: toEvidenceItemId(id, 'cost'),
      runId: id,
      threadId,
      turnId,
      kind: 'cost',
      title: 'Run cost',
      cost: run.cost,
      metrics: [{ label: 'Cost', value: run.cost }],
    })
  }
  const changedFiles = run.artifacts.flatMap((artifact) => artifact.diff ?? [])

  return {
    id,
    sourceRunId,
    threadId,
    turnId,
    messageId: message.id,
    projectId,
    createdAt: message.createdAt,
    kind: run.kind,
    title: run.title,
    status,
    statusLabel: run.statusText || statusLabel(status),
    isTerminal: status === 'completed' || status === 'failed' || status === 'stopped',
    duration: run.duration,
    cost: run.cost,
    route: {
      model: run.model,
      harness: run.harness,
      runtime: run.runtime,
      routingNote: message.routingNote,
    },
    plan: run.plan.map((step, position) => normalizePlanStep(step, id, position)),
    activity,
    evidence,
    tools: run.tools,
    artifactCount: run.artifacts.length,
    changedFileCount: changedFiles.length,
    additions: changedFiles.reduce((total, file) => total + file.add, 0),
    deletions: changedFiles.reduce((total, file) => total + file.del, 0),
  }
}

export function adaptTurn(message: Message, projectId: string): ThreadTurn {
  const run = adaptRun(message, projectId)
  return {
    id: toTurnId(message.id),
    threadId: toThreadId(message.chatId),
    messageId: message.id,
    role: message.role,
    text: message.text,
    lightHtml: message.lightHtml,
    routingNote: message.routingNote,
    createdAt: message.createdAt,
    runId: run?.id,
  }
}

function sumCosts(costs: readonly (string | undefined)[]): string | undefined {
  const parsed = costs
    .filter((cost): cost is string => Boolean(cost))
    .map((cost) => Number(cost.replace(/[^0-9.-]/g, '')))
    .filter(Number.isFinite)
  if (!parsed.length) return undefined
  return `$${parsed.reduce((total, cost) => total + cost, 0).toFixed(2)}`
}

function latestPreview(messages: readonly Message[]): string | undefined {
  const latest = messages.at(-1)
  if (!latest) return undefined
  const text = latest.text.trim() || latest.lightHtml?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text || latest.run?.statusText || undefined
}

export function adaptThreadSummary(
  chat: Chat,
  project: Project,
  messages: readonly Message[],
  runs: readonly RunPresentation[],
): ThreadSummary {
  const status = normalizeThreadStatus(messages, runs)
  return {
    id: toThreadId(chat.id),
    chatId: chat.id,
    projectId: chat.projectId,
    title: chat.title,
    project: { id: project.id, name: project.name, color: project.iconColor, lineage: project.lineage },
    status,
    statusLabel: statusLabel(status),
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    visibility: chat.visibility,
    archived: Boolean(chat.archived),
    branchedFromId: chat.branchedFromId,
    agentId: chat.agentId,
    sharedWith: [...chat.sharedWith],
    messageCount: messages.length,
    runCount: runs.length,
    changedFileCount: runs.reduce((total, run) => total + run.changedFileCount, 0),
    additions: runs.reduce((total, run) => total + run.additions, 0),
    deletions: runs.reduce((total, run) => total + run.deletions, 0),
    totalCost: sumCosts(runs.map((run) => run.cost)),
    latestTurnPreview: latestPreview(messages),
    latestRunId: runs.at(-1)?.id,
    needsAttention: ATTENTION_STATUSES.has(status),
  }
}

export function normalizeOperationalStatus(input: OperationalStatusInput): AttentionStatus {
  const detail = input.detail?.toLowerCase() ?? ''
  const status = input.status
  if (status === 'failed') return 'failed'
  if (includesAny(detail, ['blocked', 'denied'])) return 'blocked'
  if (status === 'waiting') {
    return input.approvalRequired || includesAny(detail, ['approval', 'permission', 'review'])
      ? 'needs_approval'
      : 'needs_input'
  }
  if (status === 'running') return 'running'
  if (status === 'queued' || status === 'active' || status === 'armed' || status === 'idle') return 'ready'
  if (status === 'paused') return 'paused'
  if (status === 'completed') return 'completed'
  return 'ready'
}

function attentionPriority(status: AttentionStatus): AttentionPriority {
  if (status === 'needs_input' || status === 'needs_approval' || status === 'blocked') return 'urgent'
  if (status === 'failed') return 'high'
  if (status === 'running' || status === 'ready') return 'normal'
  return 'low'
}

export function adaptThreadAttention(summary: ThreadSummary): AttentionItem {
  const status: AttentionStatus = summary.status === 'ready_to_run' || summary.status === 'draft'
    ? 'ready'
    : summary.status === 'stopped'
      ? 'paused'
      : summary.status === 'planning' || summary.status === 'reviewing'
        ? 'running'
        : summary.status
  return {
    id: `attention:thread:${encodeURIComponent(summary.id)}`,
    kind: 'thread',
    status,
    priority: attentionPriority(status),
    title: summary.title,
    detail: summary.latestTurnPreview ?? summary.statusLabel,
    projectId: summary.projectId,
    projectName: summary.project.name,
    href: `/chat/${encodeURIComponent(summary.chatId)}`,
    updatedAt: summary.updatedAt,
    agentId: summary.agentId,
    source: { sourceType: 'thread', sourceStatus: summary.status, threadId: summary.id },
  }
}

export function adaptTaskAttention(task: Task, project: Project): AttentionItem {
  const status = normalizeOperationalStatus({ status: task.status, detail: task.approval })
  return {
    id: `attention:task:${encodeURIComponent(task.id)}`,
    kind: 'task',
    status,
    priority: attentionPriority(status),
    title: task.name,
    detail: task.schedule || task.action || task.harness,
    projectId: task.projectId,
    projectName: project.name,
    href: `/runs?task=${encodeURIComponent(task.id)}`,
    progress: task.progress,
    source: { sourceType: 'task', sourceStatus: task.status, task },
  }
}

export function adaptWorkflowRunAttention(
  run: WorkflowRun,
  workflow: WorkflowDef | undefined,
  project: Project,
): AttentionItem {
  const status = normalizeOperationalStatus({
    status: run.status,
    detail: run.summary,
    approvalRequired: workflow?.approvalRequired,
  })
  return {
    id: `attention:workflow-run:${encodeURIComponent(run.id)}`,
    kind: 'workflow_run',
    status,
    priority: attentionPriority(status),
    title: workflow?.name ?? run.summary,
    detail: run.summary,
    projectId: run.projectId,
    projectName: project.name,
    href: `/workflows/${encodeURIComponent(run.projectId)}?run=${encodeURIComponent(run.id)}`,
    updatedAt: run.finishedAt ?? run.startedAt,
    ownerId: run.ownerId,
    agentId: run.agentId,
    source: { sourceType: 'workflow_run', sourceStatus: run.status, workflowRun: run },
  }
}

export function adaptAgentSessionAttention(session: AgentSession, project: Project): AttentionItem {
  const status = normalizeOperationalStatus({ status: session.status, detail: session.title })
  return {
    id: `attention:agent-session:${encodeURIComponent(session.id)}`,
    kind: 'agent_session',
    status,
    priority: attentionPriority(status),
    title: session.title,
    detail: `${session.harness} · ${session.model}`,
    projectId: session.projectId,
    projectName: project.name,
    href: `/agents/${encodeURIComponent(session.projectId)}?agent=${encodeURIComponent(session.agentId)}&session=${encodeURIComponent(session.id)}`,
    updatedAt: session.startedAt,
    agentId: session.agentId,
    source: { sourceType: 'agent_session', sourceStatus: session.status, agentSession: session },
  }
}
