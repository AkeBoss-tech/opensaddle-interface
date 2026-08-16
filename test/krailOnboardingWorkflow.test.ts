import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KRAIL_ONBOARDING_STAGES,
  canAdvanceKrailOnboarding,
  krailOnboardingTask,
} from '../src/features/onboarding/krailOnboardingWorkflow.ts'

test('desktop onboarding presents the governed vertical slice in order', () => {
  assert.deepEqual(KRAIL_ONBOARDING_STAGES, [
    'project_attached', 'profile_proposed', 'recommendation_selected', 'worktree_run',
    'approval_required', 'verifying', 'commit_ready', 'committed',
  ])
})

test('review, exact diff approval, and unchanged verified diff are hard gates', () => {
  assert.equal(canAdvanceKrailOnboarding({ stage: 'profile_proposed' }), false)
  assert.equal(canAdvanceKrailOnboarding({ stage: 'profile_proposed', proposalReviewed: true }), true)
  assert.equal(canAdvanceKrailOnboarding({ stage: 'approval_required', exactDiffApproved: false }), false)
  assert.equal(canAdvanceKrailOnboarding({ stage: 'approval_required', exactDiffApproved: true }), true)
  assert.equal(canAdvanceKrailOnboarding({ stage: 'verifying', verificationPassed: true }), false)
  assert.equal(canAdvanceKrailOnboarding({ stage: 'verifying', verificationPassed: true, diffUnchanged: true }), true)
})

test('proposal run instruction cannot silently promote or commit', () => {
  const task = krailOnboardingTask('claude_code')
  assert.match(task, /detached Git worktree/i)
  assert.match(task, /does not provide OS, process, network, or credential isolation/i)
  assert.match(task, /Do not promote knowledge, execute a recommended automation, push, or commit/)
})
