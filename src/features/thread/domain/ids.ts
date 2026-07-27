import type { ThreadId, ThreadRunId, TurnId } from './contracts'

function segment(value: string): string {
  return encodeURIComponent(value)
}

export function toThreadId(chatId: string): ThreadId {
  return chatId
}

export function toTurnId(messageId: string): TurnId {
  return messageId
}

export function toThreadRunId(threadId: ThreadId, turnId: TurnId, sourceRunId: string): ThreadRunId {
  return `thread:${segment(threadId)}:turn:${segment(turnId)}:run:${segment(sourceRunId)}`
}

export function toPlanItemId(runId: ThreadRunId, position: number): string {
  return `${runId}:plan:${position}`
}

export function toActivityItemId(runId: ThreadRunId, key: string): string {
  return `${runId}:activity:${segment(key)}`
}

export function toEvidenceItemId(runId: ThreadRunId, key: string): string {
  return `${runId}:evidence:${segment(key)}`
}
