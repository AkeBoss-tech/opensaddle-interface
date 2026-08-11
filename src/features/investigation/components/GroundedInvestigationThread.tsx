import React, { useEffect, useMemo, useState } from 'react'
import type { HumanPlanDraft, InvestigationFailure, InvestigationProjection, InvestigationSnapshot } from '../domain'
import { evidenceAnchor, presentContextBrief, shortDigest, type ContextBriefPresentation } from './presentation'
import type { OperationProposalPresentation, ProposalBlockerCode, ProposalEffectClass } from './operationProposal'
import { isPlanBindingInvalidated, planFields, type PlanFields } from './planState'

void React

function lines(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean)
}

function resourceLabel(resource: InvestigationProjection['repository']): string {
  return resource.resourceId.split('/').at(-1) ?? resource.resourceId
}

function ResourceReference({ resource, label }: { resource: InvestigationProjection['repository']; label: string }) {
  return (
    <article className="gi-resource">
      <span className="gi-eyebrow">{label}</span>
      <strong>{resourceLabel(resource)}</strong>
      <span className="gi-source-origin" aria-label={`${label} origin`}>{resource.source.origin}</span>
      <dl>
        <div><dt>Resource</dt><dd>{resource.resourceId}</dd></div>
        <div><dt>Authority</dt><dd>{resource.issuer}</dd></div>
        <div><dt>Version</dt><dd><code>{resource.version}</code></dd></div>
        <div><dt>Digest</dt><dd><code title={resource.digest.value}>{shortDigest(resource.digest.value)}</code></dd></div>
      </dl>
    </article>
  )
}

function LifecycleNotice({ snapshot, onRetry, onCancel, onReconnect }: {
  snapshot: InvestigationSnapshot
  onRetry: () => Promise<void>
  onCancel: () => Promise<void>
  onReconnect: () => Promise<void>
}) {
  const lifecycle = snapshot.lifecycle
  const [actionError, setActionError] = useState('')
  const perform = (action: () => Promise<void>) => void action().catch((error) => setActionError(error instanceof Error ? error.message : 'Investigation request failed'))
  if (lifecycle.phase === 'settled' && !actionError) return null
  const failure: InvestigationFailure | undefined = lifecycle.phase === 'failed' ? lifecycle.failure : undefined
  const requesting = lifecycle.phase === 'requesting'
  return (
    <aside className={`gi-notice ${failure || actionError ? 'is-error' : ''}`} aria-live="polite">
      <div>
        <strong>{requesting ? `${lifecycle.operation[0]!.toUpperCase()}${lifecycle.operation.slice(1)} in progress` : failure ? failure.code.replaceAll('_', ' ') : actionError ? 'Request failed' : 'Connecting to investigation'}</strong>
        <p>{failure?.message ?? actionError ?? (requesting ? 'The authoritative projection will remain visible while this request settles.' : 'Reconnecting to the authoritative investigation state.')}</p>
      </div>
      <div className="gi-actions">
        {(failure?.retryable || actionError) && <button type="button" onClick={() => perform(onRetry)}>Retry</button>}
        {!requesting && <button type="button" onClick={() => perform(onReconnect)}>Reconnect</button>}
        {requesting && lifecycle.operation !== 'cancel' && <button type="button" onClick={() => perform(onCancel)}>Cancel request</button>}
      </div>
    </aside>
  )
}

function ContextBrief({ brief }: { brief: ContextBriefPresentation }) {
  return (
    <section className="gi-card gi-context" aria-labelledby="gi-context-title">
      <header className="gi-card-head">
        <div><span className="gi-eyebrow">KRAIL Context Brief</span><h2 id="gi-context-title">Grounded context</h2></div>
        <span className="gi-version">{brief.schemaVersion}</span>
      </header>
      <div className="gi-contract-strip">
        <span>Evaluated <time dateTime={brief.evaluatedAt}>{new Date(brief.evaluatedAt).toLocaleString()}</time></span>
        <span>Brief digest <code title={brief.briefDigest}>{shortDigest(brief.briefDigest)}</code></span>
      </div>

      {!!brief.assertions.length && <div className="gi-assertions" aria-label="Context assertions">
        {brief.assertions.map((assertion) => <blockquote key={assertion.id}>
          <p>{assertion.text}</p>
          <footer>{assertion.source.resourceId} · <code>{assertion.locator}</code></footer>
        </blockquote>)}
      </div>}

      <div className="gi-summary-grid">
        <article>
          <h3>Freshness <span>{brief.freshness.length}</span></h3>
          {brief.freshness.length ? <ul>{brief.freshness.map((item) => <li key={`${item.source.resourceId}-${item.processingVersion}`}>
            <span className={`gi-status is-${item.status}`}>{item.status}</span>
            <div><strong>{item.source.resourceId}</strong><small>{item.basis}</small></div>
          </li>)}</ul> : <p>No freshness assessment was supplied.</p>}
        </article>
        <article>
          <h3>Conflicts <span>{brief.conflicts.length}</span></h3>
          {brief.conflicts.length ? <ul>{brief.conflicts.map((item, index) => <li key={`${item.processingVersion}-${index}`}><div><strong>{item.basis}</strong><small>{item.sources.map((source) => source.resourceId).join(' ↔ ')}</small></div></li>)}</ul> : <p>No source conflicts detected.</p>}
        </article>
        <article>
          <h3>Gaps <span>{brief.gaps.length}</span></h3>
          {brief.gaps.length ? <ul>{brief.gaps.map((item) => <li key={item.code}><div><strong>{item.code}</strong><small>{item.message}</small></div></li>)}</ul> : <p>No declared coverage gaps.</p>}
        </article>
      </div>

      {(brief.omissions.length > 0 || brief.truncated) && <aside className="gi-omissions" aria-label="Policy omissions">
        <strong>Safe policy omissions</strong>
        {brief.omissions.map((message) => <p key={message}>{message}</p>)}
        {brief.truncated && <p>Context was bounded before presentation; omitted identities and counts are not disclosed.</p>}
      </aside>}

      <div className="gi-evidence">
        <div className="gi-section-title"><div><span className="gi-eyebrow">Lineage &amp; evidence</span><h3>Versioned source links</h3></div><span>{brief.evidence.length}</span></div>
        {brief.evidence.length ? <ol>{brief.evidence.map((item) => <li id={evidenceAnchor(item.id)} key={item.id}>
          <a href={`#${evidenceAnchor(item.id)}`}>{item.source.resourceId}</a>
          <span>{item.source.resourceType} · {item.relation.replace('_', ' ')} · {item.locator}</span>
          <code title={item.recordDigest}>{shortDigest(item.recordDigest)}</code>
        </li>)}</ol> : <p>No authorized evidence references were supplied.</p>}
      </div>
    </section>
  )
}

const EFFECT_LABEL: Record<ProposalEffectClass, string> = {
  read: 'Read only', external_write: 'External write', code_mutation: 'Code mutation', runtime_execution: 'Runtime execution', destructive: 'Destructive',
}
const BLOCKER_LABEL: Record<ProposalBlockerCode, string> = {
  action_unavailable: 'Action unavailable', policy_denied: 'Policy denied', approval_required: 'Approval required', validation_failed: 'Validation failed', budget_exceeded: 'Budget exceeded',
}

function formatMicrounits(value: number, currency: string): string {
  return `${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${currency}`
}

function ProposalReview({ proposal, invalidated, loading, error }: {
  proposal?: OperationProposalPresentation
  invalidated: boolean
  loading: boolean
  error?: string
}) {
  return (
    <section className={`gi-card gi-proposal ${invalidated ? 'is-invalidated' : ''}`} aria-labelledby="gi-proposal-title">
      <header className="gi-card-head">
        <div><span className="gi-eyebrow">Governed dry run</span><h2 id="gi-proposal-title">Operation proposal</h2></div>
        <span className="gi-no-execution">Proposal only · no execution</span>
      </header>
      <div className="gi-safety-note"><strong>Review record only.</strong> This proposal is not authorization, approval, or execution, and this screen has no execute control.</div>
      {invalidated && <div className="gi-binding-warning" role="status"><strong>Binding invalidated by draft edits.</strong> Save the draft to request a newly bound dry-run proposal. The previous proposal is shown only for comparison.</div>}
      {loading && <p className="gi-empty" aria-live="polite">Loading the server-issued dry-run proposal…</p>}
      {error && <p className="gi-empty is-error" role="alert">{error}</p>}
      {!proposal && !loading && !error && <p className="gi-empty">No server-issued proposal is bound yet. A registered action must be supplied by the control plane before a dry run can be prepared.</p>}
      {proposal && <div className="gi-proposal-body" aria-disabled={invalidated || undefined}>
        <dl className="gi-proposal-facts">
          <div><dt>Registered action</dt><dd><code>{proposal.registeredActionId}</code> <span>v{proposal.registeredActionVersion}</span></dd></div>
          <div><dt>Actor</dt><dd>{proposal.actor}</dd></div>
          <div><dt>Delegation chain</dt><dd>{proposal.delegationChain.length ? proposal.delegationChain.join(' → ') : 'Direct actor · no delegation'}</dd></div>
          <div><dt>Input digest</dt><dd><code title={proposal.protectedInputDigest}>{shortDigest(proposal.protectedInputDigest)}</code></dd></div>
          <div><dt>Proposal record</dt><dd><code title={proposal.recordDigest}>{shortDigest(proposal.recordDigest)}</code></dd></div>
          <div><dt>Expires</dt><dd><time dateTime={proposal.expiresAt}>{new Date(proposal.expiresAt).toLocaleString()}</time></dd></div>
        </dl>

        <div className="gi-proposal-grid">
          <article><h3>Targets &amp; expected versions</h3><ul>{proposal.targets.map((target) => <li key={`${target.resource.issuer}:${target.resource.resourceId}`}><strong>{target.resource.resourceId}</strong><span>{target.resource.resourceType} · authority {target.resource.issuer}</span><span>Origin {target.resource.source.origin}</span><code>{target.expectedVersion}</code></li>)}</ul></article>
          <article><h3>Declared effects</h3><ul>{proposal.declaredEffects.map((effect, index) => <li key={`${effect.effectClass}-${index}`}><strong>{EFFECT_LABEL[effect.effectClass]}</strong><code>{JSON.stringify(effect.bounds)}</code></li>)}</ul></article>
          <article><h3>Policy snapshot</h3><dl><div><dt>Outcome</dt><dd>{proposal.policy.outcome}</dd></div><div><dt>Policy</dt><dd>{proposal.policy.id} · v{proposal.policy.version}</dd></div><div><dt>Hash</dt><dd><code>{proposal.policy.hash}</code></dd></div>{proposal.policy.reason && <div><dt>Reason</dt><dd>{proposal.policy.reason}</dd></div>}</dl></article>
          <article><h3>Required approvals</h3>{proposal.requiredApprovals.length ? <ul>{proposal.requiredApprovals.map((approval, index) => <li key={`${approval.kind}-${approval.role}-${index}`}><strong>{approval.count} × {approval.role}</strong><span>{approval.kind} approval requirement</span></li>)}</ul> : <p>No approval requirements declared.</p>}</article>
          <article><h3>Cost &amp; budget</h3><dl><div><dt>Estimate</dt><dd>{formatMicrounits(proposal.costEstimate.estimatedMicrounits, proposal.costEstimate.currency)}</dd></div><div><dt>Budget</dt><dd>{proposal.costEstimate.budgetMicrounits === null ? 'No declared budget' : formatMicrounits(proposal.costEstimate.budgetMicrounits, proposal.costEstimate.currency)}</dd></div></dl></article>
          <article><h3>Validation</h3>{proposal.validationResults.length ? <ul>{proposal.validationResults.map((result) => <li key={result.code}><span className={`gi-check ${result.passed ? 'is-pass' : 'is-fail'}`}>{result.passed ? 'Pass' : 'Fail'}</span><div><strong>{result.code}</strong>{result.message && <small>{result.message}</small>}</div></li>)}</ul> : <p>No validation results declared.</p>}</article>
        </div>

        <div className={`gi-blockers ${proposal.blockers.length ? 'has-blockers' : ''}`}>
          <h3>Typed blockers <span>{proposal.blockers.length}</span></h3>
          {proposal.blockers.length ? <ul>{proposal.blockers.map((blocker) => <li key={blocker.code}><strong>{BLOCKER_LABEL[blocker.code]}</strong><span>{blocker.message}</span><code>{blocker.code}</code></li>)}</ul> : <p>No blockers are declared for this dry-run proposal. Separate authorization would still be required before any future execution phase.</p>}
        </div>
      </div>}
    </section>
  )
}

export function GroundedInvestigationThread({ snapshot, proposal, proposalLoading = false, proposalError, onRetry, onCancel, onReconnect, onSavePlan }: {
  snapshot: InvestigationSnapshot
  proposal?: OperationProposalPresentation
  proposalLoading?: boolean
  proposalError?: string
  onRetry: () => Promise<void>
  onCancel: () => Promise<void>
  onReconnect: () => Promise<void>
  onSavePlan: (draft: Omit<HumanPlanDraft, 'schemaVersion' | 'authoredBy'>) => Promise<void>
}) {
  const projection = snapshot.projection
  const [fields, setFields] = useState<PlanFields>(() => planFields(projection))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  useEffect(() => setFields(planFields(projection)), [projection])
  const invalidated = isPlanBindingInvalidated(fields, projection)
  const failedWithoutProjection = !projection && snapshot.lifecycle.phase === 'failed'
  const context = useMemo(() => {
    if (!projection?.contextBrief) return undefined
    try { return presentContextBrief(projection.contextBrief, projection) } catch { return undefined }
  }, [projection])
  const canSave = Boolean(projection && proposal && fields.title.trim() && fields.objective.trim() && lines(fields.steps).length && invalidated && !saving)
  const save = () => {
    setSaving(true)
    setSaveError('')
    void onSavePlan({
      title: fields.title.trim(),
      objective: fields.objective.trim(),
      steps: lines(fields.steps),
      assumptions: lines(fields.assumptions),
    }).catch((error) => setSaveError(error instanceof Error ? error.message : 'Draft could not be saved')).finally(() => setSaving(false))
  }

  return (
    <article className="grounded-investigation" aria-labelledby="gi-title">
      <LifecycleNotice snapshot={snapshot} onRetry={onRetry} onCancel={onCancel} onReconnect={onReconnect} />
      {projection ? <>
        <header className="gi-hero">
          <div className="gi-hero-copy">
            <div className="gi-kicker"><span>Grounded investigation</span><span className={`gi-state is-${projection.status}`}>{projection.status.replace('_', ' ')}</span></div>
            <h1 id="gi-title">{projection.planDraft?.objective ?? projection.query ?? `Investigate ${resourceLabel(projection.issue)}`}</h1>
            <p>Authority-qualified sources and a human-reviewed plan for this outcome Thread.</p>
            <div className="gi-identity"><span>Investigation <code>{projection.investigationId}</code></span><span>Thread <code>{projection.outcomeThreadId}</code></span><span>Attempt {projection.attempt}</span></div>
          </div>
          <div className="gi-resources"><ResourceReference resource={projection.issue} label="Issue source" /><ResourceReference resource={projection.repository} label="Repository source" /></div>
        </header>

        {context ? <ContextBrief brief={context} /> : <section className="gi-card gi-empty"><h2>Context Brief unavailable</h2><p>The projection did not include a presentable, authorized KRAIL Context Brief. Restricted provider details are not shown.</p></section>}

        <section className="gi-card gi-plan" aria-labelledby="gi-plan-title">
          <header className="gi-card-head">
            <div><span className="gi-eyebrow">Human draft</span><h2 id="gi-plan-title">Investigation plan</h2></div>
            <span className="gi-draft-badge">Editable · not authoritative</span>
          </header>
          <p className="gi-helper">This is a human-authored review draft. Editing it does not authorize an operation. Saving requests a new immutable dry-run proposal only.</p>
          <div className="gi-plan-fields">
            <label>Plan title<input value={fields.title} maxLength={300} onChange={(event) => setFields((current) => ({ ...current, title: event.target.value }))} /></label>
            <label>Objective<textarea value={fields.objective} rows={3} maxLength={4000} onChange={(event) => setFields((current) => ({ ...current, objective: event.target.value }))} /></label>
            <label>Steps <small>One reviewable step per line</small><textarea value={fields.steps} rows={5} onChange={(event) => setFields((current) => ({ ...current, steps: event.target.value }))} /></label>
            <label>Assumptions <small>One explicit assumption per line</small><textarea value={fields.assumptions} rows={3} onChange={(event) => setFields((current) => ({ ...current, assumptions: event.target.value }))} /></label>
          </div>
          <footer className="gi-plan-actions">
            <div><strong>{invalidated ? 'Draft changed · proposal binding invalidated' : `Saved draft v${projection.planVersion}`}</strong><span>{projection.planDigest ? `Plan digest ${shortDigest(projection.planDigest)}` : 'No immutable proposal is bound yet.'}</span>{saveError && <span className="is-error" role="alert">{saveError}</span>}</div>
            <button type="button" disabled={!canSave} onClick={save}>{saving ? 'Preparing…' : 'Save draft & prepare dry run'}</button>
          </footer>
        </section>

        <ProposalReview proposal={proposal} invalidated={invalidated} loading={proposalLoading} error={proposalError} />
      </> : <section className="gi-card gi-empty">
        <h1 id="gi-title">{failedWithoutProjection ? 'Grounded investigation unavailable' : 'Loading grounded investigation'}</h1>
        <p>{failedWithoutProjection
          ? 'No authority-shaped projection is available. Nothing from another investigation, Thread, or project is shown.'
          : 'Waiting for the authority-shaped OpenSaddle projection.'}</p>
      </section>}
    </article>
  )
}
