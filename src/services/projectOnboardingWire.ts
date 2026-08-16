import type {
  ProjectOnboardingAutomationRecommendations,
  ProjectOnboardingChange,
  ProjectOnboardingDiff,
  ProjectOnboardingDiscovery,
  ProjectOnboardingEvidence,
  ProjectOnboardingProfile,
  ProjectOnboardingReadiness,
  ProjectOnboardingReadinessCheck,
  ProjectOnboardingRecommendationOption,
  ProjectOnboardingState,
  ProjectOnboardingVerification,
} from './contracts'

const DIGEST = /^sha256:[0-9a-f]{64}$/
const GIT_SHA = /^[0-9a-f]{40,64}$/
const READINESS_CHECKS: ProjectOnboardingReadinessCheck[] = [
  'registered_project',
  'root_exists',
  'git_repository',
  'git_head',
  'git_clean',
  'runner_executable',
  'runner_authenticated',
  'runner_compatible',
  'krail_discovery',
  'state_root_external',
  'source_has_no_opensaddle_state',
  'state_root_writable',
]

function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
    camelize(item),
  ]))
}

function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`OpenSaddle returned an invalid ${label}.`)
  }
  return camelize(value) as Record<string, any>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`OpenSaddle returned an invalid onboarding ${label}.`)
  }
  return value
}

function digest(value: unknown, label: string): string {
  const result = string(value, label)
  if (!DIGEST.test(result)) throw new Error(`OpenSaddle returned a non-canonical onboarding ${label}.`)
  return result
}

function barrierList(value: unknown, label: string): ProjectOnboardingReadinessCheck[] {
  if (
    !Array.isArray(value)
    || value.some((name) => typeof name !== 'string' || !READINESS_CHECKS.includes(name as ProjectOnboardingReadinessCheck))
  ) {
    throw new Error(`OpenSaddle returned invalid onboarding ${label}.`)
  }
  const barriers = value as ProjectOnboardingReadinessCheck[]
  if (new Set(barriers).size !== barriers.length) {
    throw new Error(`OpenSaddle returned duplicate onboarding ${label}.`)
  }
  return [...barriers]
}

function nonEmptyStringList(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value)
    || value.some((item) => typeof item !== 'string' || !item.trim())
    || new Set(value).size !== value.length
  ) {
    throw new Error(`OpenSaddle returned invalid onboarding ${label}.`)
  }
  return [...value]
}

function projectRelativePath(value: unknown, label: string): string {
  const path = string(value, label)
  const parts = path.split('/')
  if (
    path.startsWith('/')
    || path.includes('\\')
    || parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`OpenSaddle returned a non-normalized onboarding ${label}.`)
  }
  return path
}

function evidence(value: unknown): ProjectOnboardingEvidence {
  const item = object(value, 'evidence locator')
  const span = item.span === undefined ? undefined : object(item.span, 'evidence span')
  const startLine = span ? Number(span.startLine) : undefined
  const endLine = span ? Number(span.endLine) : undefined
  if (
    span
    && (
      !Number.isSafeInteger(startLine)
      || !Number.isSafeInteger(endLine)
      || startLine! < 1
      || endLine! < startLine!
    )
  ) {
    throw new Error('OpenSaddle returned an invalid onboarding evidence span.')
  }
  if (item.revision !== undefined && item.revision !== null && (typeof item.revision !== 'string' || !item.revision.trim())) {
    throw new Error('OpenSaddle returned an invalid onboarding evidence revision.')
  }
  return {
    path: projectRelativePath(item.path, 'evidence path'),
    revision: item.revision === null || typeof item.revision === 'string' ? item.revision : undefined,
    span: span ? { startLine: startLine!, endLine: endLine! } : undefined,
    digest: typeof item.digest === 'string' ? digest(item.digest, 'evidence digest') : undefined,
  }
}

function verification(value: unknown): ProjectOnboardingVerification {
  const item = object(value, 'verification command')
  if (!Array.isArray(item.evidence) || item.evidence.some((locator: unknown) => typeof locator !== 'string')) {
    throw new Error('OpenSaddle returned invalid onboarding verification evidence.')
  }
  const timeoutSeconds = item.timeoutSeconds === undefined ? undefined : Number(item.timeoutSeconds)
  if (timeoutSeconds !== undefined && (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)) {
    throw new Error('OpenSaddle returned an invalid onboarding verification timeout.')
  }
  return {
    name: string(item.name, 'verification name'),
    command: string(item.command, 'verification command'),
    evidence: [...item.evidence],
    timeoutSeconds,
  }
}

function option(value: unknown): ProjectOnboardingRecommendationOption {
  const item = object(value, 'automation recommendation')
  if (item.contract !== undefined) throw new Error('OpenSaddle returned an untrusted recommendation option contract.')
  if (item.kind !== 'proposal_generation' && item.kind !== 'project_action') {
    throw new Error('OpenSaddle returned an unsupported onboarding recommendation kind.')
  }
  if (!Array.isArray(item.allowedPaths) || item.allowedPaths.length === 0) {
    throw new Error('OpenSaddle returned an onboarding recommendation without a bounded path scope.')
  }
  const allowedPaths = item.allowedPaths.map((value: unknown) => {
    const path = projectRelativePath(value, 'allowed path scope')
    const parts = path.split('/')
    const firstSegment = parts[0]
    if (
      firstSegment.includes('*')
      || firstSegment.includes('?')
      || firstSegment.includes('[')
      || firstSegment === '.git'
      || firstSegment === '.opensaddle'
    ) {
      throw new Error('OpenSaddle returned an onboarding path scope without a safe literal project root.')
    }
    return path
  })
  if (new Set(allowedPaths).size !== allowedPaths.length) {
    throw new Error('OpenSaddle returned duplicate onboarding path scopes.')
  }
  if (!Array.isArray(item.verification) || item.verification.length === 0) {
    throw new Error('OpenSaddle returned an onboarding recommendation without verification.')
  }
  return {
    recommendationId: string(item.recommendationId, 'recommendation id'),
    kind: item.kind,
    title: string(item.title, 'recommendation title'),
    summary: string(item.summary, 'recommendation summary'),
    instruction: string(item.instruction, 'recommendation instruction'),
    allowedPaths,
    verification: item.verification.map(verification),
    commitMessage: string(item.commitMessage, 'commit message'),
  }
}

function reviewedProposal(value: unknown, contract: 'krail.project-profile/v1'): ProjectOnboardingProfile
function reviewedProposal(value: unknown, contract: 'krail.automation-recommendations/v1'): ProjectOnboardingAutomationRecommendations
function reviewedProposal(
  value: unknown,
  contract: 'krail.project-profile/v1' | 'krail.automation-recommendations/v1',
): ProjectOnboardingProfile | ProjectOnboardingAutomationRecommendations {
  const item = object(value, 'reviewed onboarding proposal')
  if (item.contract !== contract || !Array.isArray(item.claims)) {
    throw new Error(`OpenSaddle returned an unsupported ${contract} contract.`)
  }
  const review = object(item.review, 'reviewed onboarding proposal state')
  if (!['proposed', 'accepted', 'rejected'].includes(String(review.status))) {
    throw new Error('OpenSaddle returned an invalid reviewed onboarding proposal state.')
  }
  return {
    contract: item.contract,
    summary: typeof item.summary === 'string' ? item.summary : undefined,
    claims: item.claims.map((value: unknown) => {
      const claim = object(value, 'reviewed onboarding claim')
      if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
        throw new Error('OpenSaddle returned an onboarding claim without evidence.')
      }
      return { text: string(claim.text, 'claim text'), evidence: claim.evidence.map(evidence) }
    }),
    review: {
      status: review.status,
      reviewedBy: typeof review.reviewedBy === 'string' ? review.reviewedBy : undefined,
    },
  }
}

function discovery(value: unknown): ProjectOnboardingDiscovery {
  const item = object(value, 'project discovery')
  if (item.contract !== 'krail.project-discovery/v1' || !DIGEST.test(String(item.fingerprint))) {
    throw new Error('OpenSaddle returned an unsupported project discovery contract.')
  }
  if (item.mode !== 'onboard' && item.mode !== 'refresh') {
    throw new Error('OpenSaddle returned an unsupported project discovery mode.')
  }
  if (!Array.isArray(item.languages) || item.languages.some((language: unknown) => typeof language !== 'string')) {
    throw new Error('OpenSaddle returned invalid project discovery languages.')
  }
  const repository = item.repository === undefined ? undefined : object(item.repository, 'repository discovery')
  if (repository && repository.kind !== 'git' && repository.kind !== 'directory') {
    throw new Error('OpenSaddle returned an unsupported repository discovery kind.')
  }
  const commands = Array.isArray(item.commands) ? item.commands : []
  const fileCount = Number(item.fileCount)
  if (!Number.isSafeInteger(fileCount) || fileCount < 0) {
    throw new Error('OpenSaddle returned an invalid project discovery file count.')
  }
  return {
    contract: item.contract,
    root: string(item.root, 'project root'),
    mode: item.mode,
    fingerprint: item.fingerprint,
    languages: [...item.languages],
    fileCount,
    repository: repository ? {
      kind: repository.kind,
      revision: repository.revision === null || typeof repository.revision === 'string' ? repository.revision : undefined,
      dirty: typeof repository.dirty === 'boolean' ? repository.dirty : undefined,
    } : undefined,
    commands: commands.map((value: unknown) => {
      const command = object(value, 'discovered command')
      return {
        command: string(command.command, 'discovered command'),
        kind: string(command.kind, 'discovered command kind'),
        evidence: Array.isArray(command.evidence) ? command.evidence.map(evidence) : [],
      }
    }),
  }
}

export function projectOnboardingStateFromWire(value: unknown, expectedProjectId: string): ProjectOnboardingState {
  const state = object(value, 'project onboarding state')
  if (state.contract !== 'opensaddle.project-onboarding/v1' || state.projectId !== expectedProjectId) {
    throw new Error('OpenSaddle returned onboarding state for an unsupported contract or project.')
  }
  const statuses: ProjectOnboardingState['status'][] = [
    'not_prepared', 'ready', 'running', 'approval_required', 'committed', 'applied', 'failed', 'interrupted',
  ]
  if (!statuses.includes(state.status)) throw new Error('OpenSaddle returned an invalid onboarding state.')
  const fingerprint = state.fingerprint === null || state.fingerprint === undefined
    ? state.fingerprint
    : digest(state.fingerprint, 'state fingerprint')
  if (state.runner !== null && state.runner !== undefined && state.runner !== 'codex_cli' && state.runner !== 'claude_code') {
    throw new Error('OpenSaddle returned an unsupported onboarding runner.')
  }
  if (!Array.isArray(state.recommendationOptions)) {
    throw new Error('OpenSaddle returned invalid onboarding recommendation options.')
  }
  if (typeof state.refreshRequired !== 'boolean') {
    throw new Error('OpenSaddle returned onboarding state without refresh binding.')
  }
  if (typeof state.executionReady !== 'boolean') {
    throw new Error('OpenSaddle returned onboarding state without execution readiness.')
  }
  const executionBarriers = barrierList(state.executionBarriers, 'state execution barriers')
  const executionHead = state.executionHead === null || state.executionHead === undefined
    ? state.executionHead
    : string(state.executionHead, 'execution head')
  if (executionHead && !GIT_SHA.test(executionHead)) {
    throw new Error('OpenSaddle returned an invalid onboarding execution head.')
  }
  return {
    contract: state.contract,
    projectId: state.projectId,
    status: state.status,
    runner: state.runner,
    fingerprint,
    discovery: state.discovery ? discovery(state.discovery) : state.discovery,
    profile: state.profile ? reviewedProposal(state.profile, 'krail.project-profile/v1') : state.profile,
    automationRecommendations: state.automationRecommendations
      ? reviewedProposal(state.automationRecommendations, 'krail.automation-recommendations/v1')
      : state.automationRecommendations,
    recommendationOptions: state.recommendationOptions.map(option),
    activeRunId: state.activeRunId === null || typeof state.activeRunId === 'string' ? state.activeRunId : undefined,
    executionHead,
    executionReady: state.executionReady,
    executionBarriers,
    refreshRequired: state.refreshRequired,
    error: state.error === null || typeof state.error === 'string' ? state.error : undefined,
  }
}

export function projectOnboardingReadinessFromWire(
  value: unknown,
  expectedProjectId: string,
  expectedRunner: ProjectOnboardingReadiness['runner'],
): ProjectOnboardingReadiness {
  const readiness = object(value, 'onboarding readiness')
  if (
    readiness.contract !== 'opensaddle.onboarding-readiness/v1'
    || readiness.projectId !== expectedProjectId
    || readiness.runner !== expectedRunner
  ) {
    throw new Error('OpenSaddle returned readiness for an unsupported contract, project, or runner.')
  }
  const rawChecks = object(readiness.checks, 'onboarding readiness checks')
  const checks = Object.fromEntries(READINESS_CHECKS.map((name) => {
    const wireName = name.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
    if (typeof rawChecks[wireName] !== 'boolean') {
      throw new Error(`OpenSaddle returned an invalid onboarding readiness check: ${name}.`)
    }
    return [name, rawChecks[wireName]]
  })) as Record<ProjectOnboardingReadinessCheck, boolean>
  const discoveryBarriers = barrierList(readiness.discoveryBarriers, 'discovery barriers')
  const executionBarriers = barrierList(readiness.executionBarriers, 'execution barriers')
  const informationalChecks = barrierList(readiness.informationalChecks, 'informational checks')
  if (!Array.isArray(readiness.warnings) || readiness.warnings.some((warning: unknown) => typeof warning !== 'string' || !warning.trim())) {
    throw new Error('OpenSaddle returned invalid onboarding warnings.')
  }
  const discoveryBarrierSet = new Set(discoveryBarriers)
  const executionBarrierSet = new Set(executionBarriers)
  const informationalSet = new Set(informationalChecks)
  if (
    typeof readiness.discoveryReady !== 'boolean'
    || typeof readiness.executionReady !== 'boolean'
    || typeof readiness.ready !== 'boolean'
    || readiness.ready !== readiness.executionReady
    || readiness.discoveryReady !== (discoveryBarriers.length === 0)
    || readiness.executionReady !== (executionBarriers.length === 0)
    || discoveryBarriers.some((name) => checks[name])
    || executionBarriers.some((name) => checks[name])
    || discoveryBarriers.some((name) => !executionBarrierSet.has(name))
    || informationalChecks.some((name) => discoveryBarrierSet.has(name) || executionBarrierSet.has(name))
    || READINESS_CHECKS.some((name) => !checks[name] && !executionBarrierSet.has(name) && !informationalSet.has(name))
  ) {
    throw new Error('OpenSaddle returned inconsistent onboarding readiness barriers.')
  }
  const harness = object(readiness.harness, 'onboarding harness readiness')
  const runnerCompatibility = object(readiness.runnerCompatibility, 'runner compatibility')
  const state = object(readiness.state, 'onboarding state storage')
  if (typeof harness.installed !== 'boolean') {
    throw new Error('OpenSaddle returned invalid onboarding harness installation state.')
  }
  const compatibilityStatuses = ['compatible', 'incompatible', 'unknown', 'unavailable'] as const
  const probeStatuses = ['ok', 'failed', 'timeout', 'not_run'] as const
  if (!compatibilityStatuses.includes(runnerCompatibility.status)) {
    throw new Error('OpenSaddle returned an invalid onboarding runner compatibility status.')
  }
  if (!probeStatuses.includes(runnerCompatibility.probeStatus)) {
    throw new Error('OpenSaddle returned an invalid onboarding runner compatibility probe status.')
  }
  const compatibilityCommand = nonEmptyStringList(runnerCompatibility.command, 'runner compatibility command')
  const requiredOptions = nonEmptyStringList(runnerCompatibility.requiredOptions, 'runner compatibility requirements')
  const missingOptions = nonEmptyStringList(runnerCompatibility.missingOptions, 'runner compatibility missing options')
  if (
    compatibilityCommand.length === 0
    || requiredOptions.length === 0
    || missingOptions.some((option) => !requiredOptions.includes(option))
    || (runnerCompatibility.status === 'compatible') !== checks.runner_compatible
    || (runnerCompatibility.status === 'compatible' && (missingOptions.length > 0 || runnerCompatibility.probeStatus !== 'ok'))
    || (runnerCompatibility.status === 'incompatible' && (missingOptions.length === 0 || runnerCompatibility.probeStatus !== 'ok'))
    || (runnerCompatibility.status !== 'compatible' && (typeof runnerCompatibility.reason !== 'string' || !runnerCompatibility.reason.trim()))
    || (runnerCompatibility.reason !== null && runnerCompatibility.reason !== undefined && typeof runnerCompatibility.reason !== 'string')
    || (runnerCompatibility.upgradeGuidance !== null && runnerCompatibility.upgradeGuidance !== undefined && (typeof runnerCompatibility.upgradeGuidance !== 'string' || !runnerCompatibility.upgradeGuidance.trim()))
  ) {
    throw new Error('OpenSaddle returned inconsistent onboarding runner compatibility evidence.')
  }
  const head = readiness.head === null || readiness.head === undefined
    ? readiness.head
    : string(readiness.head, 'readiness head')
  if (head && !GIT_SHA.test(head)) throw new Error('OpenSaddle returned an invalid readiness Git head.')
  if (readiness.isolation !== 'detached_git_worktree_only') {
    throw new Error('OpenSaddle returned an unsupported onboarding isolation mode.')
  }
  return {
    contract: readiness.contract,
    projectId: readiness.projectId,
    runner: readiness.runner,
    ready: readiness.ready,
    discoveryReady: readiness.discoveryReady,
    executionReady: readiness.executionReady,
    discoveryBarriers,
    executionBarriers,
    informationalChecks,
    checks,
    root: string(readiness.root, 'readiness root'),
    head,
    runnerPath: readiness.runnerPath === null || readiness.runnerPath === undefined
      ? readiness.runnerPath
      : string(readiness.runnerPath, 'runner path'),
    harness: {
      id: string(harness.id, 'harness id'),
      installed: harness.installed,
      readiness: harness.readiness === null || typeof harness.readiness === 'string' ? harness.readiness : undefined,
      loginGuidance: harness.loginGuidance === null || typeof harness.loginGuidance === 'string' ? harness.loginGuidance : undefined,
    },
    runnerCompatibility: {
      status: runnerCompatibility.status,
      command: compatibilityCommand,
      requiredOptions,
      missingOptions,
      probeStatus: runnerCompatibility.probeStatus,
      reason: runnerCompatibility.reason === null || typeof runnerCompatibility.reason === 'string' ? runnerCompatibility.reason : undefined,
      upgradeGuidance: runnerCompatibility.upgradeGuidance === null || typeof runnerCompatibility.upgradeGuidance === 'string' ? runnerCompatibility.upgradeGuidance : undefined,
    },
    state: {
      database: string(state.database, 'state database'),
      worktrees: string(state.worktrees, 'state worktrees'),
      receipts: string(state.receipts, 'state receipts'),
      episodes: string(state.episodes, 'state episodes'),
    },
    error: readiness.error === null || typeof readiness.error === 'string' ? readiness.error : undefined,
    isolation: readiness.isolation,
    warning: string(readiness.warning, 'host-authority warning'),
    warnings: [...readiness.warnings],
  }
}

export function projectOnboardingChangeFromWire(value: unknown, expectedProjectId: string): ProjectOnboardingChange {
  const change = object(value, 'onboarding change')
  if (change.contract !== 'opensaddle.onboarding-change-proposal/v1' && change.contract !== 'opensaddle.onboarding-change-receipt/v1') {
    throw new Error('OpenSaddle returned an unsupported onboarding change contract.')
  }
  if (change.projectId !== undefined && change.projectId !== expectedProjectId) {
    throw new Error('OpenSaddle returned an onboarding change for a different project.')
  }
  const statuses: ProjectOnboardingChange['status'][] = [
    'running', 'approval_required', 'committed', 'verification_failed', 'rejected', 'applied', 'failed', 'interrupted',
  ]
  if (!statuses.includes(change.status)) throw new Error('OpenSaddle returned an invalid onboarding change state.')
  const fingerprint = change.fingerprint === undefined ? undefined : digest(change.fingerprint, 'change fingerprint')
  const diffDigest = change.diffDigest === null || change.diffDigest === undefined
    ? change.diffDigest
    : digest(change.diffDigest, 'diff digest')
  if (
    (change.status === 'approval_required' || change.status === 'verification_failed')
    && (!diffDigest || typeof change.patch !== 'string' || !change.patch.trim())
  ) {
    throw new Error('OpenSaddle did not return the exact diff required for onboarding approval.')
  }
  const changedFiles = Array.isArray(change.changedFiles) ? change.changedFiles : []
  if (changedFiles.some((path: unknown) => typeof path !== 'string')) {
    throw new Error('OpenSaddle returned invalid onboarding changed files.')
  }
  const recommendationOptions = Array.isArray(change.recommendationOptions)
    ? change.recommendationOptions.map(option)
    : []
  const commit = change.commit === null || change.commit === undefined
    ? change.commit
    : string(change.commit, 'commit')
  const baseCommit = change.baseCommit === null || change.baseCommit === undefined
    ? change.baseCommit
    : string(change.baseCommit, 'base commit')
  if (commit && !GIT_SHA.test(commit)) throw new Error('OpenSaddle returned an invalid onboarding commit.')
  if (baseCommit && !GIT_SHA.test(baseCommit)) throw new Error('OpenSaddle returned an invalid onboarding base commit.')
  if (
    change.recommendationKind !== undefined
    && change.recommendationKind !== 'proposal_generation'
    && change.recommendationKind !== 'project_action'
  ) {
    throw new Error('OpenSaddle returned an invalid onboarding recommendation kind.')
  }
  const author = change.author === null || change.author === undefined
    ? change.author
    : object(change.author, 'onboarding commit author')
  return {
    contract: change.contract,
    projectId: change.projectId,
    runId: string(change.runId, 'run id'),
    recommendationId: typeof change.recommendationId === 'string' ? change.recommendationId : undefined,
    fingerprint,
    status: change.status,
    diffDigest,
    changedFiles,
    patch: change.patch === null || typeof change.patch === 'string' ? change.patch : undefined,
    verification: Array.isArray(change.verification) ? change.verification.map(verification) : [],
    activity: Array.isArray(change.activity) ? change.activity.map((value: unknown) => {
      const event = object(value, 'onboarding activity')
      const kind = typeof event.type === 'string'
        ? event.type
        : typeof event.kind === 'string'
          ? event.kind
          : null
      if (!kind) throw new Error('OpenSaddle returned onboarding activity without an event type.')
      return {
        kind,
        label: typeof event.label === 'string'
          ? event.label
          : kind.replaceAll('.', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase()),
        detail: typeof event.detail === 'string' ? event.detail : undefined,
        timestamp: typeof event.at === 'string'
          ? event.at
          : typeof event.timestamp === 'string'
            ? event.timestamp
            : undefined,
      }
    }) : [],
    checks: Array.isArray(change.checks) ? change.checks.map((value: unknown) => {
      const check = object(value, 'verification receipt')
      return {
        name: string(check.name, 'check name'),
        passed: check.passed === true,
        exitCode: check.exitCode === null || check.exitCode === undefined ? check.exitCode : Number(check.exitCode),
      }
    }) : [],
    profile: change.profile ? reviewedProposal(change.profile, 'krail.project-profile/v1') : change.profile,
    automationRecommendations: change.automationRecommendations
      ? reviewedProposal(change.automationRecommendations, 'krail.automation-recommendations/v1')
      : change.automationRecommendations,
    recommendationOptions,
    commit,
    ref: change.ref === null || typeof change.ref === 'string' ? change.ref : undefined,
    baseCommit,
    author: author ? {
      name: string(author.name, 'commit author name'),
      email: string(author.email, 'commit author email'),
    } : author,
    recommendationKind: change.recommendationKind,
    summary: change.summary === null || typeof change.summary === 'string' ? change.summary : undefined,
    error: change.error === null || typeof change.error === 'string' ? change.error : undefined,
    recoverable: typeof change.recoverable === 'boolean' ? change.recoverable : undefined,
  }
}

export function projectOnboardingDiffFromWire(value: unknown, expectedRunId: string): ProjectOnboardingDiff {
  const raw = object(value, 'onboarding diff')
  if (raw.contract !== 'opensaddle.onboarding-diff/v1' || raw.runId !== expectedRunId) {
    throw new Error('OpenSaddle returned an unsupported onboarding diff contract.')
  }
  if (!Array.isArray(raw.changedFiles) || raw.changedFiles.some((path: unknown) => typeof path !== 'string')) {
    throw new Error('OpenSaddle returned invalid onboarding changed files.')
  }
  return {
    contract: raw.contract,
    runId: raw.runId,
    diffDigest: digest(raw.diffDigest, 'diff digest'),
    changedFiles: [...raw.changedFiles],
    patch: string(raw.patch, 'patch'),
  }
}
