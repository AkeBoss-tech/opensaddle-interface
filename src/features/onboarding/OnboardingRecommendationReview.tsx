import React from 'react'
import { Icon } from '../../components/common/Icon'
import type { ProjectOnboardingRecommendationOption } from '../../services/contracts'

// Node-rendered contract tests use the classic JSX transform.
void React

export function OnboardingRecommendationReview({
  option,
  runnerLabel,
}: {
  option: ProjectOnboardingRecommendationOption
  runnerLabel: string
}) {
  return <section className="onboarding-preflight" aria-label="Exact runner request">
    <div className="onboarding-preflight-head">
      <Icon name="shield" />
      <span>
        <strong>Review the agent instruction and post-approval verification</strong>
        <small>{runnerLabel} receives the instruction below and keeps your local OS, process, network, and credential authority. OpenSaddle runs the listed verification only after exact-diff approval; it bounds and reviews the resulting detached-worktree diff, not other host side effects.</small>
      </span>
    </div>
    <div className="onboarding-preflight-section">
      <h3>Agent instruction</h3>
      <pre>{option.instruction}</pre>
    </div>
    <div className="onboarding-preflight-section">
      <h3>Commands run by OpenSaddle after exact-diff approval</h3>
      {option.verification.map((verification) => <div className="onboarding-preflight-command" key={verification.name}>
        <strong>{verification.name}</strong>
        <code>{verification.command}</code>
        <small>Evidence: {verification.evidence.join(', ')}</small>
      </div>)}
    </div>
  </section>
}
