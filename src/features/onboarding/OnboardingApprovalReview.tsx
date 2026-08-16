import React from 'react'
import { Icon } from '../../components/common/Icon'
import type { ProjectOnboardingChange } from '../../services/contracts'
import { Button } from '../../ui/Button'

// Node-rendered contract tests use the classic JSX transform.
void React

function shortDigest(value: string) {
  return `${value.slice(0, 18)}…${value.slice(-10)}`
}

export function OnboardingApprovalReview({
  change,
  busy,
  rejectReason,
  onRejectReasonChange,
  onApprove,
  onReject,
}: {
  change: ProjectOnboardingChange
  busy: string | null
  rejectReason: string
  onRejectReasonChange: (value: string) => void
  onApprove: () => void
  onReject: () => void
}) {
  const actionable = (change.status === 'approval_required' || change.status === 'verification_failed')
    && Boolean(change.patch?.trim())
    && Boolean(change.diffDigest)
  return <>
    {change.patch && change.diffDigest && <div className="onboarding-diff">
      <div className="onboarding-diff-head"><div><span>Exact approval boundary</span><strong>{change.changedFiles.length} changed file{change.changedFiles.length === 1 ? '' : 's'}</strong></div><code title={change.diffDigest}>{shortDigest(change.diffDigest)}</code></div>
      <div className="onboarding-files">{change.changedFiles.map((path) => <span key={path}><Icon name="file" />{path}</span>)}</div>
      <pre aria-label="Exact onboarding diff">{change.patch}</pre>
    </div>}
    {change.verification.length > 0 && <div className="onboarding-verification"><h3>Verification that will run after approval</h3>{change.verification.map((check) => <div key={check.name}><Icon name="terminal" /><span><strong>{check.name}</strong><code>{check.command}</code><small>Evidence: {check.evidence.join(', ')}</small></span></div>)}</div>}
    {change.checks.length > 0 && <div className="onboarding-checks"><h3>Verification receipt</h3>{change.checks.map((check) => <div key={check.name} className={check.passed ? 'passed' : 'failed'}><Icon name={check.passed ? 'check' : 'x'} /><span><strong>{check.name}</strong><small>{check.passed ? 'Passed' : `Failed${check.exitCode === undefined ? '' : ` · exit ${check.exitCode}`}`}</small></span></div>)}</div>}
    {actionable && <div className="onboarding-approval">
      <div><Icon name="shield" /><span><strong>{change.status === 'verification_failed' ? 'Fix the project or verification command, then retry' : 'Approve this exact digest'}</strong><small>Approval runs the displayed commands, re-hashes the diff, and creates a commit only if every check passes without changing it.</small></span></div>
      <label>Optional rejection reason<textarea value={rejectReason} disabled={Boolean(busy)} onChange={(event) => onRejectReasonChange(event.target.value)} placeholder="Explain what should change before another run" rows={2} /></label>
      <div className="onboarding-actions"><Button variant="danger" disabled={Boolean(busy)} loading={busy === 'reject'} onClick={onReject}>Reject & clean worktree</Button><Button disabled={Boolean(busy)} loading={busy === 'approve'} onClick={onApprove}>{change.status === 'verification_failed' ? 'Retry verification' : 'Approve exact diff & verify'}</Button></div>
    </div>}
  </>
}
