import type { AgentRunBlock, ProjectSource, RunSourceRef } from '../../types'
import type { RuntimeRunSummary, SessionEvent } from '../../services/contracts'
import {
  EVIDENCE_SCHEMA_VERSION,
  RESOURCE_REF_SCHEMA_VERSION,
  type EvidenceCitation,
  type EvidenceDomainError,
  type EvidenceFreshness,
  type EvidenceGap,
  type EvidencePacket,
  type OperationBlocker,
  type OperationOutcome,
  type OperationPhase,
  type OperationPresentation,
  type OperationState,
  type ResourceRef,
  type SemanticBadge,
} from './contracts'

export function evaluateFreshness(
  input: { observedAt?: number; freshUntil?: number },
  now: number,
): EvidenceFreshness {
  const observedAt = Number.isFinite(input.observedAt) ? input.observedAt : undefined
  const freshUntil = Number.isFinite(input.freshUntil) ? input.freshUntil : undefined
  const ageMs = observedAt === undefined ? undefined : Math.max(0, now - observedAt)
  if (freshUntil === undefined) return { observedAt, freshUntil, status: 'unknown', ageMs }
  if (now <= freshUntil) return { observedAt, freshUntil, status: 'fresh', ageMs }
  return { observedAt, freshUntil, status: 'stale', ageMs, staleByMs: now - freshUntil }
}

export function adaptProjectSourceRef(source: ProjectSource): ResourceRef {
  return {
    schemaVersion: RESOURCE_REF_SCHEMA_VERSION,
    authority: { kind: 'connector', id: source.kind },
    kind: 'project_source',
    id: source.externalId || source.id,
    version: { kind: 'timestamp', value: new Date(source.lastSyncAt).toISOString() },
  }
}

export interface AdaptRunEvidenceInput {
  run: AgentRunBlock
  projectSources?: readonly ProjectSource[]
  events?: readonly SessionEvent[]
  generatedAt: number
  freshnessWindowMs?: number
}

function sourceCitation(
  source: RunSourceRef,
  projectSources: readonly ProjectSource[],
  generatedAt: number,
  freshnessWindowMs: number,
): { citation?: EvidenceCitation; gap?: EvidenceGap } {
  const matched = projectSources.find((candidate) =>
    candidate.id === source.id || candidate.externalId === source.id)
  if (!matched) {
    return {
      gap: {
        id: `source-${encodeURIComponent(source.id)}-version`,
        kind: 'missing_version',
        summary: `${source.label} was used without an exact source version.`,
      },
    }
  }

  const ref = adaptProjectSourceRef(matched)
  return {
    citation: {
      id: `source-${encodeURIComponent(source.id)}`,
      source: ref,
      title: source.label,
      locator: source.detail,
      freshness: evaluateFreshness({
        observedAt: matched.lastSyncAt,
        freshUntil: matched.lastSyncAt + freshnessWindowMs,
      }, generatedAt),
    },
  }
}

function eventGaps(events: readonly SessionEvent[]): EvidenceGap[] {
  return events.flatMap((event) => {
    if (event.type !== 'warning') return []
    const gap = event.payload.evidenceGap
    if (!gap || typeof gap !== 'object' || Array.isArray(gap)) return []
    const record = gap as Record<string, unknown>
    const kind = record.kind
    const summary = record.summary
    if (
      (kind !== 'missing_source' && kind !== 'missing_version' && kind !== 'missing_content' && kind !== 'coverage')
      || typeof summary !== 'string'
      || !summary.trim()
    ) return []
    return [{ id: `event-${event.event_id}-gap`, kind, summary: summary.trim() }]
  })
}

/** Adapts existing durable run/source/event projections; it does not create server state. */
export function adaptRunEvidencePacket(input: AdaptRunEvidenceInput): EvidencePacket {
  const citations: EvidenceCitation[] = []
  const gaps: EvidenceGap[] = []
  const freshnessWindowMs = input.freshnessWindowMs ?? 24 * 60 * 60 * 1000
  for (const source of input.run.sources ?? []) {
    const adapted = sourceCitation(source, input.projectSources ?? [], input.generatedAt, freshnessWindowMs)
    if (adapted.citation) citations.push(adapted.citation)
    if (adapted.gap) gaps.push(adapted.gap)
  }
  gaps.push(...eventGaps(input.events ?? []))

  const errors: EvidenceDomainError[] = citations
    .filter((citation) => citation.freshness.status === 'stale')
    .map((citation) => ({
      code: 'stale_evidence',
      message: 'One or more cited sources are stale.',
      retryable: true,
      resource: citation.source,
    }))

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    id: `run-${encodeURIComponent(input.run.id)}-evidence`,
    generatedAt: input.generatedAt,
    citations,
    conflicts: [],
    gaps,
    lineage: [],
    policyOmissions: [],
    errors,
  }
}

function includesAny(value: string, terms: readonly string[]): boolean {
  const normalized = value.toLowerCase()
  return terms.some((term) => normalized.includes(term))
}

function operationError(run: AgentRunBlock, runtime?: RuntimeRunSummary): EvidenceDomainError | undefined {
  const text = `${run.statusText} ${runtime?.error ?? ''}`.toLowerCase()
  if (includesAny(text, ['policy denied', 'policy_denied'])) return { code: 'policy_denied', message: 'Policy denied this operation.', retryable: false }
  if (includesAny(text, ['provider denied', 'provider_denied'])) return { code: 'provider_denied', message: 'The provider denied this operation.', retryable: true }
  if (includesAny(text, ['version conflict', 'version_conflict'])) return { code: 'version_conflict', message: 'The source version changed.', retryable: true }
  if (includesAny(text, ['stale evidence', 'stale_evidence'])) return { code: 'stale_evidence', message: 'The operation depends on stale evidence.', retryable: true }
  if (run.inputRequest?.kind === 'approval' || includesAny(text, ['approval required', 'awaiting approval'])) {
    return { code: 'approval_required', message: 'Approval is required to continue.', retryable: true }
  }
  if (run.failure?.kind === 'runtime' || includesAny(text, ['runtime unavailable', 'runtime_unavailable'])) {
    return { code: 'runtime_unavailable', message: 'The selected runtime is unavailable.', retryable: true }
  }
  if (run.failure?.kind === 'permission') return { code: 'provider_denied', message: 'The provider denied this operation.', retryable: true }
  return undefined
}

function latestEventType(events: readonly SessionEvent[]): SessionEvent['type'] | undefined {
  return [...events].sort((left, right) => left.sequence - right.sequence).at(-1)?.type
}

function derivePhase(run: AgentRunBlock, events: readonly SessionEvent[]): OperationPhase {
  const eventTypes = new Set(events.map((event) => event.type))
  if (eventTypes.has('review.started') || eventTypes.has('review.completed') || eventTypes.has('review.failed')) return 'review'
  if (eventTypes.has('verification.started') || eventTypes.has('verification.completed')) return 'verification'
  if (run.done || latestEventType(events) === 'session.closed') return 'delivery'
  if (run.plan.some((step) => step.status === 'active') || includesAny(run.statusText, ['plan'])) return 'planning'
  if (events.some((event) => event.type === 'agent.started' || event.type.startsWith('tool.'))) return 'execution'
  return 'intake'
}

function deriveState(run: AgentRunBlock, runtime: RuntimeRunSummary | undefined): OperationState {
  const status = runtime?.status
  if (run.done || status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'timed_out') return 'terminal'
  if (status === 'queued' || includesAny(run.statusText, ['queue'])) return 'queued'
  if (status === 'paused' || includesAny(run.statusText, ['pause'])) return 'paused'
  if (status === 'waiting' || status === 'awaiting_input' || run.inputRequest) return 'waiting'
  return 'active'
}

function stateBadge(state: OperationState): SemanticBadge {
  const tone = state === 'active' ? 'info' : state === 'waiting' ? 'warning' : 'neutral'
  return { label: state[0].toUpperCase() + state.slice(1), tone }
}

function outcomeBadge(outcome: OperationOutcome): SemanticBadge {
  const tone = outcome === 'succeeded' ? 'success' : outcome === 'failed' ? 'danger' : outcome === 'partial' ? 'warning' : 'neutral'
  return { label: outcome[0].toUpperCase() + outcome.slice(1), tone }
}

function blockerFrom(error: EvidenceDomainError | undefined, run: AgentRunBlock): OperationBlocker {
  if (error) return error.code
  if (run.inputRequest?.kind === 'clarification') return 'input_required'
  if (includesAny(run.statusText, ['blocked'])) return 'unknown'
  return 'none'
}

function outcomeFrom(run: AgentRunBlock, runtime: RuntimeRunSummary | undefined): OperationOutcome {
  if (runtime?.status === 'cancelled' || includesAny(run.statusText, ['cancel', 'stop'])) return 'cancelled'
  if (runtime?.status === 'failed' || runtime?.status === 'timed_out' || run.failure) return 'failed'
  if (run.done || runtime?.status === 'completed') return 'succeeded'
  if (includesAny(run.statusText, ['partial'])) return 'partial'
  return 'pending'
}

export function adaptOperationPresentation(
  run: AgentRunBlock,
  runtime?: RuntimeRunSummary,
  events: readonly SessionEvent[] = [],
): OperationPresentation {
  const state = deriveState(run, runtime)
  const phase = derivePhase(run, events)
  const error = operationError(run, runtime)
  const outcome = outcomeFrom(run, runtime)
  const blocker = blockerFrom(error, run)
  return {
    state,
    phase,
    blocker,
    outcome,
    stateBadge: stateBadge(state),
    phaseLabel: phase[0].toUpperCase() + phase.slice(1),
    blockerLabel: blocker === 'none' ? undefined : blocker.replaceAll('_', ' '),
    outcomeBadge: outcomeBadge(outcome),
    error,
  }
}
