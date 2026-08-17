import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import type {
  ProjectOnboardingChange,
  ProjectOnboardingReadiness,
  ProjectOnboardingReadinessCheck,
  ProjectOnboardingRecommendationOption,
  ProjectOnboardingRunner,
  ProjectOnboardingState,
} from '../../services/contracts'
import { Button, StepProgress } from '../../ui'
import { OnboardingApprovalReview } from './OnboardingApprovalReview'
import { OnboardingRecommendationReview } from './OnboardingRecommendationReview'
import { onboardingApplyInput } from './onboardingApply'
import { supportsGovernedProjectOnboarding } from './onboardingAvailability'
import { onboardingRefreshBarrier } from './onboardingRefresh'
import { runnerCompatibilityBarrier } from './runnerCompatibility'
import './project-onboarding.css'

const RUNNERS: Array<{ id: ProjectOnboardingRunner; label: string; capabilityId: string; detail: string }> = [
  { id: 'codex_cli', label: 'Codex CLI', capabilityId: 'codex', detail: 'Uses your local Codex account and model configuration.' },
  { id: 'claude_code', label: 'Claude Code', capabilityId: 'claude', detail: 'Uses your local Claude Code account and model configuration.' },
]

const STEPS = [
  { label: 'Attached', detail: 'Registered root' },
  { label: 'Discovered', detail: 'KRAIL fingerprint' },
  { label: 'Selected', detail: 'Bound recommendation' },
  { label: 'Running', detail: 'Isolated worktree' },
  { label: 'Review', detail: 'Exact diff' },
  { label: 'Verify', detail: 'Real commands' },
  { label: 'Commit', detail: 'Durable ref' },
  { label: 'Applied', detail: 'Fast-forward replay' },
]

function requestedRunner(value: string | null): ProjectOnboardingRunner {
  return value === 'claude_code' ? 'claude_code' : 'codex_cli'
}

function onboardingStep(state?: ProjectOnboardingState | null, change?: ProjectOnboardingChange | null): number {
  const status = change?.status ?? state?.status
  if (status === 'applied') return 7
  if (status === 'committed') return 6
  if (status === 'verification_failed') return 5
  if (status === 'approval_required') return 4
  if (status === 'running' || status === 'failed' || status === 'interrupted') return 3
  if (state?.recommendationOptions.length) return 2
  if (state?.discovery) return 1
  return 0
}

function statusLabel(state?: ProjectOnboardingState | null, change?: ProjectOnboardingChange | null) {
  const status = change?.status ?? state?.status ?? 'not_prepared'
  return status.replaceAll('_', ' ')
}

function shortDigest(value?: string | null) {
  if (!value) return 'Not available'
  return `${value.slice(0, 18)}…${value.slice(-10)}`
}

function evidenceLocator(item: { path: string; revision?: string | null; digest?: string; span?: { startLine: number; endLine: number } }) {
  const span = item.span ? `:${item.span.startLine}-${item.span.endLine}` : ''
  return `${item.path}${span}${item.revision ? `@${item.revision}` : ''}${item.digest ? `#${item.digest}` : ''}`
}

function optionTitle(option: ProjectOnboardingRecommendationOption) {
  return option.title || option.recommendationId.replaceAll('-', ' ')
}

function checkLabel(check: ProjectOnboardingReadinessCheck) {
  const labels: Record<ProjectOnboardingReadinessCheck, string> = {
    registered_project: 'registered project',
    root_exists: 'project root exists',
    git_repository: 'Git repository root',
    git_head: 'initial Git commit',
    git_clean: 'clean working tree',
    runner_executable: 'runner executable',
    runner_authenticated: 'runner authentication',
    runner_compatible: 'runner CLI compatibility',
    krail_discovery: 'KRAIL discovery runtime',
    state_root_external: 'external OpenSaddle state root',
    source_has_no_opensaddle_state: 'no OpenSaddle state inside source',
    state_root_writable: 'writable OpenSaddle state root',
  }
  return labels[check]
}

export function ProjectOnboardingPage() {
  const { projectId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const {
    data,
    services,
    harnessCapabilities,
    refreshHarnessCapabilities,
    toast,
  } = useStore()
  const project = data.projects.find((candidate) => candidate.id === projectId)
  const client = services?.localProjects
  const [state, setState] = useState<ProjectOnboardingState | null>(null)
  const [readiness, setReadiness] = useState<ProjectOnboardingReadiness | null>(null)
  const [change, setChange] = useState<ProjectOnboardingChange | null>(null)
  const [runner, setRunner] = useState<ProjectOnboardingRunner>(() => requestedRunner(searchParams.get('runner')))
  const [model, setModel] = useState(() => searchParams.get('model') ?? '')
  const [selectedRecommendationId, setSelectedRecommendationId] = useState(() => searchParams.get('recommendation') ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const autoPrepareStarted = useRef(false)
  const runId = searchParams.get('run') ?? state?.activeRunId ?? null
  const runnerWasRequested = searchParams.has('runner')
  const supported = Boolean(
    supportsGovernedProjectOnboarding(services)
    && client?.onboardingState
    && client.onboardingReadiness
    && client.prepareOnboarding
    && client.startOnboardingRecommendation
    && client.onboardingChange
    && client.approveOnboardingChange
    && client.rejectOnboardingChange
    && client.applyOnboardingCommit,
  )

  const refreshState = useCallback(async () => {
    if (!client?.onboardingState || !projectId) return null
    const next = await client.onboardingState(projectId)
    setState(next)
    if (next.runner && !runnerWasRequested) setRunner(next.runner)
    return next
  }, [client, projectId, runnerWasRequested])

  const refreshReadiness = useCallback(async (selectedRunner = runner, selectedModel = model) => {
    if (!client?.onboardingReadiness || !projectId) return null
    const next = await client.onboardingReadiness(projectId, selectedRunner, selectedModel || undefined)
    setReadiness(next)
    return next
  }, [client, model, projectId, runner])

  useEffect(() => {
    if (!supported) return
    setReadiness(null)
    void refreshReadiness().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [refreshReadiness, supported])

  useEffect(() => {
    if (!supported) return
    let active = true
    void refreshState()
      .then((next) => {
        if (!active || !next?.activeRunId || searchParams.get('run')) return
        setSearchParams((current) => {
          const updated = new URLSearchParams(current)
          updated.set('run', next.activeRunId!)
          updated.delete('start')
          return updated
        }, { replace: true })
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [refreshState, searchParams, setSearchParams, supported])

  useEffect(() => {
    if (!runId || !client?.onboardingChange) {
      setChange(null)
      return
    }
    setChange(null)
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await client.onboardingChange!(projectId, runId)
        if (!active) return
        setChange((current) => ({
          ...current,
          ...next,
          patch: next.patch ?? current?.patch,
          diffDigest: next.diffDigest ?? current?.diffDigest,
          changedFiles: next.changedFiles.length ? next.changedFiles : current?.changedFiles ?? [],
          verification: next.verification.length ? next.verification : current?.verification ?? [],
        }))
        setError(null)
        if (next.status === 'running') timer = window.setTimeout(() => void poll(), 850)
        else void refreshState().catch(() => undefined)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    void poll()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
    }
  }, [client, projectId, refreshState, runId])

  useEffect(() => {
    if (
      !supported
      || autoPrepareStarted.current
      || searchParams.get('start') !== '1'
      || !state
      || state.status !== 'not_prepared'
    ) return
    autoPrepareStarted.current = true
    setBusy('prepare')
    setError(null)
    void refreshReadiness(runner)
      .then((currentReadiness) => {
        if (!currentReadiness?.discoveryReady) {
          throw new Error(`OpenSaddle cannot discover this project: ${currentReadiness?.discoveryBarriers.map(checkLabel).join(', ') || 'readiness unavailable'}.`)
        }
        return client!.prepareOnboarding!(projectId, { runner })
      })
      .then((next) => {
        setState(next)
        setSearchParams((current) => {
          const updated = new URLSearchParams(current)
          updated.delete('start')
          updated.set('runner', runner)
          if (model) updated.set('model', model)
          else updated.delete('model')
          return updated
        }, { replace: true })
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(null))
  }, [client, model, projectId, refreshReadiness, runner, searchParams, setSearchParams, state, supported])

  const visibleOptions = useMemo(() => (
    change?.recommendationOptions.length
      ? change.recommendationOptions
      : state?.recommendationOptions ?? []
  ), [change?.recommendationOptions, state?.recommendationOptions])

  useEffect(() => {
    if (visibleOptions.some((option) => option.recommendationId === selectedRecommendationId)) return
    const next = visibleOptions[0]?.recommendationId ?? ''
    setSelectedRecommendationId(next)
  }, [selectedRecommendationId, visibleOptions])

  useEffect(() => {
    if (!selectedRecommendationId) return
    setSearchParams((current) => {
      if (current.get('recommendation') === selectedRecommendationId) return current
      const updated = new URLSearchParams(current)
      updated.set('recommendation', selectedRecommendationId)
      return updated
    }, { replace: true })
  }, [selectedRecommendationId, setSearchParams])

  const selectedOption = visibleOptions.find((option) => option.recommendationId === selectedRecommendationId)
  const runnerInfo = RUNNERS.find((candidate) => candidate.id === runner)!
  const runnerCapability = harnessCapabilities.find((capability) => capability.id === runnerInfo.capabilityId)
  const availableModels = useMemo(
    () => runnerCapability?.models.filter((candidate) => candidate.configured) ?? [],
    [runnerCapability],
  )
  useEffect(() => {
    if (model && runnerCapability && !availableModels.some((candidate) => candidate.id === model)) {
      setModel('')
    }
  }, [availableModels, model, runnerCapability])
  const runnerReady = readiness?.runner === runner && readiness.executionReady
  const repositoryBarrier = !state?.discovery
    ? null
    : state.discovery.repository?.kind !== 'git'
      ? 'KRAIL can profile this folder, but governed change execution requires a Git repository.'
      : !state.discovery.repository.revision
        ? 'KRAIL can profile this repository, but agent execution requires an initial Git commit and HEAD.'
        : state.discovery.repository.dirty
          ? 'KRAIL can profile the current files, but the working tree must be clean before detached-worktree agent execution.'
          : null
  const failedReadinessChecks = readiness?.executionBarriers.map(checkLabel) ?? []
  const compatibilityBarrier = runnerCompatibilityBarrier(readiness)
  const requiredRefreshBarrier = state?.refreshRequired
    ? 'Refresh KRAIL discovery before another action. The applied project change invalidated the previous fingerprint.'
    : null
  const activeRunRefreshBarrier = onboardingRefreshBarrier(state, change)
  const runnerBindingChanged = Boolean(state?.discovery && state.runner && state.runner !== runner)
  const executionReady = Boolean(runnerReady) && !runnerBindingChanged && !repositoryBarrier && !requiredRefreshBarrier
  const profile = change?.profile ?? state?.profile
  const automationRecommendations = change?.automationRecommendations ?? state?.automationRecommendations
  const currentStep = onboardingStep(state, change)

  const prepare = async () => {
    if (!client?.prepareOnboarding) return
    if (busy) return
    if (activeRunRefreshBarrier) {
      setError(activeRunRefreshBarrier)
      return
    }
    setBusy('prepare'); setError(null)
    try {
      const currentReadiness = await refreshReadiness(runner)
      if (!currentReadiness?.discoveryReady) {
        throw new Error(`OpenSaddle cannot discover this project: ${currentReadiness?.discoveryBarriers.map(checkLabel).join(', ') || 'readiness unavailable'}.`)
      }
      setState(await client.prepareOnboarding(projectId, { runner }))
      setChange(null)
      setSearchParams({ runner, ...(selectedRecommendationId ? { recommendation: selectedRecommendationId } : {}), ...(model ? { model } : {}) }, { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const startRecommendation = async () => {
    if (!client?.startOnboardingRecommendation || !selectedOption) return
    if (busy) return
    if (!executionReady) {
      setError(repositoryBarrier ?? compatibilityBarrier ?? `${runnerInfo.label} is not ready. Complete the local runner setup before starting agent work.`)
      return
    }
    setBusy('run'); setError(null)
    try {
      const currentReadiness = await refreshReadiness(runner, model)
      if (!currentReadiness?.executionReady) {
        const failed = currentReadiness
          ? currentReadiness.executionBarriers.map(checkLabel)
          : ['backend readiness check']
        throw new Error(runnerCompatibilityBarrier(currentReadiness) ?? `OpenSaddle readiness changed: ${failed.join(', ')}.`)
      }
      const next = await client.startOnboardingRecommendation(projectId, {
        recommendationId: selectedOption.recommendationId,
        ...(model ? { model } : {}),
      })
      setChange(next)
      setSearchParams({ runner, run: next.runId, recommendation: selectedOption.recommendationId, ...(model ? { model } : {}) }, { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const approve = async () => {
    if (!client?.approveOnboardingChange || !change?.diffDigest) return
    setBusy('approve'); setError(null)
    try {
      const next = await client.approveOnboardingChange(projectId, change.runId, {
        approvedBy: data.currentUserId,
        expectedDiffDigest: change.diffDigest,
      })
      setChange((current) => ({
        ...current,
        ...next,
        patch: next.patch ?? current?.patch,
        diffDigest: next.diffDigest ?? current?.diffDigest,
        changedFiles: next.changedFiles.length ? next.changedFiles : current?.changedFiles ?? [],
        verification: next.verification.length ? next.verification : current?.verification ?? [],
      }))
      await refreshState()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const reject = async () => {
    if (!client?.rejectOnboardingChange || !change) return
    setBusy('reject'); setError(null)
    try {
      setChange(await client.rejectOnboardingChange(projectId, change.runId, {
        rejectedBy: data.currentUserId,
        reason: rejectReason,
      }))
      await refreshState()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const applyCommit = async () => {
    if (!client?.applyOnboardingCommit || !change?.commit || !project?.local || !services?.runtime.gitStatus) return
    setBusy('apply'); setError(null)
    try {
      const git = await services.runtime.gitStatus(projectId, project.local.rootPath)
      const input = onboardingApplyInput({ appliedBy: data.currentUserId, change, state, git })
      const next = await client.applyOnboardingCommit(projectId, change.runId, input)
      setChange((current) => ({ ...current, ...next }))
      await refreshState()
      toast('Onboarding commit applied', `The registered project fast-forwarded to ${change.commit.slice(0, 12)}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  if (!project || project.workspaceKind !== 'local' || !project.local) {
    return <div className="onboarding-empty"><Icon name="folder" /><h2>Local project required</h2><p>KRAIL onboarding is available only for a registered local code project.</p><Button onClick={() => navigate('/start')}>Choose a project</Button></div>
  }

  if (!services?.controlPlane.connected || !supported) {
    return <div className="onboarding-empty"><Icon name="shield" /><h2>Governed onboarding is unavailable</h2><p>{services?.controlPlane.connected ? 'The connected OpenSaddle server does not expose the governed project-onboarding contract.' : 'Connect the local OpenSaddle server. Connected mode never falls back to a simulated onboarding run.'}</p><Button variant="secondary" onClick={() => navigate('/settings')}>Open connection settings</Button></div>
  }

  return (
    <div className="onboarding-page">
      <header className="onboarding-hero">
        <div>
          <span className="onboarding-eyebrow"><Icon name="spark" className="icon xs" /> KRAIL project onboarding</span>
          <h1>{project.name}</h1>
          <p>Discover the repository, run one evidence-backed recommendation in a detached Git worktree, approve the exact diff, verify it, and replay the durable commit explicitly.</p>
          <code>{project.local.rootPath}</code>
        </div>
        <div className="onboarding-hero-status">
          <span className={`onboarding-status ${change?.status ?? state?.status ?? 'not_prepared'}`}><span />{statusLabel(state, change)}</span>
          <small>{services.controlPlane.mode === 'local' ? 'Local server authoritative' : 'Connected server authoritative'}</small>
        </div>
      </header>

      <StepProgress className="onboarding-progress" current={currentStep} steps={STEPS} />

      {error && <div className="onboarding-alert danger" role="alert"><Icon name="alert" /><div><strong>Onboarding stopped</strong><p>{error}</p></div></div>}
      {(state?.error || change?.error) && <div className="onboarding-alert warning" role="status"><Icon name="info" /><div><strong>{change?.recoverable ? 'Run can be recovered' : 'Server reported a barrier'}</strong><p>{change?.error ?? state?.error}</p></div></div>}
      {readiness && <div className={`onboarding-readiness ${readiness.executionReady ? 'ready' : 'blocked'}`} role="status">
        <div><Icon name={readiness.executionReady ? 'check' : 'shield'} /><span><strong>{readiness.executionReady ? 'OpenSaddle is ready for governed agent execution' : readiness.discoveryReady ? 'Project discovery is available; agent execution is blocked' : 'Project discovery is blocked'}</strong><small>{readiness.executionReady ? `${runnerInfo.label} · clean Git HEAD ${readiness.head?.slice(0, 12)}` : readiness.discoveryReady ? `Execution needs: ${failedReadinessChecks.join(', ') || readiness.error || 'unknown readiness check'}` : `Discovery needs: ${readiness.discoveryBarriers.map(checkLabel).join(', ') || readiness.error || 'unknown readiness check'}`}</small></span></div>
        <p><Icon name="alert" />{readiness.warning}</p>
        {compatibilityBarrier && <p><Icon name="terminal" />{compatibilityBarrier}</p>}
        {readiness.warnings.map((warning) => <p key={warning}><Icon name="info" />{warning}</p>)}
      </div>}

      <div className="onboarding-layout">
        <main className="onboarding-main">
          <section className="onboarding-card" aria-labelledby="onboarding-discovery-title">
            <div className="onboarding-card-head">
              <div><span className="onboarding-card-icon"><Icon name="search" /></span><div><h2 id="onboarding-discovery-title">1. Discover and bind</h2><p>OpenSaddle runs deterministic KRAIL discovery first—no coding agent and no source writes—then binds every option to the resulting fingerprint.</p></div></div>
              {state?.discovery && <span className="onboarding-complete"><Icon name="check" /> Complete</span>}
            </div>
            {!state?.discovery ? (
              <div className="onboarding-setup">
                <div className="onboarding-runner-grid">
                  {RUNNERS.map((candidate) => {
                    const capability = harnessCapabilities.find((item) => item.id === candidate.capabilityId)
                    const ready = capability?.availability === 'available' && capability.readiness === 'ready'
                    return <button key={candidate.id} type="button" className={`onboarding-runner${runner === candidate.id ? ' selected' : ''}`} onClick={() => setRunner(candidate.id)} aria-pressed={runner === candidate.id}>
                      <span><Icon name="terminal" /></span><strong>{candidate.label}</strong><small>{candidate.detail}</small><em className={ready ? 'ready' : capability ? 'blocked' : 'checking'}>{ready ? 'Ready' : capability?.readiness === 'needs_auth' ? 'Needs login' : capability?.availability === 'missing' ? 'Not installed' : 'Checking'}</em>
                    </button>
                  })}
                </div>
                <div className="onboarding-actions"><Button variant="secondary" onClick={() => void refreshHarnessCapabilities()}><Icon name="refresh" className="icon xs" />Refresh runners</Button><Button loading={busy === 'prepare'} onClick={() => void prepare()}>Scan project with KRAIL</Button></div>
              </div>
            ) : (
              <div className="onboarding-discovery">
                <dl>
                  <div><dt>Mode</dt><dd>{state.discovery.mode}</dd></div>
                  <div><dt>Files inspected</dt><dd>{state.discovery.fileCount.toLocaleString()}</dd></div>
                  <div><dt>Repository</dt><dd>{state.discovery.repository?.kind ?? 'directory'}{state.discovery.repository?.dirty ? ' · working tree changed' : ' · clean snapshot'}</dd></div>
                  <div><dt>Languages</dt><dd>{state.discovery.languages.join(', ') || 'No language marker detected'}</dd></div>
                  <div><dt>Ecosystems</dt><dd>{state.discovery.ecosystems.join(', ') || 'No ecosystem marker detected'}</dd></div>
                </dl>
                <div className="onboarding-digest"><span>Discovery fingerprint</span><code title={state.discovery.fingerprint}>{shortDigest(state.discovery.fingerprint)}</code></div>
                {state.discovery.commands.length > 0 && <div className="onboarding-command-list"><h3>Repository-backed commands</h3>{state.discovery.commands.map((command) => <div key={`${command.kind}:${command.command}`}><span>{command.kind}</span><code>{command.command}</code><small>{command.evidence.map(evidenceLocator).join(', ')}</small></div>)}</div>}
              </div>
            )}
          </section>

          {state?.discovery && <section className="onboarding-card" id="onboarding-recommendations" aria-labelledby="onboarding-recommendation-title">
            <div className="onboarding-card-head">
              <div><span className="onboarding-card-icon"><Icon name="spark" /></span><div><h2 id="onboarding-recommendation-title">2. Choose a recommendation</h2><p>Options are projected by OpenSaddle from KRAIL’s canonical, evidence-backed proposal.</p></div></div>
              <span className={`onboarding-runner-readiness ${runnerReady ? 'ready' : 'blocked'}`}>{runnerInfo.label} · {runnerReady ? 'ready' : runnerCapability?.readiness?.replaceAll('_', ' ') ?? 'not detected'}</span>
            </div>
            <div className="onboarding-runner-grid" aria-label="Select coding runner">
              {RUNNERS.map((candidate) => <button key={candidate.id} type="button" className={`onboarding-runner${runner === candidate.id ? ' selected' : ''}`} onClick={() => {
                if (candidate.id === runner || activeRunRefreshBarrier) return
                setRunner(candidate.id)
                setReadiness(null)
                setChange(null)
                setSearchParams((current) => {
                  const updated = new URLSearchParams(current)
                  updated.set('runner', candidate.id)
                  updated.delete('run')
                  return updated
                }, { replace: true })
              }} aria-pressed={runner === candidate.id} disabled={Boolean(activeRunRefreshBarrier)}><strong>{candidate.label}</strong><small>{candidate.detail}</small></button>)}
            </div>
            {runnerBindingChanged && <div className="onboarding-alert warning" role="status"><Icon name="refresh" /><div><strong>Rediscovery required for {runnerInfo.label}</strong><p>The prepared recommendations are bound to the previous runner. Run explicit KRAIL rediscovery before execution.</p></div></div>}
            {availableModels.length > 0 && <label className="onboarding-model-select"><span>Runner model</span><select value={model} onChange={(event) => setModel(event.target.value)} disabled={Boolean(busy)}><option value="">Runner default</option>{availableModels.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName ?? candidate.id}{candidate.isDefault ? ' (default)' : ''}</option>)}</select><small>Selecting a model preflights the runner’s <code>--model</code> support before execution.</small></label>}
            {profile && <div className="onboarding-proposal-preview"><div><span>Project profile</span><strong>{profile.summary ?? `${profile.claims.length} source-backed claims`}</strong></div><ul>{profile.claims.slice(0, 5).map((claim, index) => <li key={`${claim.text}:${index}`}><Icon name="check" /><span>{claim.text}<small>{claim.evidence.map(evidenceLocator).join(', ')}</small></span></li>)}</ul></div>}
            {automationRecommendations && <div className="onboarding-proposal-preview"><div><span>Canonical automation proposal</span><strong>{automationRecommendations.summary ?? `${automationRecommendations.claims.length} recommendations`}</strong></div><ul>{automationRecommendations.claims.slice(0, 5).map((claim, index) => <li key={`${claim.text}:${index}`}><Icon name="activity" /><span>{claim.text}<small>{claim.evidence.map(evidenceLocator).join(', ')}</small></span></li>)}</ul></div>}
            <div className="onboarding-options" role="radiogroup" aria-label="KRAIL recommendations">
              {visibleOptions.map((option) => <label key={option.recommendationId} className={selectedRecommendationId === option.recommendationId ? 'selected' : ''}>
                <input type="radio" name="recommendation" value={option.recommendationId} checked={selectedRecommendationId === option.recommendationId} onChange={() => setSelectedRecommendationId(option.recommendationId)} disabled={change?.status === 'running' || change?.status === 'approval_required'} />
                <span><strong>{optionTitle(option)}<i>{option.kind === 'proposal_generation' ? 'Analyze & propose' : 'Project action'}</i></strong><small>{option.summary}</small><span className="onboarding-option-scope"><Icon name="shield" />Allowed paths: {option.allowedPaths.join(', ')}</span><em>{option.verification.length} verification command{option.verification.length === 1 ? '' : 's'} · detached-worktree commit is not applied until explicit approval</em></span>
              </label>)}
              {!visibleOptions.length && <div className="onboarding-empty-inline"><Icon name="info" /><span>No executable recommendation was returned for this fingerprint.</span></div>}
            </div>
            {selectedOption && <OnboardingRecommendationReview option={selectedOption} runnerLabel={runnerInfo.label} />}
            <div className="onboarding-actions"><Button variant="secondary" disabled={Boolean(activeRunRefreshBarrier) || Boolean(busy)} onClick={() => void prepare()} loading={busy === 'prepare'}>{runnerBindingChanged ? `Rediscover for ${runnerInfo.label}` : state.refreshRequired ? 'Refresh KRAIL discovery' : 'Refresh discovery'}</Button><Button disabled={Boolean(busy) || !selectedOption || !executionReady || Boolean(change && !['rejected', 'applied'].includes(change.status))} loading={busy === 'run'} onClick={() => void startRecommendation()}><Icon name="play" className="icon xs" />{selectedOption?.kind === 'proposal_generation' ? 'Analyze and propose setup' : 'Apply project action in worktree'}</Button></div>
            {(activeRunRefreshBarrier || !runnerReady || repositoryBarrier || requiredRefreshBarrier) && <p className="onboarding-inline-barrier"><Icon name="shield" />{activeRunRefreshBarrier ?? requiredRefreshBarrier ?? repositoryBarrier ?? compatibilityBarrier ?? (readiness ? `OpenSaddle readiness failed: ${failedReadinessChecks.join(', ') || readiness.error || 'unknown check'}.` : runnerCapability?.unavailableReason ?? runnerCapability?.auth.message ?? `Checking ${runnerInfo.label} and project readiness with OpenSaddle.`)}</p>}
          </section>}

          {change && <section className="onboarding-card" aria-labelledby="onboarding-run-title">
            <div className="onboarding-card-head">
              <div><span className="onboarding-card-icon"><Icon name="terminal" /></span><div><h2 id="onboarding-run-title">3. Review governed execution</h2><p>Run {change.runId} is owned by the local OpenSaddle server, not renderer state.</p></div></div>
              <span className={`onboarding-status ${change.status}`}><span />{change.status.replaceAll('_', ' ')}</span>
            </div>
            {change.status === 'running' && <div className="onboarding-running"><span className="onboarding-spinner" /><div><strong>{runnerInfo.label} is working in a detached Git worktree</strong><p>OpenSaddle reviews and promotes only that worktree diff. The runner still has the local user's OS, process, network, and credential authority.</p></div></div>}
            {change.activity.length > 0 && <div className="onboarding-activity"><h3>Activity</h3>{change.activity.map((activity, index) => <div key={`${activity.kind}:${activity.timestamp ?? index}`}><Icon name={activity.kind === 'command' ? 'terminal' : activity.kind === 'file' ? 'file' : 'activity'} /><span><strong>{activity.label}</strong><small>{activity.detail ?? activity.timestamp ?? 'Recorded by OpenSaddle'}</small></span></div>)}</div>}
            <OnboardingApprovalReview change={change} busy={busy} rejectReason={rejectReason} onRejectReasonChange={setRejectReason} onApprove={() => void approve()} onReject={() => void reject()} />
          </section>}

          {change?.commit && (change.status === 'committed' || change.status === 'applied') && <section className="onboarding-card onboarding-commit" aria-labelledby="onboarding-commit-title">
            <div className="onboarding-card-head"><div><span className="onboarding-card-icon"><Icon name="git" /></span><div><h2 id="onboarding-commit-title">4. Durable commit and explicit replay</h2><p>The verified commit is retained under an OpenSaddle ref. Nothing is pushed or merged automatically.</p></div></div>{change.status === 'applied' && <span className="onboarding-complete"><Icon name="check" /> Applied</span>}</div>
            <dl><div><dt>Commit</dt><dd><code>{change.commit}</code></dd></div>{change.ref && <div><dt>Durable ref</dt><dd><code>{change.ref}</code></dd></div>}<div><dt>Registered project</dt><dd>{change.status === 'applied' ? 'Fast-forwarded to the verified commit' : 'OpenSaddle has not applied this commit'}</dd></div></dl>
            {change.summary && <pre>{change.summary}</pre>}
            {change.status === 'committed' && <div className="onboarding-actions"><Button variant="secondary" onClick={() => navigator.clipboard?.writeText(`git show ${change.ref ?? change.commit}`)}>Copy inspect command</Button><Button loading={busy === 'apply'} disabled={!services.runtime.gitStatus} onClick={() => void applyCommit()}>Apply verified commit</Button></div>}
            {change.status === 'applied' && <div className="onboarding-actions"><Button variant="secondary" onClick={() => navigate(`/project/${project.id}`)}>Open project</Button>{state?.refreshRequired ? <Button disabled={Boolean(activeRunRefreshBarrier) || Boolean(busy)} onClick={() => void prepare()} loading={busy === 'prepare'}>Refresh KRAIL discovery</Button> : visibleOptions.some((option) => option.recommendationId !== change.recommendationId) && <Button onClick={() => document.getElementById('onboarding-recommendations')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Choose next recommendation</Button>}</div>}
          </section>}
        </main>

        <aside className="onboarding-aside">
          <section><span className="onboarding-eyebrow">Trust boundary</span><h2>What OpenSaddle validates</h2><ul><li><Icon name="folder" /><span><strong>Promoted path scope</strong><small>{project.local.rootPath}</small></span></li><li><Icon name="branch" /><span><strong>Detached worktree review</strong><small>OpenSaddle runs the reviewed change in a detached worktree and only reviews or promotes that worktree diff. OS, process, network, and credential isolation is not provided.</small></span></li><li><Icon name="shield" /><span><strong>Digest-bound approval</strong><small>{change?.diffDigest ? shortDigest(change.diffDigest) : 'Created after the run finishes.'}</small></span></li><li><Icon name="check" /><span><strong>Verification before commit</strong><small>No passing receipt, no durable commit.</small></span></li></ul></section>
          <section><span className="onboarding-eyebrow">Current binding</span><dl><div><dt>Runner</dt><dd>{runnerInfo.label}</dd></div><div><dt>Fingerprint</dt><dd title={state?.fingerprint ?? undefined}>{shortDigest(state?.fingerprint)}</dd></div><div><dt>Run</dt><dd>{change?.runId ?? 'Not started'}</dd></div><div><dt>Authority</dt><dd>Local OpenSaddle server</dd></div></dl></section>
        </aside>
      </div>
    </div>
  )
}
