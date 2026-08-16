import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OnboardingApprovalReview } from '../src/features/onboarding/OnboardingApprovalReview.tsx'
import { OnboardingRecommendationReview } from '../src/features/onboarding/OnboardingRecommendationReview.tsx'
import { onboardingApplyInput } from '../src/features/onboarding/onboardingApply.ts'
import { onboardingRefreshBarrier } from '../src/features/onboarding/onboardingRefresh.ts'
import { registerLocalWorkspace } from '../src/features/onboarding/registerLocalWorkspace.ts'
import { supportsGovernedProjectOnboarding } from '../src/features/onboarding/onboardingAvailability.ts'
import { AuthoritativeLocalProjectClient } from '../src/services/authoritativeLocalProjects.ts'
import type { ProjectOnboardingChange, ProjectOnboardingState } from '../src/services/contracts.ts'
import {
  projectOnboardingChangeFromWire,
  projectOnboardingDiffFromWire,
  projectOnboardingReadinessFromWire,
  projectOnboardingStateFromWire,
} from '../src/services/projectOnboardingWire.ts'

const DIGEST = `sha256:${'a'.repeat(64)}`
const DIFF_DIGEST = `sha256:${'b'.repeat(64)}`
const HEAD = 'c'.repeat(40)
const COMMIT = 'd'.repeat(40)

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

function option(id = 'project-orient') {
  return {
    recommendation_id: id,
    kind: id === 'project-orient' ? 'proposal_generation' : 'project_action',
    title: id === 'project-orient' ? 'Orient this project' : 'Add change verification',
    summary: 'Generate bounded, evidence-backed proposals in a detached worktree.',
    instruction: 'Inspect the discovery record and write only the requested proposal files.',
    allowed_paths: id === 'project-orient'
      ? ['research_plan/state/project_profile.proposal.json', 'research_plan/state/automation_recommendations.proposal.json']
      : ['research_plan/workflows/verify_change.yaml'],
    verification: [{
      name: 'proposal-contracts',
      command: 'python -m pytest -q',
      evidence: ['pyproject.toml:tool.pytest'],
      timeout_seconds: 300,
    }],
    commit_message: 'Add reviewed KRAIL project orientation',
    executable: true,
  }
}

function discovery() {
  return {
    contract: 'krail.project-discovery/v1',
    root: '/work/demo',
    mode: 'onboard',
    fingerprint: DIGEST,
    languages: ['python'],
    file_count: 12,
    repository: { kind: 'git', revision: HEAD, dirty: false },
    commands: [{
      command: 'python -m pytest -q',
      kind: 'test',
      evidence: [{ path: 'pyproject.toml', revision: HEAD, digest: DIGEST }],
    }],
  }
}

function state() {
  return {
    contract: 'opensaddle.project-onboarding/v1',
    project_id: 'demo',
    status: 'ready',
    runner: 'codex_cli',
    fingerprint: DIGEST,
    discovery: discovery(),
    profile: null,
    automation_recommendations: null,
    recommendation_options: [option()],
    active_run_id: null,
    execution_head: HEAD,
    execution_ready: true,
    execution_barriers: [],
    refresh_required: false,
    error: null,
  }
}

function readiness() {
  return {
    contract: 'opensaddle.onboarding-readiness/v1',
    project_id: 'demo',
    runner: 'codex_cli',
    ready: true,
    discovery_ready: true,
    execution_ready: true,
    discovery_barriers: [],
    execution_barriers: [],
    informational_checks: ['source_has_no_opensaddle_state'],
    warnings: [],
    checks: {
      registered_project: true,
      root_exists: true,
      git_repository: true,
      git_head: true,
      git_clean: true,
      runner_executable: true,
      runner_authenticated: true,
      krail_discovery: true,
      state_root_external: true,
      source_has_no_opensaddle_state: true,
      state_root_writable: true,
    },
    root: '/work/demo',
    head: HEAD,
    runner_path: '/usr/local/bin/codex',
    harness: { id: 'codex', installed: true, readiness: 'ready', login_guidance: null },
    state: {
      database: '/state/onboarding.sqlite3',
      worktrees: '/state/onboarding-worktrees',
      receipts: '/state/onboarding-receipts',
      episodes: '/state/onboarding-episodes',
    },
    error: null,
    isolation: 'detached_git_worktree_only',
    warning: 'The selected coding-agent subprocess runs with the local user\'s host authority.',
  }
}

test('parses every authoritative vendored onboarding wire fixture transition', () => {
  const fixture = JSON.parse(readFileSync(
    new URL('./fixtures/opensaddle.project-onboarding.v1.wire.json', import.meta.url),
    'utf8',
  )) as Record<string, any>
  assert.equal(fixture.contract, 'opensaddle.project-onboarding-wire-fixture/v1')
  assert.equal(fixture.health_capability, 'project_onboarding')

  const ready = projectOnboardingReadinessFromWire(fixture.readiness, 'demo', 'codex_cli')
  assert.equal(ready.discoveryReady, true)
  assert.equal(ready.executionReady, true)
  assert.deepEqual(ready.informationalChecks, ['source_has_no_opensaddle_state'])

  const prepared = projectOnboardingStateFromWire(fixture.state, 'demo')
  assert.equal(prepared.executionHead, HEAD)
  assert.equal(prepared.recommendationOptions[0]?.recommendationId, 'project-orient')

  const proposal = projectOnboardingChangeFromWire(fixture.proposal, 'demo')
  assert.equal(proposal.status, 'approval_required')
  assert.match(proposal.patch ?? '', /krail\.project-profile\/v1/)
  assert.equal(proposal.recommendationOptions[0]?.kind, 'project_action')

  const exactDiff = projectOnboardingDiffFromWire(fixture.diff, 'onb_demo')
  assert.equal(exactDiff.diffDigest, proposal.diffDigest)
  assert.deepEqual(exactDiff.changedFiles, proposal.changedFiles)

  const committed = projectOnboardingChangeFromWire(fixture.committed, 'demo')
  assert.equal(committed.status, 'committed')
  assert.equal(committed.baseCommit, HEAD)
  assert.equal(committed.commit, COMMIT)
  assert.equal(committed.author?.email, 'local-demo@opensaddle.invalid')

  const applied = projectOnboardingChangeFromWire(fixture.applied, 'demo')
  assert.equal(applied.status, 'applied')
  assert.equal(applied.commit, committed.commit)
  assert.equal(applied.baseCommit, committed.baseCommit)
})

test('uses only the authoritative governed onboarding endpoints and local-action credential', async () => {
  const calls: Array<{ method: string; path: string; body?: unknown; localAction?: string | null }> = []
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    calls.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      localAction: headers.get('X-OpenSaddle-Local-Action'),
    })
    if (path === '/api/local-action-token') return json({ token: 'local-proof', header: 'X-OpenSaddle-Local-Action' })
    if (path === '/api/projects/demo/onboarding' && method === 'GET') return json(state())
    if (path === '/api/projects/demo/onboarding/readiness?runner=codex_cli' && method === 'GET') return json(readiness())
    if (path === '/api/projects/demo/onboarding/prepare' && method === 'POST') return json(state())
    if (path === '/api/projects/demo/onboarding/proposals' && method === 'POST') return json({
      contract: 'opensaddle.onboarding-change-proposal/v1',
      project_id: 'demo',
      run_id: 'onboard-1',
      recommendation_id: 'project-orient',
      fingerprint: DIGEST,
      status: 'running',
      diff_digest: null,
      changed_files: [],
      patch: null,
      verification: option().verification,
      activity: [{ type: 'run.queued', kind: 'run.queued', label: 'Run Queued', detail: null, at: '2026-08-15T12:00:00Z', timestamp: '2026-08-15T12:00:00Z' }],
      checks: [],
      profile: null,
      automation_recommendations: null,
      recommendation_options: [],
    }, 202)
    if (path === '/api/projects/demo/onboarding/proposals/onboard-1' && method === 'GET') return json({
      contract: 'opensaddle.onboarding-change-proposal/v1',
      project_id: 'demo',
      run_id: 'onboard-1',
      recommendation_id: 'project-orient',
      fingerprint: DIGEST,
      status: 'approval_required',
      diff_digest: DIFF_DIGEST,
      changed_files: ['research_plan/state/project_profile.proposal.json'],
      patch: 'diff --git a/profile.json b/profile.json\n+{"contract":"krail.project-profile/v1"}\n',
      verification: option().verification,
      activity: [{ type: 'approval.required', kind: 'approval.required', label: 'Approval Required', detail: null, at: '2026-08-15T12:01:00Z', timestamp: '2026-08-15T12:01:00Z' }],
      checks: [],
      profile: {
        contract: 'krail.project-profile/v1',
        fingerprint: DIGEST,
        summary: 'Python service',
        review: { status: 'proposed' },
        claims: [{ text: 'Tests use pytest.', evidence: [{ path: 'pyproject.toml', revision: HEAD, digest: DIGEST }] }],
      },
      automation_recommendations: {
        contract: 'krail.automation-recommendations/v1',
        fingerprint: DIGEST,
        summary: 'One bounded automation',
        review: { status: 'proposed' },
        claims: [{ text: 'Run pytest before commit.', evidence: [{ path: 'pyproject.toml', revision: HEAD, digest: DIGEST }] }],
        recommendations: [option('verify-change')],
      },
      recommendation_options: [option('verify-change')],
    })
    if (path === '/api/projects/demo/onboarding/proposals/onboard-1/diff') return json({
      contract: 'opensaddle.onboarding-diff/v1',
      run_id: 'onboard-1',
      diff_digest: DIFF_DIGEST,
      changed_files: ['research_plan/state/project_profile.proposal.json'],
      patch: 'diff --git a/profile.json b/profile.json\n+profile\n',
    })
    if (path === '/api/projects/demo/onboarding/proposals/onboard-1/approve') return json({
      contract: 'opensaddle.onboarding-change-receipt/v1',
      project_id: 'demo',
      run_id: 'onboard-1',
      recommendation_id: 'project-orient',
      fingerprint: DIGEST,
      status: 'committed',
      diff_digest: DIFF_DIGEST,
      changed_files: ['research_plan/state/project_profile.proposal.json'],
      verification: option().verification,
      activity: [],
      checks: [{ name: 'proposal-contracts', passed: true, exit_code: 0 }],
      recommendation_options: [option('verify-change')],
      commit: COMMIT,
      base_commit: HEAD,
      author: { name: 'OpenSaddle Local Demo', email: 'opensaddle@local.invalid' },
      ref: 'refs/opensaddle/onboarding/onboard-1',
    })
    if (path === '/api/projects/demo/onboarding/proposals/onboard-1/reject') return json({
      contract: 'opensaddle.onboarding-change-receipt/v1',
      project_id: 'demo',
      run_id: 'onboard-1',
      status: 'rejected',
      changed_files: [],
      verification: [],
      activity: [],
      checks: [],
      recommendation_options: [],
    })
    if (path === '/api/projects/demo/onboarding/proposals/onboard-1/apply') return json({
      contract: 'opensaddle.onboarding-change-receipt/v1',
      project_id: 'demo',
      run_id: 'onboard-1',
      status: 'applied',
      changed_files: [],
      verification: [],
      activity: [],
      checks: [],
      recommendation_options: [],
      commit: COMMIT,
      ref: 'refs/opensaddle/onboarding/onboard-1',
    })
    return json({ detail: `unexpected path ${path}` }, 404)
  })

  const ready = await client.onboardingReadiness('demo', 'codex_cli')
  assert.equal(ready.ready, true)
  assert.equal(ready.discoveryReady, true)
  assert.equal(ready.executionReady, true)
  assert.equal(ready.checks.registered_project, true)
  assert.equal(ready.warning.includes('host authority'), true)
  const prepared = await client.prepareOnboarding('demo', { runner: 'codex_cli' })
  assert.equal(prepared.discovery?.fingerprint, DIGEST)
  assert.equal(prepared.recommendationOptions[0]?.recommendationId, 'project-orient')
  assert.deepEqual(prepared.recommendationOptions[0]?.allowedPaths, [
    'research_plan/state/project_profile.proposal.json',
    'research_plan/state/automation_recommendations.proposal.json',
  ])
  const running = await client.startOnboardingRecommendation('demo', { recommendationId: 'project-orient' })
  assert.equal(running.status, 'running')
  const proposal = await client.onboardingChange('demo', running.runId)
  assert.equal(proposal.status, 'approval_required')
  assert.equal(proposal.automationRecommendations?.contract, 'krail.automation-recommendations/v1')
  assert.equal(proposal.recommendationOptions[0]?.recommendationId, 'verify-change')
  assert.equal((await client.onboardingDiff('demo', running.runId)).diffDigest, DIFF_DIGEST)
  const receipt = await client.approveOnboardingChange('demo', running.runId, {
    approvedBy: 'local-admin', expectedDiffDigest: DIFF_DIGEST,
  })
  assert.equal(receipt.commit, COMMIT)
  assert.equal(receipt.baseCommit, HEAD)
  await client.rejectOnboardingChange('demo', running.runId, { rejectedBy: 'local-admin', reason: 'Revise scope' })
  await client.applyOnboardingCommit('demo', running.runId, {
    appliedBy: 'local-admin', expectedHead: HEAD, expectedCommit: COMMIT,
  })

  const mutations = calls.filter((call) => call.method === 'POST' && call.path !== '/api/local-action-token')
  assert.ok(mutations.length >= 5)
  assert.ok(mutations.every((call) => call.localAction === 'local-proof'))
  assert.deepEqual(calls.find((call) => call.path.endsWith('/proposals') && call.method === 'POST')?.body, {
    recommendation_id: 'project-orient',
  })
  assert.deepEqual(calls.find((call) => call.path.endsWith('/approve'))?.body, {
    approved_by: 'local-admin', expected_diff_digest: DIFF_DIGEST,
  })
  assert.deepEqual(calls.find((call) => call.path.endsWith('/apply'))?.body, {
    applied_by: 'local-admin', expected_head: HEAD, expected_commit: COMMIT,
  })
  assert.equal(calls.some((call) => call.path.startsWith('/api/runs')), false)
})

test('fails closed on invented singular KRAIL recommendation contracts', async () => {
  const bad = state()
  bad.recommendation_options = [{ ...option(), contract: 'krail.automation-recommendation/v1' } as never]
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async () => json(bad))
  await assert.rejects(client.onboardingState('demo'), /untrusted recommendation option contract/)
})

test('never exposes approval when the exact patch is empty', async () => {
  const emptyPatch = {
    contract: 'opensaddle.onboarding-change-proposal/v1',
    project_id: 'demo',
    run_id: 'onboard-empty',
    recommendation_id: 'project-orient',
    fingerprint: DIGEST,
    status: 'approval_required',
    diff_digest: DIFF_DIGEST,
    changed_files: ['research_plan/state/project_profile.proposal.json'],
    patch: '',
    verification: option().verification,
    activity: [],
    checks: [],
    recommendation_options: [],
  }
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async () => json(emptyPatch))
  await assert.rejects(client.onboardingChange('demo', 'onboard-empty'), /exact diff required/)

  const html = renderToStaticMarkup(React.createElement(OnboardingApprovalReview, {
    change: {
      contract: 'opensaddle.onboarding-change-proposal/v1',
      projectId: 'demo',
      runId: 'onboard-empty',
      status: 'approval_required',
      diffDigest: DIFF_DIGEST,
      changedFiles: [],
      patch: '',
      verification: [],
      activity: [],
      checks: [],
      recommendationOptions: [],
    },
    busy: null,
    rejectReason: '',
    onRejectReasonChange: () => undefined,
    onApprove: () => undefined,
    onReject: () => undefined,
  }))
  assert.doesNotMatch(html, /Approve exact diff/)
})

test('refreshes a daemon-rotated local-action token once and never retries other failures', async () => {
  const tokens = ['stale-proof', 'fresh-proof']
  let tokenRequests = 0
  let mutations = 0
  const recoveringClient = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    if (path === '/api/local-action-token') {
      const token = tokens[tokenRequests++]
      return json({ token, header: 'X-OpenSaddle-Local-Action' })
    }
    mutations += 1
    const proof = new Headers(init?.headers).get('X-OpenSaddle-Local-Action')
    return proof === 'stale-proof' ? json({ detail: 'a current local-action token is required' }, 403) : json(state())
  })
  assert.equal((await recoveringClient.prepareOnboarding('demo', { runner: 'codex_cli' })).status, 'ready')
  assert.equal(tokenRequests, 2)
  assert.equal(mutations, 2)

  let conflictMutations = 0
  let conflictTokenRequests = 0
  const conflictClient = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async (input) => {
    if (input.toString().endsWith('/api/local-action-token')) {
      conflictTokenRequests += 1
      return json({ token: 'current-proof', header: 'X-OpenSaddle-Local-Action' })
    }
    conflictMutations += 1
    return json({ detail: 'project HEAD changed' }, 409)
  })
  await assert.rejects(conflictClient.prepareOnboarding('demo', { runner: 'codex_cli' }), /project HEAD changed/)
  assert.equal(conflictTokenRequests, 1)
  assert.equal(conflictMutations, 1)
})

test('keeps deterministic profile discovery available for a non-Git or dirty folder', async () => {
  const profileOnlyReadiness: any = readiness()
  profileOnlyReadiness.ready = false
  profileOnlyReadiness.execution_ready = false
  profileOnlyReadiness.checks.git_repository = false
  profileOnlyReadiness.checks.git_head = false
  profileOnlyReadiness.checks.git_clean = false
  profileOnlyReadiness.execution_barriers = ['git_repository', 'git_head', 'git_clean']
  profileOnlyReadiness.head = null
  profileOnlyReadiness.error = 'registered project root must be the Git repository root'
  const profileOnlyState: any = state()
  profileOnlyState.discovery.repository = { kind: 'directory', revision: null, dirty: true }
  profileOnlyState.execution_head = null
  profileOnlyState.execution_ready = false
  profileOnlyState.execution_barriers = ['git_repository', 'git_head', 'git_clean']
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async (input) => {
    const path = input.toString().replace('http://daemon.test', '')
    if (path === '/api/local-action-token') return json({ token: 'local-proof', header: 'X-OpenSaddle-Local-Action' })
    if (path.includes('/onboarding/readiness')) return json(profileOnlyReadiness)
    if (path.endsWith('/onboarding/prepare')) return json(profileOnlyState)
    return json({ detail: 'unexpected path' }, 404)
  })
  const currentReadiness = await client.onboardingReadiness('demo', 'codex_cli')
  assert.equal(currentReadiness.discoveryReady, true)
  assert.equal(currentReadiness.executionReady, false)
  assert.deepEqual(currentReadiness.executionBarriers, ['git_repository', 'git_head', 'git_clean'])
  const prepared = await client.prepareOnboarding('demo', { runner: 'codex_cli' })
  assert.equal(prepared.discovery?.repository?.kind, 'directory')
  assert.equal(prepared.executionHead, null)
})

test('treats source .opensaddle state as an explicit warning, not a readiness barrier', async () => {
  const warned: any = readiness()
  warned.checks.source_has_no_opensaddle_state = false
  warned.warnings = ['The source contains .opensaddle state. KRAIL discovery ignores it, and governed actions may not write it.']
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async () => json(warned))
  const result = await client.onboardingReadiness('demo', 'codex_cli')
  assert.equal(result.discoveryReady, true)
  assert.equal(result.executionReady, true)
  assert.deepEqual(result.informationalChecks, ['source_has_no_opensaddle_state'])
  assert.match(result.warnings[0] ?? '', /KRAIL discovery ignores it/)
})

test('rejects unknown recommendation kinds and path traversal before presentation', async () => {
  const unknownKind = state()
  unknownKind.recommendation_options = [{ ...option(), kind: 'silent_install' }]
  const kindClient = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async () => json(unknownKind))
  await assert.rejects(kindClient.onboardingState('demo'), /unsupported onboarding recommendation kind/)

  const traversal = state()
  traversal.recommendation_options = [{ ...option(), allowed_paths: ['../outside'] }]
  const pathClient = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async () => json(traversal))
  await assert.rejects(pathClient.onboardingState('demo'), /non-normalized onboarding allowed path scope/)

  for (const protectedScope of ['**', '*', '**/*.txt', '*/config', '.git/config', '.opensaddle/**']) {
    const protectedState = state()
    protectedState.recommendation_options = [{ ...option(), allowed_paths: [protectedScope] }]
    const protectedClient = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async () => json(protectedState))
    await assert.rejects(protectedClient.onboardingState('demo'), /safe literal project root/)
  }

  const ordinaryDotfiles = state()
  ordinaryDotfiles.recommendation_options = [{ ...option(), allowed_paths: ['.github/**', '.gitignore'] }]
  const ordinaryClient = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async () => json(ordinaryDotfiles))
  assert.deepEqual((await ordinaryClient.onboardingState('demo')).recommendationOptions[0]?.allowedPaths, ['.github/**', '.gitignore'])
})

test('renders the backend-shaped exact diff and verification as one inline approval boundary', () => {
  const change: ProjectOnboardingChange = {
    contract: 'opensaddle.onboarding-change-proposal/v1',
    projectId: 'demo',
    runId: 'onboard-1',
    recommendationId: 'project-orient',
    fingerprint: DIGEST,
    status: 'approval_required',
    diffDigest: DIFF_DIGEST,
    changedFiles: ['research_plan/state/project_profile.proposal.json'],
    patch: 'diff --git a/profile.json b/profile.json\n+profile\n',
    verification: [{ name: 'proposal-contracts', command: 'python -m pytest -q', evidence: ['pyproject.toml:tool.pytest'] }],
    activity: [],
    checks: [],
    recommendationOptions: [],
  }
  const html = renderToStaticMarkup(React.createElement(OnboardingApprovalReview, {
    change,
    busy: null,
    rejectReason: '',
    onRejectReasonChange: () => undefined,
    onApprove: () => undefined,
    onReject: () => undefined,
  }))
  assert.match(html, /Exact approval boundary/)
  assert.match(html, /research_plan\/state\/project_profile\.proposal\.json/)
  assert.match(html, /diff --git a\/profile\.json b\/profile\.json/)
  assert.match(html, /python -m pytest -q/)
  assert.match(html, /Approve exact diff &amp; verify/)
  assert.match(html, /Reject &amp; clean worktree/)
})

test('disables both approval decisions while either transition is in flight', () => {
  const change: ProjectOnboardingChange = {
    contract: 'opensaddle.onboarding-change-proposal/v1',
    projectId: 'demo',
    runId: 'onboard-1',
    status: 'approval_required',
    diffDigest: DIFF_DIGEST,
    changedFiles: ['research_plan/state/project_profile.proposal.json'],
    patch: 'diff --git a/profile.json b/profile.json\n+profile\n',
    verification: [],
    activity: [],
    checks: [],
    recommendationOptions: [],
  }
  const html = renderToStaticMarkup(React.createElement(OnboardingApprovalReview, {
    change,
    busy: 'approve',
    rejectReason: '',
    onRejectReasonChange: () => undefined,
    onApprove: () => undefined,
    onReject: () => undefined,
  }))
  assert.ok((html.match(/disabled=""/g) ?? []).length >= 3)
  assert.match(html, /Reject &amp; clean worktree/)
  assert.match(html, /Approve exact diff &amp; verify/)
})

test('shows the exact runner instruction and verification commands before start', () => {
  const recommendation = projectOnboardingStateFromWire(state(), 'demo').recommendationOptions[0]
  assert.ok(recommendation)
  const html = renderToStaticMarkup(React.createElement(OnboardingRecommendationReview, {
    option: recommendation,
    runnerLabel: 'Codex CLI',
  }))
  assert.match(html, /Review the agent instruction and post-approval verification/)
  assert.match(html, /Codex CLI receives the instruction below/)
  assert.match(html, /only after exact-diff approval/)
  assert.match(html, /Inspect the discovery record and write only the requested proposal files/)
  assert.match(html, /python -m pytest -q/)
  assert.match(html, /pyproject\.toml:tool\.pytest/)
  assert.match(html, /OS, process, network, and credential authority/)
})

test('retries a lost apply response against the approved base after Git already fast-forwarded', () => {
  const change: ProjectOnboardingChange = {
    contract: 'opensaddle.onboarding-change-receipt/v1',
    projectId: 'demo',
    runId: 'onboard-1',
    recommendationId: 'project-orient',
    status: 'committed',
    changedFiles: ['research_plan/state/project_profile.proposal.json'],
    verification: [],
    activity: [],
    checks: [],
    recommendationOptions: [],
    commit: COMMIT,
    baseCommit: HEAD,
  }
  const input = onboardingApplyInput({
    appliedBy: 'local-admin',
    change,
    state: null,
    git: { clean: true, head: COMMIT },
  })
  assert.deepEqual(input, {
    appliedBy: 'local-admin',
    expectedHead: HEAD,
    expectedCommit: COMMIT,
  })
  assert.throws(() => onboardingApplyInput({
    appliedBy: 'local-admin',
    change,
    state: null,
    git: { clean: true, head: 'e'.repeat(40) },
  }), /HEAD changed/)
})

test('blocks discovery refresh for every active review or unapplied commit state', () => {
  const prepared = projectOnboardingStateFromWire(state(), 'demo')
  const activeState = (status: ProjectOnboardingState['status']) => ({
    ...prepared,
    status,
    activeRunId: 'onboard-1',
  })
  const activeChange = (status: ProjectOnboardingChange['status']): ProjectOnboardingChange => ({
    contract: 'opensaddle.onboarding-change-proposal/v1',
    projectId: 'demo',
    runId: 'onboard-1',
    status,
    changedFiles: [],
    verification: [],
    activity: [],
    checks: [],
    recommendationOptions: [],
  })

  assert.match(onboardingRefreshBarrier(activeState('running'), activeChange('running')) ?? '', /Finish or reject/)
  assert.match(onboardingRefreshBarrier(activeState('approval_required'), activeChange('approval_required')) ?? '', /approval required/)
  assert.match(onboardingRefreshBarrier(activeState('approval_required'), activeChange('verification_failed')) ?? '', /verification failed/)
  assert.match(onboardingRefreshBarrier(activeState('committed'), activeChange('committed')) ?? '', /apply any committed change/)
  assert.equal(onboardingRefreshBarrier(activeState('failed'), activeChange('failed')), null)
  assert.equal(onboardingRefreshBarrier(activeState('interrupted'), activeChange('interrupted')), null)
  assert.equal(onboardingRefreshBarrier(activeState('applied'), activeChange('applied')), null)
  assert.equal(onboardingRefreshBarrier({ ...prepared, status: 'ready', activeRunId: null }, null), null)
  assert.match(onboardingRefreshBarrier(activeState('ready'), null) ?? '', /Run onboard-1 is ready/)
  assert.match(onboardingRefreshBarrier(activeState('failed'), { ...activeChange('failed'), runId: 'stale-run' }) ?? '', /Run onboard-1/)
  assert.match(onboardingRefreshBarrier({ ...prepared, status: 'ready', activeRunId: null }, activeChange('running')) ?? '', /Run onboard-1 is running/)

  const page = readFileSync('src/features/onboarding/ProjectOnboardingPage.tsx', 'utf8')
  assert.match(page, /disabled=\{Boolean\(activeRunRefreshBarrier\) \|\| Boolean\(busy\)\}/)
  assert.match(page, /if \(activeRunRefreshBarrier\)/)
})

test('project creation hands off to governed onboarding and never starts a generic natural-language run', () => {
  const app = readFileSync('src/App.tsx', 'utf8')
  assert.match(app, /\/project\/\$\{projectId\}\/onboarding/)
  assert.doesNotMatch(app, /krailOnboardingTask/)
  assert.doesNotMatch(app, /KRAIL onboarding started/)
})

test('rejected authoritative registration creates no renderer project graph', async () => {
  const created = { projects: [] as string[], channels: [] as string[], agents: [] as string[] }
  await assert.rejects(registerLocalWorkspace({
    projectId: 'local_atomic',
    root: '/work/demo',
    registerProject: async () => { throw new Error('registered root is unavailable') },
    commitRendererState: () => {
      created.projects.push('local_atomic')
      created.channels.push('general')
      created.agents.push('builder')
    },
  }), /registered root is unavailable/)
  assert.deepEqual(created, { projects: [], channels: [], agents: [] })
})

test('an old projects-only daemon is unavailable before registration or navigation', async () => {
  let registered = 0
  let navigated = false
  const oldDaemon = {
    controlPlane: { connected: true, mode: 'local' as const, models: [], capabilities: ['projects'] },
    localProjects: { registerProject: async () => { registered += 1; return { projectId: 'demo', root: '/work/demo' } } },
  }
  if (supportsGovernedProjectOnboarding(oldDaemon as never)) {
    await oldDaemon.localProjects.registerProject()
    navigated = true
  }
  assert.equal(registered, 0)
  assert.equal(navigated, false)

  const incompleteNewDaemon = {
    controlPlane: { connected: true, mode: 'local' as const, models: [], capabilities: ['projects', 'project_onboarding'] },
    localProjects: { registerProject: async () => ({ projectId: 'demo', root: '/work/demo' }) },
  }
  assert.equal(supportsGovernedProjectOnboarding(incompleteNewDaemon as never), false)
})
