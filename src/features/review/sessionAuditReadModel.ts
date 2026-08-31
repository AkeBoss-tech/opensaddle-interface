import type { AppData, Message } from '../../types'
import type { RuntimeRunSummary } from '../../services/contracts'

export interface SessionAuditPoint {
  label: string
  sessions: number
  tokens: number
}

export interface SessionAuditBreakdown {
  label: string
  value: number
}

export interface SessionAuditRow {
  id: string
  title: string
  harness: string
  model: string
  status: string
  startedAt: number
  durationMs?: number
  tokens?: number
  threadId?: string
}

export interface SessionAuditModel {
  provenance: 'authoritative-runs' | 'workspace-snapshot'
  sessionCount: number
  activeCount: number
  totalTokens?: number
  tokenCoverage: { measured: number; total: number }
  successRate?: number
  averageDurationMs?: number
  timeline: SessionAuditPoint[]
  harnesses: SessionAuditBreakdown[]
  models: SessionAuditBreakdown[]
  promptPatterns: SessionAuditBreakdown[]
  promptCount: number
  averagePromptWords?: number
  rows: SessionAuditRow[]
}

const DAY = 86_400_000
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timed_out'])
const ACTIVE = new Set(['queued', 'provisioning', 'running', 'waiting', 'awaiting_input', 'paused'])
const PATTERNS = [
  { label: 'Build or change', expression: /\b(build|create|implement|add|change|edit|refactor|fix|install)\b/i },
  { label: 'Review or diagnose', expression: /\b(review|audit|debug|diagnos|investigat|why|issue|problem)\w*/i },
  { label: 'Verify or test', expression: /\b(test|verify|validate|check|prove|evidence)\w*/i },
  { label: 'Plan or design', expression: /\b(plan|design|architect|approach|strategy|proposal)\w*/i },
  { label: 'Research or explain', expression: /\b(research|find|learn|explain|compare|summarize|understand)\w*/i },
  { label: 'Coordinate agents', expression: /\b(agent|thread|delegate|parallel|harness|codex|claude|cursor)\w*/i },
] as const

function topCounts(values: string[]): SessionAuditBreakdown[] {
  const counts = new Map<string, number>()
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, 6)
}

function usageForMessage(message: Message) {
  const usage = message.run?.usage
  if (!usage) return undefined
  return usage.totalTokens
    ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
}

function dayKey(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function promptWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function deriveSessionAudit(input: {
  data: AppData
  projectIds: ReadonlySet<string>
  durableRuns: RuntimeRunSummary[]
  runtimeReady: boolean
  now: number
  days?: number
}): SessionAuditModel {
  const days = input.days ?? 14
  const chats = input.data.chats.filter((chat) => input.projectIds.has(chat.projectId))
  const chatIds = new Set(chats.map((chat) => chat.id))
  const messages = input.data.messages.filter((message) => chatIds.has(message.chatId))
  const runMessages = messages.filter((message) => message.run)
  const messageByRun = new Map(runMessages.flatMap((message) => {
    const ids = [message.runtimeRunId, message.run?.id].filter((id): id is string => Boolean(id))
    return ids.map((id) => [id, message] as const)
  }))
  const durable = input.durableRuns.filter((run) => input.projectIds.has(run.projectId))
  const sessions = input.data.agentSessions.filter((session) => input.projectIds.has(session.projectId))
  const useDurable = input.runtimeReady

  const rows: SessionAuditRow[] = useDurable
    ? durable.map((run) => {
      const message = messageByRun.get(run.runId)
      return {
        id: run.runId,
        title: run.task,
        harness: run.route.providerKey && run.route.providerKey !== 'auto' ? run.route.providerKey : run.route.harnessKey,
        model: run.route.modelId ?? run.route.modelKey,
        status: run.status,
        startedAt: run.createdAt,
        durationMs: TERMINAL.has(run.status) ? Math.max(0, run.updatedAt - run.createdAt) : undefined,
        tokens: message ? usageForMessage(message) : undefined,
        threadId: run.threadId,
      }
    })
    : sessions.map((session) => ({
      id: session.id,
      title: session.title,
      harness: session.harness,
      model: session.model,
      status: session.status,
      startedAt: session.startedAt,
    }))

  rows.sort((left, right) => right.startedAt - left.startedAt)
  const tokenRows = rows.filter((row) => row.tokens !== undefined)
  const totalTokens = tokenRows.length ? tokenRows.reduce((sum, row) => sum + (row.tokens ?? 0), 0) : undefined
  const terminal = rows.filter((row) => TERMINAL.has(row.status))
  const successful = terminal.filter((row) => row.status === 'completed')
  const durations = terminal.flatMap((row) => row.durationMs === undefined ? [] : [row.durationMs])

  const timeline = Array.from({ length: days }, (_, index) => {
    const timestamp = input.now - (days - index - 1) * DAY
    const date = new Date(timestamp)
    const key = dayKey(timestamp)
    const dayRows = rows.filter((row) => dayKey(row.startedAt) === key)
    return {
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      sessions: dayRows.length,
      tokens: dayRows.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
    }
  })

  const userPrompts = messages
    .filter((message) => message.role === 'user' && message.text.trim())
    .map((message) => message.text.trim())
  const prompts = userPrompts.length ? userPrompts : durable.map((run) => run.task).filter(Boolean)
  const promptPatterns = PATTERNS.map((pattern) => ({
    label: pattern.label,
    value: prompts.filter((prompt) => pattern.expression.test(prompt)).length,
  })).filter((pattern) => pattern.value > 0).sort((left, right) => right.value - left.value)

  return {
    provenance: useDurable ? 'authoritative-runs' : 'workspace-snapshot',
    sessionCount: rows.length,
    activeCount: rows.filter((row) => ACTIVE.has(row.status) || ['running', 'waiting', 'paused'].includes(row.status)).length,
    totalTokens,
    tokenCoverage: { measured: tokenRows.length, total: rows.length },
    successRate: terminal.length ? successful.length / terminal.length : undefined,
    averageDurationMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : undefined,
    timeline,
    harnesses: topCounts(rows.map((row) => row.harness)),
    models: topCounts(rows.map((row) => row.model)),
    promptPatterns,
    promptCount: prompts.length,
    averagePromptWords: prompts.length ? prompts.reduce((sum, prompt) => sum + promptWords(prompt), 0) / prompts.length : undefined,
    rows: rows.slice(0, 8),
  }
}
