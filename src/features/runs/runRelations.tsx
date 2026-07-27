import { useMemo } from 'react'
import { Icon } from '../../components/common/Icon'
import './runRelations.css'

export type RelatedRunStatus = 'queued' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed' | 'stopped'

/** Structural subset shared by SessionEvent and future remote event contracts. */
export interface RunEventLike {
  run_id?: string
  runId?: string
  sequence?: number
  timestamp?: string
  type: string
  payload?: Record<string, unknown>
}

/** Structural subset shared by ManagedRun, restored runs, and server snapshots. */
export interface RunRecordLike {
  runId?: string
  id?: string
  parentRunId?: string
  parent_run_id?: string
  threadId?: string
  eventCount?: number
  lastEvent?: RunEventLike
  run?: {
    id?: string
    title?: string
    statusText?: string
    done?: boolean
    model?: string
    harness?: string
    runtime?: string
    duration?: string
  }
}

/** Structural subset shared by project sources and event-provided citations. */
export interface SourceRecordLike {
  id: string
  name: string
  kind?: string
  externalId?: string
  url?: string
  status?: string
  branch?: string
}

export interface RelatedRun {
  id: string
  parentRunId: string
  title: string
  status: RelatedRunStatus
  statusText: string
  model?: string
  harness?: string
  runtime?: string
  duration?: string
  eventCount?: number
}

export interface UsedRunSource {
  id: string
  name: string
  kind: string
  detail?: string
  url?: string
  status?: string
  eventType?: string
}

export interface RunRelationsInput {
  parentRunId: string
  runs: readonly RunRecordLike[]
  events?: readonly RunEventLike[]
  explicitChildren?: readonly RelatedRun[]
}

export interface UsedSourcesInput {
  runId: string
  events?: readonly RunEventLike[]
  sources?: readonly SourceRecordLike[]
  relatedRunIds?: readonly string[]
  explicitSources?: readonly UsedRunSource[]
}

export interface RunRelationsPanelProps extends RunRelationsInput {
  sources?: readonly SourceRecordLike[]
  explicitSources?: readonly UsedRunSource[]
  onOpenRun?: (runId: string) => void
  onOpenSource?: (source: UsedRunSource) => void
  title?: string
}

const PARENT_KEYS = ['parentRunId', 'parent_run_id', 'parentRun', 'parent_run'] as const
const CHILD_KEYS = ['childRunId', 'child_run_id', 'childRun', 'child_run'] as const
const SOURCE_KEYS = ['source', 'sources', 'sourceId', 'sourceIds', 'source_id', 'source_ids', 'citations'] as const

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function firstString(record: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (!record) return undefined
  for (const key of keys) {
    const direct = stringValue(record[key])
    if (direct) return direct
    const nested = recordValue(record[key])
    const nestedId = firstString(nested, ['runId', 'run_id', 'id'])
    if (nestedId) return nestedId
  }
  return undefined
}

function recordRunId(run: RunRecordLike): string | undefined {
  return stringValue(run.runId) ?? stringValue(run.id) ?? stringValue(run.run?.id)
}

function eventRunId(event: RunEventLike): string | undefined {
  return stringValue(event.run_id) ?? stringValue(event.runId)
}

function statusFrom(run: RunRecordLike | undefined, event: RunEventLike | undefined): RelatedRunStatus {
  const type = event?.type ?? ''
  const statusText = run?.run?.statusText?.toLowerCase() ?? ''
  if (type === 'agent.failed' || statusText.includes('fail') || statusText.includes('error')) return 'failed'
  if (statusText.includes('stop') || statusText.includes('cancel')) return 'stopped'
  if (run?.run?.done || type === 'agent.completed' || type === 'session.closed') return 'completed'
  if (type === 'agent.paused' || statusText.includes('paused')) return 'paused'
  if (
    type === 'agent.input.requested'
    || type === 'approval.requested'
    || statusText.includes('waiting')
    || statusText.includes('approval')
  ) return 'waiting'
  if (type === 'session.created' || statusText.includes('queued')) return 'queued'
  return 'running'
}

function eventTitle(event: RunEventLike | undefined, fallback: string): string {
  const payload = event?.payload
  return firstString(payload, ['title', 'name', 'task', 'label']) ?? fallback
}

function relationFrom(runId: string, parentRunId: string, run: RunRecordLike | undefined, event: RunEventLike | undefined): RelatedRun {
  const status = statusFrom(run, event)
  const title = run?.run?.title ?? eventTitle(event, `Subagent ${runId.slice(0, 8)}`)
  return {
    id: runId,
    parentRunId,
    title,
    status,
    statusText: run?.run?.statusText ?? status[0].toUpperCase() + status.slice(1),
    model: run?.run?.model,
    harness: run?.run?.harness,
    runtime: run?.run?.runtime,
    duration: run?.run?.duration,
    eventCount: run?.eventCount,
  }
}

/**
 * Derive direct children from explicit records or event payloads.
 *
 * Supported event shapes include:
 * - child event: `{ run_id: child, payload: { parent_run_id: parent } }`
 * - parent event: `{ run_id: parent, payload: { childRunId: child } }`
 */
export function selectRelatedRuns(input: RunRelationsInput): RelatedRun[] {
  const byId = new Map<string, RunRecordLike>()
  for (const run of input.runs) {
    const id = recordRunId(run)
    if (id) byId.set(id, run)
  }

  const latestEvent = new Map<string, RunEventLike>()
  const childIds = new Set<string>()

  for (const run of input.runs) {
    const id = recordRunId(run)
    const parent = stringValue(run.parentRunId)
      ?? stringValue(run.parent_run_id)
      ?? firstString(run.lastEvent?.payload, PARENT_KEYS)
    if (id && parent === input.parentRunId) childIds.add(id)
    if (id && run.lastEvent) latestEvent.set(id, run.lastEvent)
  }

  for (const event of input.events ?? []) {
    const ownRunId = eventRunId(event)
    if (ownRunId) {
      const previous = latestEvent.get(ownRunId)
      const failureAlreadyRecorded = previous?.type === 'agent.failed'
      const recordsFailure = event.type === 'agent.failed'
      if (recordsFailure || (!failureAlreadyRecorded && (!previous || (event.sequence ?? 0) >= (previous.sequence ?? 0)))) {
        latestEvent.set(ownRunId, event)
      }
    }

    const parent = firstString(event.payload, PARENT_KEYS)
    if (ownRunId && parent === input.parentRunId) childIds.add(ownRunId)

    const child = firstString(event.payload, CHILD_KEYS)
    if (child && ownRunId === input.parentRunId) childIds.add(child)
  }

  const explicit = new Map((input.explicitChildren ?? []).map((child) => [child.id, child]))
  for (const id of explicit.keys()) childIds.add(id)

  return [...childIds]
    .map((id) => explicit.get(id) ?? relationFrom(id, input.parentRunId, byId.get(id), latestEvent.get(id)))
    .sort((left, right) => {
      const rank: Record<RelatedRunStatus, number> = {
        waiting: 0, running: 1, paused: 2, failed: 3, stopped: 4, queued: 5, completed: 6,
      }
      return rank[left.status] - rank[right.status] || left.title.localeCompare(right.title)
    })
}

function sourceLookup(sources: readonly SourceRecordLike[]): Map<string, SourceRecordLike> {
  const lookup = new Map<string, SourceRecordLike>()
  for (const source of sources) {
    for (const key of [source.id, source.externalId, source.url, source.name]) {
      if (key) lookup.set(key.toLowerCase(), source)
    }
  }
  return lookup
}

function inferredSource(value: unknown, lookup: Map<string, SourceRecordLike>, eventType?: string): UsedRunSource | undefined {
  const raw = stringValue(value)
  const object = recordValue(value)
  const reference = raw ?? firstString(object, ['sourceId', 'source_id', 'id', 'externalId', 'url', 'path', 'name', 'title'])
  if (!reference) return undefined

  const known = lookup.get(reference.toLowerCase())
  if (known) {
    return {
      id: known.id,
      name: known.name,
      kind: known.kind ?? 'source',
      detail: known.externalId ?? known.branch,
      url: known.url,
      status: known.status,
      eventType,
    }
  }

  const name = firstString(object, ['name', 'title', 'label', 'path'])
    ?? reference.split('/').filter(Boolean).at(-1)
    ?? reference
  return {
    id: firstString(object, ['sourceId', 'source_id', 'id']) ?? reference,
    name,
    kind: firstString(object, ['kind', 'type', 'provider']) ?? (reference.startsWith('http') ? 'web' : 'source'),
    detail: firstString(object, ['detail', 'externalId', 'path']),
    url: firstString(object, ['url', 'href']),
    status: firstString(object, ['status']),
    eventType,
  }
}

function sourceValues(payload: Record<string, unknown> | undefined): unknown[] {
  if (!payload) return []
  const values: unknown[] = []
  for (const key of SOURCE_KEYS) {
    const value = payload[key]
    if (Array.isArray(value)) values.push(...value)
    else if (value !== undefined) values.push(value)
  }
  return values
}

/** Return sources actually referenced by this run tree, not every project source. */
export function selectUsedRunSources(input: UsedSourcesInput): UsedRunSource[] {
  const lookup = sourceLookup(input.sources ?? [])
  const runIds = new Set([input.runId, ...(input.relatedRunIds ?? [])])
  const result = new Map<string, UsedRunSource>()

  for (const source of input.explicitSources ?? []) result.set(source.id, source)

  for (const event of input.events ?? []) {
    const id = eventRunId(event)
    if (!id || !runIds.has(id)) continue
    for (const value of sourceValues(event.payload)) {
      const source = inferredSource(value, lookup, event.type)
      if (!source) continue
      const existing = result.get(source.id)
      result.set(source.id, existing ? { ...existing, ...source } : source)
    }
  }

  return [...result.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function runStatusLabel(status: RelatedRunStatus): string {
  if (status === 'completed') return 'Done'
  return status[0].toUpperCase() + status.slice(1)
}

function sourceIcon(kind: string): string {
  if (kind === 'github' || kind === 'repository') return 'git'
  if (kind === 'web') return 'globe'
  if (kind === 'slack') return 'message'
  if (kind === 'jira') return 'review'
  return 'file'
}

export function ChildRunList({
  runs,
  onOpenRun,
}: {
  runs: readonly RelatedRun[]
  onOpenRun?: (runId: string) => void
}) {
  if (!runs.length) return <p className="run-relations-empty">No delegated runs for this task</p>
  return (
    <div className="run-relations-list" role="list">
      {runs.map((child) => (
        <button
          type="button"
          className="run-relation-row"
          key={child.id}
          onClick={() => onOpenRun?.(child.id)}
          disabled={!onOpenRun}
          role="listitem"
        >
          <span className={`run-relation-status ${child.status}`} aria-label={runStatusLabel(child.status)} />
          <span className="run-relation-copy">
            <strong>{child.title}</strong>
            <small>{[child.statusText, child.model, child.duration].filter(Boolean).join(' · ')}</small>
          </span>
          <span className="run-relation-badge">{runStatusLabel(child.status)}</span>
          {onOpenRun && <Icon name="chevron" className="icon xs" />}
        </button>
      ))}
    </div>
  )
}

export function UsedSourcesList({
  sources,
  onOpenSource,
}: {
  sources: readonly UsedRunSource[]
  onOpenSource?: (source: UsedRunSource) => void
}) {
  if (!sources.length) return <p className="run-relations-empty">No sources recorded for this run</p>
  return (
    <div className="run-relations-list" role="list">
      {sources.map((source) => (
        <button
          type="button"
          className="run-relation-row"
          key={source.id}
          onClick={() => onOpenSource?.(source)}
          disabled={!onOpenSource}
          role="listitem"
        >
          <span className="run-relation-icon"><Icon name={sourceIcon(source.kind)} className="icon sm" /></span>
          <span className="run-relation-copy">
            <strong>{source.name}</strong>
            <small>{source.detail ?? source.kind}</small>
          </span>
          {source.status && <span className="run-relation-badge">{source.status}</span>}
          {onOpenSource && <Icon name="chevron" className="icon xs" />}
        </button>
      ))}
    </div>
  )
}

/**
 * Drop-in state-rail section. It accepts the current registry records and raw
 * events while remaining independent of RunRegistry and the workspace store.
 */
export function RunRelationsPanel({
  parentRunId,
  runs,
  events = [],
  sources = [],
  explicitChildren,
  explicitSources,
  onOpenRun,
  onOpenSource,
  title = 'Run context',
}: RunRelationsPanelProps) {
  const children = useMemo(
    () => selectRelatedRuns({ parentRunId, runs, events, explicitChildren }),
    [events, explicitChildren, parentRunId, runs],
  )
  const usedSources = useMemo(
    () => selectUsedRunSources({
      runId: parentRunId,
      events,
      sources,
      relatedRunIds: children.map((child) => child.id),
      explicitSources,
    }),
    [children, events, explicitSources, parentRunId, sources],
  )

  return (
    <section className="run-relations-panel" aria-label={title}>
      <div className="run-relations-heading">
        <h3>{title}</h3>
        <span>{children.length + usedSources.length}</span>
      </div>
      <div className="run-relations-section">
        <div className="run-relations-section-title">
          <span>Subagents</span>
          <small>{children.length}</small>
        </div>
        <ChildRunList runs={children} onOpenRun={onOpenRun} />
      </div>
      <div className="run-relations-section">
        <div className="run-relations-section-title">
          <span>Used sources</span>
          <small>{usedSources.length}</small>
        </div>
        <UsedSourcesList sources={usedSources} onOpenSource={onOpenSource} />
      </div>
    </section>
  )
}
