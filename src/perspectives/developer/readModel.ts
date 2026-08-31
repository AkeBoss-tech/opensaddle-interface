import type { RuntimeRunSummary } from '../../services/contracts'
import type { AppData } from '../../types'
import { selectThreadDetail, selectThreadSummaries } from '../../features/thread/domain'

export type DeveloperPerspectiveView = 'trace-evidence' | 'kanban'
export type DeveloperBoardColumnId = 'ready' | 'in-progress' | 'needs-you' | 'review' | 'done'
export type DeveloperRuntimeState = 'loading' | 'ready' | 'unavailable'

export interface DeveloperTraceRow {
  id: string
  title: string
  projectId: string
  projectName: string
  status: string
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger'
  updatedAt: number
  href: string
  provider: string
  evidenceCount: number
  checkCount: number
  changedFileCount: number
  source: 'durable-runtime' | 'message-projection'
  signal?: 'no-recent-runtime-activity'
}

export interface DeveloperBoardCard {
  id: string
  title: string
  projectId: string
  projectName: string
  column: DeveloperBoardColumnId
  status: string
  updatedAt: number
  href: string
  source: 'durable-runtime' | 'thread-projection'
  runId?: string
}

export interface DeveloperBoardColumn {
  id: DeveloperBoardColumnId
  title: string
  description: string
  cards: readonly DeveloperBoardCard[]
}

export interface DeveloperPerspectiveModel {
  schemaVersion: '1'
  projectId: string
  projectName: string
  generatedAt: number
  runtimeState: DeveloperRuntimeState
  runtimeError?: string
  traces: readonly DeveloperTraceRow[]
  columns: readonly DeveloperBoardColumn[]
  unlinkedRunCount: number
}

const COLUMN_DEFINITIONS: ReadonlyArray<Omit<DeveloperBoardColumn, 'cards'>> = [
  { id: 'ready', title: 'Ready', description: 'Queued or awaiting a first run' },
  { id: 'in-progress', title: 'In progress', description: 'Attached work producing new signals' },
  { id: 'needs-you', title: 'Needs you', description: 'Input or approval is required' },
  { id: 'review', title: 'Review', description: 'Paused, failed, stopped, or recorded-only state' },
  { id: 'done', title: 'Done', description: 'Completed work with durable history' },
]

function durableLifecycle(run: RuntimeRunSummary): {
  column: DeveloperBoardColumnId
  status: string
  tone: DeveloperTraceRow['tone']
} {
  if (run.status === 'completed') return { column: 'done', status: 'Completed', tone: 'success' }
  if (run.status === 'running' || run.status === 'provisioning') return { column: 'in-progress', status: run.status === 'running' ? 'Running' : 'Provisioning', tone: 'info' }
  if (run.status === 'waiting' || run.status === 'awaiting_input') {
    return {
      column: 'needs-you',
      status: run.lastEventType === 'approval.requested' ? 'Needs approval' : 'Needs input',
      tone: 'warning',
    }
  }
  if (run.status === 'queued') return { column: 'ready', status: 'Queued', tone: 'neutral' }
  if (run.status === 'paused') return { column: 'review', status: 'Paused', tone: 'warning' }
  if (run.status === 'cancelled') return { column: 'review', status: 'Stopped', tone: 'warning' }
  if (run.status === 'timed_out') return { column: 'review', status: 'Timed out', tone: 'danger' }
  return { column: 'review', status: 'Failed', tone: 'danger' }
}

function stableLatestRun(runs: readonly RuntimeRunSummary[]) {
  return [...runs].sort((left, right) => right.updatedAt - left.updatedAt || left.runId.localeCompare(right.runId))[0]
}

function canonicalizeDurableRuns(runs: readonly RuntimeRunSummary[]) {
  const ordered = [...runs].sort((left, right) =>
    left.runId.localeCompare(right.runId)
    || right.updatedAt - left.updatedAt
    || right.createdAt - left.createdAt
    || left.sessionId.localeCompare(right.sessionId)
    || left.status.localeCompare(right.status))
  return ordered.filter((run, index) => index === 0 || ordered[index - 1]?.runId !== run.runId)
}

export function deriveDeveloperPerspective(input: {
  data: AppData
  projectId: string
  durableRuns: readonly RuntimeRunSummary[]
  runtimeState: DeveloperRuntimeState
  runtimeError?: string
  asOf: number
}): DeveloperPerspectiveModel {
  const { data, projectId, runtimeState, runtimeError, asOf } = input
  // The first compiled perspective is deliberately exact-project scoped. A
  // parent read grant does not imply access to its children.
  const projectIds = new Set([projectId])
  const project = data.projects.find((candidate) => candidate.id === projectId)
  const durableRuns = canonicalizeDurableRuns(input.durableRuns.filter((run) => projectIds.has(run.projectId)))
  const durableRunIds = new Set(durableRuns.map((run) => run.runId))
  const threads = selectThreadSummaries(data, { includeArchived: false }).filter((thread) => projectIds.has(thread.projectId))

  const traces: DeveloperTraceRow[] = durableRuns.map((run) => {
    const detail = run.threadId ? selectThreadDetail(data, run.threadId) : null
    const projection = detail?.runs.find((candidate) => {
      const message = data.messages.find((item) => item.id === candidate.messageId)
      return candidate.sourceRunId === run.runId || message?.runtimeRunId === run.runId
    })
    const lifecycle = durableLifecycle(run)
    const provider = run.route.providerKey && run.route.providerKey !== 'auto'
      ? run.route.providerKey
      : run.route.harnessKey
    const active = ['queued', 'provisioning', 'running', 'waiting', 'awaiting_input'].includes(run.status)
    return {
      id: `run:${run.runId}`,
      title: run.task,
      projectId: run.projectId,
      projectName: data.projects.find((candidate) => candidate.id === run.projectId)?.name ?? run.projectId,
      status: lifecycle.status,
      tone: lifecycle.tone,
      updatedAt: run.updatedAt,
      href: `/runs?run=${encodeURIComponent(run.runId)}`,
      provider,
      evidenceCount: projection?.evidence.length ?? 0,
      checkCount: projection?.evidence.filter((evidence) => evidence.kind === 'checks').length ?? 0,
      changedFileCount: projection?.changedFileCount ?? 0,
      source: 'durable-runtime' as const,
      signal: active && asOf - run.updatedAt > 5 * 60_000 ? 'no-recent-runtime-activity' as const : undefined,
    }
  })

  for (const thread of threads) {
    const detail = selectThreadDetail(data, thread.chatId)
    for (const run of detail?.runs ?? []) {
      const message = data.messages.find((item) => item.id === run.messageId)
      if (durableRunIds.has(run.sourceRunId) || (message?.runtimeRunId && durableRunIds.has(message.runtimeRunId))) continue
      traces.push({
        id: run.id,
        title: thread.title,
        projectId: thread.projectId,
        projectName: thread.project.name,
        status: 'Recorded history',
        tone: 'neutral',
        updatedAt: run.createdAt,
        href: `/chat/${thread.chatId}`,
        provider: run.route.harness,
        evidenceCount: run.evidence.length,
        checkCount: run.evidence.filter((evidence) => evidence.kind === 'checks').length,
        changedFileCount: run.changedFileCount,
        source: 'message-projection',
      })
    }
  }

  traces.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))

  const cards: DeveloperBoardCard[] = threads.map((thread) => {
    const linkedRun = stableLatestRun(durableRuns.filter((run) => run.threadId === thread.chatId))
    if (linkedRun) {
      const lifecycle = durableLifecycle(linkedRun)
      return {
        id: `thread:${thread.chatId}`,
        title: thread.title,
        projectId: thread.projectId,
        projectName: thread.project.name,
        column: lifecycle.column,
        status: lifecycle.status,
        updatedAt: Math.max(thread.updatedAt, linkedRun.updatedAt),
        href: `/chat/${thread.chatId}`,
        source: 'durable-runtime',
        runId: linkedRun.runId,
      }
    }

    const messages = data.messages
      .filter((message) => message.chatId === thread.chatId)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    const latestMessage = messages.at(-1)
    const hasRecordedRun = thread.runCount > 0
    return {
      id: `thread:${thread.chatId}`,
      title: thread.title,
      projectId: thread.projectId,
      projectName: thread.project.name,
      column: hasRecordedRun ? 'review' : latestMessage?.role === 'assistant' ? 'done' : 'ready',
      status: hasRecordedRun ? 'Recorded state only' : latestMessage?.role === 'assistant' ? 'Replied' : latestMessage ? 'Ready to run' : 'Draft',
      updatedAt: thread.updatedAt,
      href: `/chat/${thread.chatId}`,
      source: 'thread-projection',
    }
  })

  const columns = COLUMN_DEFINITIONS.map((definition) => ({
    ...definition,
    cards: cards
      .filter((card) => card.column === definition.id)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)),
  }))

  const threadIds = new Set(threads.map((thread) => thread.chatId))
  return {
    schemaVersion: '1',
    projectId,
    projectName: project?.name ?? projectId,
    generatedAt: asOf,
    runtimeState,
    runtimeError,
    traces,
    columns,
    unlinkedRunCount: durableRuns.filter((run) => !run.threadId || !threadIds.has(run.threadId)).length,
  }
}
