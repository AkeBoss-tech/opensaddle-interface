import React, { useRef, useState, type KeyboardEvent } from 'react'
import type { EvidencePresentation, PresentationCitation, ResourceRef } from './contracts'
import { resourceRefKey } from './authority'
import {
  evidenceCitationStatus,
  freshnessLabel,
  nextEvidenceCitationIndex,
  sourceRole,
  sourceVersionLabel,
  type EvidenceNavigationKey,
} from './presentation'

// The repository's Node TSX test runner uses the classic JSX runtime.
void React

function formatTime(value: number | undefined): string {
  return value === undefined ? 'Not recorded' : new Date(value).toLocaleString()
}

function ResourceIdentity({ source }: { source: ResourceRef }) {
  return (
    <dl className="evidence-metadata">
      <div><dt>Authority</dt><dd>{source.authority.kind} · {source.authority.id}</dd></div>
      <div><dt>Resource</dt><dd>{source.kind} · {source.id}</dd></div>
      <div><dt>Exact version</dt><dd><code>{sourceVersionLabel(source)}</code></dd></div>
    </dl>
  )
}

function CitationDetails({ citation, presentation }: {
  citation: PresentationCitation
  presentation: EvidencePresentation
}) {
  if (citation.visibility === 'redacted') {
    return <p className="evidence-safe-note">Details were removed before presentation. No restricted identifiers or content are available here.</p>
  }

  return (
    <div className="evidence-citation-details">
      <ResourceIdentity source={citation.source} />
      <dl className="evidence-metadata">
        <div><dt>Authority class</dt><dd>{citation.authority.badge.label} — {citation.authority.description}</dd></div>
        <div><dt>Lineage role</dt><dd>{sourceRole(presentation, citation.source) === 'derived' ? 'Derived evidence' : 'Direct source evidence'}</dd></div>
        <div><dt>Observation</dt><dd>{citation.freshness.observedAt === undefined ? 'No cached observation timestamp' : `Cached snapshot observed ${formatTime(citation.freshness.observedAt)}`}</dd></div>
        <div><dt>Freshness</dt><dd>{freshnessLabel(citation.freshness)}{citation.freshness.freshUntil === undefined ? '' : ` · valid through ${formatTime(citation.freshness.freshUntil)}`}</dd></div>
      </dl>
      {citation.locator && <p className="evidence-locator"><strong>Locator:</strong> <code>{citation.locator}</code></p>}
      {citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}
    </div>
  )
}

function resourceSummary(source: ResourceRef): string {
  return `${source.authority.kind}:${source.authority.id} / ${source.kind}:${source.id} / ${sourceVersionLabel(source)}`
}

export function EvidenceInspector({ presentation }: { presentation: EvidencePresentation }) {
  const [expandedId, setExpandedId] = useState<string | null>(presentation.citations[0]?.id ?? null)
  const [focusIndex, setFocusIndex] = useState(0)
  const citationRefs = useRef<Array<HTMLButtonElement | null>>([])
  const issueCount = presentation.conflicts.length + presentation.gaps.length + presentation.errors.length
  const staleCount = presentation.citations.filter((citation) =>
    citation.visibility === 'visible' && citation.freshness.status === 'stale').length
  const isEmpty = presentation.citations.length === 0
    && issueCount === 0
    && presentation.lineage.length === 0
    && presentation.omissions.length === 0

  const moveCitationFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const next = nextEvidenceCitationIndex(index, event.key as EvidenceNavigationKey, presentation.citations.length)
    if (next < 0) return
    event.preventDefault()
    setFocusIndex(next)
    citationRefs.current[next]?.focus()
  }

  return (
    <section className="evidence-inspector" aria-labelledby="thread-evidence-heading">
      <header className="evidence-summary">
        <div>
          <h2 id="thread-evidence-heading">Thread evidence</h2>
          <p>Versioned sources used by the current run. Presentation policy is applied before this view.</p>
        </div>
        <span className="evidence-schema">{presentation.schemaVersion}</span>
      </header>

      <dl className="evidence-overview" aria-label="Evidence summary">
        <div><dt>Citations</dt><dd>{presentation.citations.length}</dd></div>
        <div><dt>Stale</dt><dd>{staleCount}</dd></div>
        <div><dt>Issues</dt><dd>{issueCount}</dd></div>
        <div><dt>Generated</dt><dd>{formatTime(presentation.generatedAt)}</dd></div>
      </dl>

      {isEmpty && (
        <div className="evidence-state" role="status">
          <h3>No versioned evidence yet</h3>
          <p>Evidence appears after a run cites a source with an exact version or digest.</p>
        </div>
      )}

      {!!presentation.citations.length && (
        <section aria-labelledby="evidence-citations-heading">
          <h3 id="evidence-citations-heading">Citations</h3>
          <p className="evidence-keyboard-help">Use Up and Down Arrow keys to move between citations; press Enter or Space to expand one.</p>
          <ul className="evidence-citations" aria-label="Versioned citations">
            {presentation.citations.map((citation, index) => {
              const expanded = expandedId === citation.id
              const detailId = `evidence-citation-${index}-details`
              return (
                <li key={citation.id}>
                  <article className={`evidence-citation ${citation.visibility === 'redacted' ? 'is-restricted' : ''}`}>
                    <button
                      ref={(element) => { citationRefs.current[index] = element }}
                      type="button"
                      className="evidence-citation-toggle"
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      tabIndex={focusIndex === index ? 0 : -1}
                      onFocus={() => setFocusIndex(index)}
                      onKeyDown={(event) => moveCitationFocus(event, index)}
                      onClick={() => setExpandedId(expanded ? null : citation.id)}
                    >
                      <span className="evidence-citation-title">{citation.title}</span>
                      <span className="evidence-citation-status">{evidenceCitationStatus(presentation, citation)}</span>
                      {citation.visibility === 'visible' && (
                        <span className="evidence-citation-version"><span>{citation.authority.badge.label}: {citation.authority.label}</span><code>{sourceVersionLabel(citation.source)}</code></span>
                      )}
                      <span aria-hidden="true" className="evidence-disclosure">{expanded ? '−' : '+'}</span>
                    </button>
                    {expanded && <div id={detailId}><CitationDetails citation={citation} presentation={presentation} /></div>}
                  </article>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {!!presentation.conflicts.length && (
        <section className="evidence-issues" aria-labelledby="evidence-conflicts-heading">
          <h3 id="evidence-conflicts-heading">Conflicts</h3>
          <ul>{presentation.conflicts.map((conflict) => <li key={conflict.id}><strong>Conflicting evidence</strong><span>{conflict.summary}</span><small>{conflict.citationIds.length} linked citation{conflict.citationIds.length === 1 ? '' : 's'}</small></li>)}</ul>
        </section>
      )}

      {!!presentation.gaps.length && (
        <section className="evidence-issues" aria-labelledby="evidence-gaps-heading">
          <h3 id="evidence-gaps-heading">Evidence gaps</h3>
          <ul>{presentation.gaps.map((gap) => <li key={gap.id}><strong>{gap.kind.replaceAll('_', ' ')}</strong><span>{gap.summary}</span>{gap.source && <small>{resourceSummary(gap.source)}</small>}</li>)}</ul>
        </section>
      )}

      {!!presentation.lineage.length && (
        <section className="evidence-lineage" aria-labelledby="evidence-lineage-heading">
          <h3 id="evidence-lineage-heading">Lineage</h3>
          <ol>{presentation.lineage.map((edge, index) => <li key={`${resourceRefKey(edge.from)}-${resourceRefKey(edge.to)}-${index}`}><span>{resourceSummary(edge.to)}</span><strong>{edge.relation.replaceAll('_', ' ')}</strong><span>{resourceSummary(edge.from)}</span></li>)}</ol>
        </section>
      )}

      {!!presentation.omissions.length && (
        <section className="evidence-omissions" aria-labelledby="evidence-omissions-heading">
          <h3 id="evidence-omissions-heading">Policy omissions</h3>
          <ul>{presentation.omissions.map((omission) => <li key={omission.id}><strong>{omission.count} omitted</strong><span>{omission.message}</span><small>{omission.reason.replaceAll('_', ' ')}</small></li>)}</ul>
        </section>
      )}

      {!!presentation.errors.length && (
        <section className="evidence-errors" aria-labelledby="evidence-errors-heading" aria-live="polite">
          <h3 id="evidence-errors-heading">Evidence errors</h3>
          <ul>{presentation.errors.map((error, index) => <li key={`${error.code}-${index}`}><strong>{error.code.replaceAll('_', ' ')}</strong><span>{error.message}</span><small>{error.retryable ? 'Retry may recover this evidence.' : 'This error is not retryable.'}</small></li>)}</ul>
        </section>
      )}
    </section>
  )
}
