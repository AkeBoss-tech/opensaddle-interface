import type { AppData, Message, Project } from '../../../types'
import {
  adaptAgentSessionAttention,
  adaptRun,
  adaptTaskAttention,
  adaptThreadAttention,
  adaptThreadSummary,
  adaptTurn,
  adaptWorkflowRunAttention,
} from './adapters'
import type {
  AttentionItem,
  AttentionOptions,
  ThreadDetail,
  ThreadId,
  ThreadListOptions,
  ThreadSummary,
} from './contracts'

const ATTENTION_ORDER: Record<AttentionItem['priority'], number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

function projectMap(data: AppData): Map<string, Project> {
  return new Map(data.projects.map((project) => [project.id, project]))
}

function sortedMessages(data: AppData, chatId: string): Message[] {
  return data.messages
    .filter((message) => message.chatId === chatId)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

function buildSummary(data: AppData, threadId: ThreadId, projects: Map<string, Project>): ThreadSummary | null {
  const chat = data.chats.find((candidate) => candidate.id === threadId)
  if (!chat) return null
  const project = projects.get(chat.projectId)
  if (!project) return null
  const messages = sortedMessages(data, chat.id)
  const runs = messages
    .map((message) => adaptRun(message, chat.projectId))
    .filter((run) => run !== null)
  return adaptThreadSummary(chat, project, messages, runs)
}

export function selectThreadSummary(data: AppData, threadId: ThreadId): ThreadSummary | null {
  return buildSummary(data, threadId, projectMap(data))
}

export function selectThreadList(data: AppData, options: ThreadListOptions = {}): ThreadSummary[] {
  const projects = projectMap(data)
  const query = options.query?.trim().toLowerCase()

  return data.chats
    .map((chat) => buildSummary(data, chat.id, projects))
    .filter((summary): summary is ThreadSummary => summary !== null)
    .filter((summary) => options.includeArchived || !summary.archived)
    .filter((summary) => !options.projectId || summary.projectId === options.projectId)
    .filter((summary) => !options.statuses?.length || options.statuses.includes(summary.status))
    .filter((summary) => !query
      || summary.title.toLowerCase().includes(query)
      || summary.project.name.toLowerCase().includes(query)
      || summary.latestTurnPreview?.toLowerCase().includes(query))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title))
}

export const selectThreadSummaries = selectThreadList

export function selectThreadDetail(data: AppData, threadId: ThreadId): ThreadDetail | null {
  const chat = data.chats.find((candidate) => candidate.id === threadId)
  if (!chat) return null
  const project = data.projects.find((candidate) => candidate.id === chat.projectId)
  if (!project) return null

  const messages = sortedMessages(data, chat.id)
  const runs = messages
    .map((message) => adaptRun(message, project.id))
    .filter((run) => run !== null)
  const summary = adaptThreadSummary(chat, project, messages, runs)

  return {
    summary,
    chat,
    project,
    turns: messages.map((message) => adaptTurn(message, project.id)),
    runs,
    plan: runs.at(-1)?.plan ?? [],
    activity: runs.flatMap((run) => run.activity),
    evidence: runs.flatMap((run) => run.evidence),
  }
}

function shouldIncludeAttention(item: AttentionItem, options: AttentionOptions): boolean {
  if (options.projectId && item.projectId !== options.projectId) return false
  if (!options.includeCompleted && item.status === 'completed') return false
  if (!options.includeScheduled && item.kind === 'task' && item.source.sourceType === 'task') {
    const task = item.source.task
    if (
      (task.type === 'scheduled' || task.type === 'monitor')
      && (task.status === 'active' || task.status === 'armed' || task.status === 'paused')
    ) return false
  }
  if (item.kind === 'thread' && item.source.sourceType === 'thread' && item.source.sourceStatus === 'draft') {
    return false
  }
  if (
    item.kind === 'agent_session'
    && item.source.sourceType === 'agent_session'
    && item.source.agentSession.status === 'idle'
  ) {
    return false
  }
  return true
}

export function selectAttentionItems(data: AppData, options: AttentionOptions = {}): AttentionItem[] {
  const projects = projectMap(data)
  const threads = selectThreadList(data, {
    projectId: options.projectId,
    includeArchived: false,
  }).map(adaptThreadAttention)
  const tasks = data.tasks.flatMap((task) => {
    const project = projects.get(task.projectId)
    return project ? [adaptTaskAttention(task, project)] : []
  })
  const workflows = data.workflowRuns.flatMap((run) => {
    const project = projects.get(run.projectId)
    if (!project) return []
    const workflow = data.workflows.find((candidate) => candidate.id === run.workflowId)
    return [adaptWorkflowRunAttention(run, workflow, project)]
  })
  const sessions = data.agentSessions.flatMap((session) => {
    const project = projects.get(session.projectId)
    return project ? [adaptAgentSessionAttention(session, project)] : []
  })

  return [...threads, ...tasks, ...workflows, ...sessions]
    .filter((item) => shouldIncludeAttention(item, options))
    .sort((left, right) => {
      const priority = ATTENTION_ORDER[left.priority] - ATTENTION_ORDER[right.priority]
      if (priority) return priority
      const recency = (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
      return recency || left.title.localeCompare(right.title)
    })
}
