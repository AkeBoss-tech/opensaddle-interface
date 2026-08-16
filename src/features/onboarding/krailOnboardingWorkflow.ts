export type KrailOnboardingRunner = 'codex_cli' | 'claude_code'

export type KrailOnboardingStage =
  | 'project_attached'
  | 'profile_proposed'
  | 'recommendation_selected'
  | 'worktree_run'
  | 'approval_required'
  | 'verifying'
  | 'commit_ready'
  | 'committed'

export const KRAIL_ONBOARDING_STAGES: readonly KrailOnboardingStage[] = Object.freeze([
  'project_attached',
  'profile_proposed',
  'recommendation_selected',
  'worktree_run',
  'approval_required',
  'verifying',
  'commit_ready',
  'committed',
])

export function canAdvanceKrailOnboarding(input: {
  stage: KrailOnboardingStage
  proposalReviewed?: boolean
  exactDiffApproved?: boolean
  verificationPassed?: boolean
  diffUnchanged?: boolean
}): boolean {
  if (input.stage === 'profile_proposed') return input.proposalReviewed === true
  if (input.stage === 'approval_required') return input.exactDiffApproved === true
  if (input.stage === 'verifying') return input.verificationPassed === true && input.diffUnchanged === true
  if (input.stage === 'committed') return false
  return true
}

export function krailOnboardingTask(runner: KrailOnboardingRunner): string {
  return [
    'Prepare KRAIL project onboarding proposals for this registered project.',
    'Run in the detached Git worktree created by OpenSaddle. This does not provide OS, process, network, or credential isolation.',
    `Use the ${runner} work order emitted by KRAIL.`,
    'Write only the bounded project-profile and automation-recommendation proposal files.',
    'Do not promote knowledge, execute a recommended automation, push, or commit.',
    'Return the exact diff for human review.',
  ].join(' ')
}
