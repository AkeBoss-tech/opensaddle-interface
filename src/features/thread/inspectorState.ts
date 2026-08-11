import type { AgentRunBlock } from '../../types'

export const THREAD_INSPECTOR_STORAGE_KEY = 'opensaddle-thread-inspectors-v1'

export type ThreadInspectorTab = 'overview' | 'evidence' | 'changes' | 'checks' | 'activity' | 'environment' | 'access'

export interface ThreadInspectorState {
  open: boolean
  tab: ThreadInspectorTab
  width: number
  lastAttentionKey?: string
}

export interface ThreadInspectorAttention {
  key: string
  tab: ThreadInspectorTab
}

export const DEFAULT_THREAD_INSPECTOR_STATE: ThreadInspectorState = {
  open: false,
  tab: 'overview',
  width: 292,
}

const INSPECTOR_TABS = new Set<ThreadInspectorTab>([
  'overview',
  'evidence',
  'changes',
  'checks',
  'activity',
  'environment',
  'access',
])

export function clampInspectorWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_THREAD_INSPECTOR_STATE.width
  return Math.min(520, Math.max(260, Math.round(width)))
}

export function parseThreadInspectorState(value: unknown): ThreadInspectorState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_THREAD_INSPECTOR_STATE }
  const candidate = value as Record<string, unknown>
  return {
    open: candidate.open === true,
    tab: typeof candidate.tab === 'string' && INSPECTOR_TABS.has(candidate.tab as ThreadInspectorTab)
      ? candidate.tab as ThreadInspectorTab
      : 'overview',
    width: clampInspectorWidth(typeof candidate.width === 'number' ? candidate.width : 292),
    lastAttentionKey: typeof candidate.lastAttentionKey === 'string' ? candidate.lastAttentionKey : undefined,
  }
}

export function selectInspectorAttention(input: {
  run?: AgentRunBlock
  failedChecks: string[]
  changedPaths: string[]
}): ThreadInspectorAttention | undefined {
  const request = input.run?.inputRequest
  if (request?.kind === 'approval') {
    return { key: `approval:${request.id ?? request.prompt}`, tab: 'access' }
  }
  if (request) {
    return { key: `input:${request.id ?? request.prompt}`, tab: 'overview' }
  }
  if (input.failedChecks.length) {
    return { key: `checks:${input.failedChecks.join('|')}`, tab: 'checks' }
  }
  if (input.run?.failure) {
    return { key: `failure:${input.run.id}:${input.run.failure.kind}`, tab: 'activity' }
  }
  if (input.changedPaths.length) {
    return { key: `changes:${input.changedPaths.join('|')}`, tab: 'changes' }
  }
  if (input.run && !input.run.done) {
    return { key: `run:${input.run.id}`, tab: 'overview' }
  }
  return undefined
}
