import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ApplicationRendererCandidate, ApplicationRendererDescriptor, EnvironmentRevision, ExactArtifactRef, MalleableShellClient } from '../services/contracts'
import type { ApplicationProjection } from './executableApplication'
import { DesktopApplicationHost } from './DesktopApplicationHost'
import { migrateApplicationState, validateApplicationState, validateApplicationStateMigration, validateApplicationStateSchema, type ApplicationState } from './applicationState'

void React

type Ready = {
  client: MalleableShellClient
  environment: EnvironmentRevision
  renderer: ApplicationRendererDescriptor
  candidates: ApplicationRendererCandidate[]
  previous?: { revision: number; renderer: ApplicationRendererDescriptor; application: NonNullable<EnvironmentRevision['definition']['applications']>[number]; replacementState?: ApplicationState }
  pending?: boolean
  error?: string
  hostStatus: 'loading' | 'ready' | 'error'
  hostGeneration?: number
  reportedHostState?: 'loading' | 'ready' | 'error'
  reportedHostError?: string
  hostRestart?: number
  allowStateTransfer: boolean
  stateNotice?: string
  initialState?: ApplicationState
}
type State = { kind: 'loading' } | { kind: 'unavailable'; reason: string } | ({ kind: 'ready' } & Ready)
type HostReporter = { key: string; active: boolean; sequence: number; lastRequested?: 'loading' | 'ready' | 'error'; heartbeat?: ReturnType<typeof setTimeout>; session: Promise<{ session_id: string; report_token: string; next_sequence: number }>; chain: Promise<void>; report: (state: 'loading' | 'ready' | 'error', heartbeat?: boolean) => void }
const samePackage = (a: { package_id: string; version: string; manifest_digest: string }, b: { package_id: string; version: string; manifest_digest: string }) => a.package_id === b.package_id && a.version === b.version && a.manifest_digest === b.manifest_digest
const packageKey = (value: { package_id: string; version: string; manifest_digest: string }) => `${value.package_id}\0${value.version}\0${value.manifest_digest}`
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)
const hostObservationErrorText = (reason: unknown) => {
  const detail = errorText(reason)
  if (detail.includes('renderer_host_observation_stale')) return 'Core rejected a stale host report. Rechecking the current host session.'
  if (detail.includes('renderer_host_session')) return 'The host observation session is no longer current. Rechecking authority.'
  return detail
}

function replacementStateContract(current: ApplicationRendererDescriptor, candidate: ApplicationRendererCandidate, state?: ApplicationState) {
  try {
    const currentSchema = validateApplicationStateSchema(current.state_schema)
    const nextSchema = validateApplicationStateSchema(candidate.state_schema)
    if (current.state_schema_version === candidate.state_schema_version) {
      if (JSON.stringify(currentSchema) !== JSON.stringify(nextSchema)) {
        throw Error('The replacement changes its saved-state schema without a migration.')
      }
      const replacementState = state === undefined ? undefined : validateApplicationState(state, nextSchema)
      if (state !== undefined && !replacementState) throw Error('The current saved state does not satisfy the replacement schema.')
      return { migration: undefined, notice: undefined, replacementState }
    }
    if (!candidate.state_compatibility?.accepts_from_versions.includes(current.state_schema_version)) {
      throw Error('The replacement does not accept saved state from the selected version.')
    }
    const migration = candidate.state_migrations
      ?.map(value => validateApplicationStateMigration(value, nextSchema, candidate.state_schema_version))
      .find((value): value is NonNullable<typeof value> => Boolean(value && value.from_version === current.state_schema_version && value.to_version === candidate.state_schema_version))
    if (!migration) throw Error('The replacement does not declare the required saved-state migration.')
    const removed = migration.operations.filter(operation => operation.op === 'drop').map(operation => operation.path)
    const replacementState = state === undefined ? undefined : migrateApplicationState(state, currentSchema, nextSchema, migration)
    if (state !== undefined && !replacementState) throw Error('The current saved state cannot be migrated into the replacement schema.')
    return {
      migration,
      notice: removed.length > 0 ? `The signed migration removes saved fields: ${removed.join(', ')}.` : undefined,
      replacementState,
    }
  } catch (reason) {
    throw Error(`Replacement refused: ${errorText(reason)} The current application and its saved state remain active.`)
  }
}

export function CanonicalRendererLifecycle({ client, resource, projection, connectionKey, applicationId = 'review-evidence', instanceId = 'review-main' }: { client: MalleableShellClient; resource: ExactArtifactRef; projection: ApplicationProjection; connectionKey: string; applicationId?: string; instanceId?: string }) {
  const generation = useRef(0)
  const busy = useRef(false)
  const rendererStates = useRef(new Map<string, ApplicationState>())
  const stateAuthority = useRef('')
  const activeRenderer = useRef<ApplicationRendererDescriptor | undefined>(undefined)
  const hostId = useRef(`desktop:${crypto.randomUUID()}`)
  const observation = useRef<HostReporter | undefined>(undefined)
  const currentHostStatus = useRef<'loading' | 'ready' | 'error'>('loading')
  const hostRestarts = useRef(0)
  const [state, setState] = useState<State>({ kind: 'loading' })

  const authorityKey = `${connectionKey}\0${resource.project_id}\0${resource.run_id}\0${resource.artifact_id}\0${resource.digest}\0${applicationId}\0${instanceId}`
  if (stateAuthority.current !== authorityKey) {
    stateAuthority.current = authorityKey
    rendererStates.current.clear()
    hostRestarts.current = 0
  }

  const load = useCallback(async (previous?: Ready['previous'], restoreSnapshot = false) => {
    const current = ++generation.current
    if (!previous && !restoreSnapshot) setState({ kind: 'loading' })
    if (!client.applicationRenderers || !client.applicationRendererCandidates) {
      setState({ kind: 'unavailable', reason: 'Application lifecycle controls are unavailable from this server.' })
      return
    }
    try {
      const [renderers, candidates, environment] = await Promise.all([client.applicationRenderers(resource.project_id), client.applicationRendererCandidates(resource.project_id), client.environment(resource.project_id)])
      if (current !== generation.current) return
      const renderer = renderers.find(item => item.application_id === applicationId && item.instance_id === instanceId)
      if (!renderer || renderer.execution_trust !== 'trusted_signed_publisher') throw Error('No authorized desktop renderer is selected for this application.')
      const eligible = candidates.filter(item => item.application_id === applicationId && item.environment_application?.instances.some(instance => instance.instance_id === instanceId))
      const selected = eligible.find(item => samePackage({ package_id: item.package_id, version: item.package_version, manifest_digest: item.manifest_digest }, renderer.package_ref))
      const stateContract = previous && selected ? replacementStateContract(previous.renderer, selected) : undefined
      const allowStateTransfer = restoreSnapshot || Boolean(previous && stateContract)
      const stateNotice = stateContract?.notice
      const initialState = restoreSnapshot ? rendererStates.current.get(packageKey(renderer.package_ref)) : previous?.replacementState
      setState({ kind: 'ready', client, environment, renderer, candidates: eligible, previous, hostStatus: 'loading', allowStateTransfer, stateNotice, initialState })
    } catch (reason) {
      if (current === generation.current) setState(value => previous && value.kind === 'ready'
        ? { ...value, previous, pending: false, error: errorText(reason), hostStatus: 'error' }
        : { kind: 'unavailable', reason: errorText(reason) })
    }
  }, [applicationId, client, instanceId, resource.project_id])

  useEffect(() => { busy.current = false; void load(); return () => { generation.current++; busy.current = false } }, [load])
  const observeHostStatus = useCallback((hostStatus: 'loading' | 'ready' | 'error', hostGeneration: number) => setState(value => value.kind === 'ready' && (value.hostStatus !== hostStatus || value.hostGeneration !== hostGeneration) ? { ...value, hostStatus, hostGeneration } : value), [])
  if (state.kind === 'ready') activeRenderer.current = state.renderer
  else activeRenderer.current = undefined
  const observeRendererState = useCallback((value: ApplicationState) => {
    const renderer = activeRenderer.current
    if (!renderer) return
    const valid = validateApplicationState(value, renderer.state_schema)
    if (valid) rendererStates.current.set(packageKey(renderer.package_ref), valid)
  }, [])

  const observationKey = state.kind === 'ready' && state.hostGeneration
    ? `${authorityKey}\0${state.renderer.package_ref.package_id}\0${state.renderer.package_ref.version}\0${state.renderer.package_ref.manifest_digest}\0${state.environment.revision}\0${state.environment.definition_digest}\0${state.hostGeneration}`
    : ''
  currentHostStatus.current = state.kind === 'ready' ? state.hostStatus : 'loading'
  useEffect(() => {
    if (!observationKey || state.kind !== 'ready' || !client.createRendererHostSession || !client.reportRendererHostObservation) return
    const captured = state
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const start = () => {
      if (cancelled) return
      const reporter: HostReporter = {
        key: observationKey, active: true, sequence: 0,
        session: client.createRendererHostSession!(resource.project_id, { host_id: hostId.current, application_id: captured.renderer.application_id, instance_id: captured.renderer.instance_id, package_ref: captured.renderer.package_ref, environment_revision: captured.environment.revision, environment_definition_digest: captured.environment.definition_digest, generation: captured.hostGeneration! }),
        chain: Promise.resolve(), report: () => {},
      }
      reporter.report = (next, heartbeat = false) => {
        if (!heartbeat && reporter.lastRequested === next) return
        reporter.lastRequested = next
        if (reporter.heartbeat) clearTimeout(reporter.heartbeat)
        reporter.chain = reporter.chain.then(async () => {
          const session = await reporter.session
          if (!reporter.active || observation.current !== reporter) return
          if (reporter.sequence === 0) reporter.sequence = session.next_sequence
          const sequence = reporter.sequence
          await client.reportRendererHostObservation!(session.session_id, session.report_token, { sequence, state: next, ...(next === 'error' ? { error_code: 'renderer_unavailable' } : {}) })
          reporter.sequence = sequence + 1
          if (!reporter.active || observation.current !== reporter) return
          if (next !== 'ready' || currentHostStatus.current === 'ready') {
            setState(value => value.kind === 'ready' && observationKey === reporter.key ? { ...value, reportedHostState: next, reportedHostError: undefined } : value)
          }
          if (next === 'ready') hostRestarts.current = 0
          if (next === 'ready' && currentHostStatus.current === 'ready' && reporter.lastRequested === 'ready') {
            reporter.heartbeat = setTimeout(() => {
              if (currentHostStatus.current === 'ready' && reporter.lastRequested === 'ready') reporter.report('ready', true)
            }, 10_000)
          }
        }).catch(reason => {
          if (!reporter.active || observation.current !== reporter) return
          if (reporter.heartbeat) clearTimeout(reporter.heartbeat)
          setState(value => value.kind === 'ready' && observationKey === reporter.key ? { ...value, reportedHostState: undefined, reportedHostError: hostObservationErrorText(reason) } : value)
          const failedSequence = reporter.sequence
          const failedState = reporter.lastRequested!
          const reconcile = async (attempt: number) => {
            if (!reporter.active || observation.current !== reporter || currentHostStatus.current === 'error' || !client.rendererHostObservations) return
            try {
              const rows = await client.rendererHostObservations(resource.project_id)
              const session = await reporter.session
              const row = rows.items.find(item => item.session_id === session.session_id)
              if (!row || row.state === 'unknown') {
                reporter.active = false
                const canRestart = hostRestarts.current < 1
                if (canRestart) hostRestarts.current++
                setState(value => value.kind === 'ready' && observationKey === reporter.key ? { ...value, ...(canRestart ? { hostRestart: (value.hostRestart ?? 0) + 1 } : {}), reportedHostState: undefined, reportedHostError: canRestart ? 'The prior host observation session expired. Restarting the isolated renderer.' : 'The host observation session remains unavailable. Retry by reopening this application.' } : value)
                return
              }
              if (row.sequence >= failedSequence) {
                reporter.sequence = row.sequence + 1
                setState(value => value.kind === 'ready' && observationKey === reporter.key ? { ...value, reportedHostState: failedState, reportedHostError: undefined } : value)
                if (failedState === 'ready') reporter.heartbeat = setTimeout(() => reporter.report('ready', true), 10_000)
                return
              }
              reporter.chain = Promise.resolve()
              reporter.lastRequested = undefined
              reporter.report(failedState, true)
            } catch {
              if (attempt < 3 && reporter.active && observation.current === reporter) retryTimer = setTimeout(() => void reconcile(attempt + 1), attempt * 1_000)
            }
          }
          retryTimer = setTimeout(() => void reconcile(1), 1_000)
        })
      }
      observation.current = reporter
      reporter.report(currentHostStatus.current)
    }
    start()
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); const reporter = observation.current; if (reporter?.key === observationKey) { reporter.active = false; if (reporter.heartbeat) clearTimeout(reporter.heartbeat); observation.current = undefined } }
  }, [client, observationKey, resource.project_id])
  useEffect(() => {
    const reporter = observation.current
    if (!reporter || reporter.key !== observationKey || state.kind !== 'ready') return
    reporter.report(state.hostStatus)
    if (state.hostStatus !== 'ready' && reporter.heartbeat) clearTimeout(reporter.heartbeat)
  }, [observationKey, state.kind === 'ready' ? state.hostStatus : 'loading'])

  const definitionFor = (environment: EnvironmentRevision, candidate: ApplicationRendererCandidate, application = candidate.environment_application!) => ({
    ...environment.definition,
    packages: [...(environment.definition.packages ?? []).filter(value => !value || typeof value !== 'object' || (value as { package_id?: unknown }).package_id !== candidate.package_id), candidate.environment_application!.package_ref],
    applications: [...(environment.definition.applications ?? []).filter(value => value.application_id !== candidate.application_id), application],
  })

  const replace = async (candidate: ApplicationRendererCandidate) => {
    if (state.kind !== 'ready' || busy.current || !client.enableApplicationRendererCandidate || !candidate.environment_application) return
    const current = generation.current
    const application = state.environment.definition.applications?.find(value => value.application_id === applicationId)
    if (!application) return
    let replacementState: ApplicationState | undefined
    try {
      const sourceState = rendererStates.current.get(packageKey(state.renderer.package_ref))
      replacementState = replacementStateContract(state.renderer, candidate, sourceState).replacementState
    } catch (reason) {
      setState(value => value.kind === 'ready' ? { ...value, error: errorText(reason) } : value)
      return
    }
    const previous = { revision: state.environment.revision, renderer: state.renderer, application, replacementState }
    busy.current = true
    setState(value => value.kind === 'ready' ? { ...value, previous, pending: true, error: undefined } : value)
    try {
      await client.enableApplicationRendererCandidate(resource.project_id, candidate)
      if (current !== generation.current) return
      const environment = await client.environment(resource.project_id)
      if (current !== generation.current) return
      const currentApplication = environment.definition.applications?.find(value => value.application_id === applicationId)
      const candidateApplication = candidate.environment_application!
      const currentInstances = currentApplication?.instances ?? []
      if (currentInstances.some(instance => !candidateApplication.instances.some(next => next.instance_id === instance.instance_id))) {
        throw Error('The replacement does not declare every configured application instance.')
      }
      const replacementApplication = {
        ...candidateApplication,
        instances: candidateApplication.instances.map(instance => {
          const configured = currentInstances.find(value => value.instance_id === instance.instance_id)
          return configured ? { ...instance, defaults: configured.defaults } : instance
        }),
      }
      const definition = definitionFor(environment, candidate, replacementApplication)
      const preview = await client.preview(resource.project_id, environment.revision, definition, `Check replacement with ${candidate.title}`, environment.definition_digest)
      if (current !== generation.current) return
      if (!preview.activatable) throw Error(preview.requirements.join(', ') || 'The selected application cannot be activated.')
      await client.apply(resource.project_id, environment.revision, definition, `Replace application with ${candidate.title}`, environment.definition_digest)
      if (current !== generation.current) return
      await load(previous)
    } catch (reason) {
      if (current === generation.current) setState(value => value.kind === 'ready' ? { ...value, pending: false, error: errorText(reason), hostStatus: 'error' } : value)
    } finally { busy.current = false }
  }

  const rollback = async () => {
    if (state.kind !== 'ready' || !state.previous || busy.current || !client.enableApplicationRendererCandidate) return
    const current = generation.current
    busy.current = true
    setState(value => value.kind === 'ready' ? { ...value, pending: true, error: undefined } : value)
    try {
      const candidates = await client.applicationRendererCandidates!(resource.project_id)
      const prior = candidates.find(candidate => samePackage({ package_id: candidate.package_id, version: candidate.package_version, manifest_digest: candidate.manifest_digest }, state.previous!.renderer.package_ref))
      if (!prior) throw Error('The previous signed application package is no longer available.')
      await client.enableApplicationRendererCandidate(resource.project_id, prior)
      if (current !== generation.current) return
      const environment = await client.environment(resource.project_id)
      if (current !== generation.current) return
      if (!prior.environment_application) throw Error('The previous application definition is no longer available.')
      const definition = definitionFor(environment, prior, state.previous.application)
      const preview = await client.preview(resource.project_id, environment.revision, definition, 'Check restoration of the previous application', environment.definition_digest)
      if (!preview.activatable) throw Error(preview.requirements.join(', ') || 'The previous application cannot be restored.')
      await client.apply(resource.project_id, environment.revision, definition, 'Restore previous application after activation failure', environment.definition_digest)
      if (current !== generation.current) return
      await load(undefined, true)
    } catch (reason) {
      if (current === generation.current) setState(value => value.kind === 'ready' ? { ...value, pending: false, error: errorText(reason) } : value)
    } finally { busy.current = false }
  }

  if (state.kind === 'loading') return <section className="cc-panel" aria-busy="true"><p role="status">Loading the selected desktop application…</p></section>
  if (state.kind === 'unavailable') return <section className="cc-unavailable"><h2>Desktop application unavailable</h2><p>{state.reason}</p></section>
  if (state.client !== client) return <section className="cc-panel" aria-busy="true"><p>Reauthorizing the desktop application…</p></section>
  const alternatives = state.candidates.filter(candidate => candidate.available.available && !samePackage({ package_id: candidate.package_id, version: candidate.package_version, manifest_digest: candidate.manifest_digest }, state.renderer.package_ref))
  return <>
    <section className="cc-panel"><span className="eyebrow">Application lifecycle</span><h2>{state.renderer.application_id}</h2><p><strong>Selected version {state.renderer.package_ref.version}</strong> · signed package installed and enabled.</p><p>Core confirms the desired configuration. Runtime health from Core is unavailable; the desktop host reports its own isolated process state below.</p>{state.reportedHostState && <p role="status">Host report: {state.reportedHostState}. This client-asserted desktop observation is not semantic verification.</p>}{state.reportedHostError && <p role="alert">Host observation unavailable: {state.reportedHostError}</p>}{state.stateNotice && <p role="status">{state.stateNotice}</p>}{alternatives.length > 0 && <div className="page-actions">{alternatives.map(candidate => <button key={`${candidate.package_id}:${candidate.package_version}`} className="secondary-btn" disabled={state.pending} onClick={() => void replace(candidate)}>Replace with {candidate.title} {candidate.package_version}</button>)}</div>}{state.hostStatus === 'error' && state.previous && <div role="alert"><p>The replacement did not become ready in the desktop host.</p><button className="primary-btn" disabled={state.pending} onClick={() => void rollback()}>Restore previous version</button></div>}{state.error && <p role="alert">{state.error}</p>}<details><summary>Installed application details</summary><p>Environment revision {state.environment.revision} · package <code>{state.renderer.package_ref.package_id}@{state.renderer.package_ref.version}</code></p>{state.candidates.map(candidate => <p key={`${candidate.package_id}:${candidate.package_version}`}><code>{candidate.package_version}</code> · {candidate.enablement?.version === candidate.package_version && candidate.enablement.status === 'enabled' ? 'enabled' : 'installed'} · Core runtime health unavailable</p>)}</details></section>
    <DesktopApplicationHost client={client} projectId={resource.project_id} manifest={state.renderer} connectionKey={connectionKey} projection={projection} onStatus={observeHostStatus} onState={observeRendererState} initialState={state.initialState} allowStateTransfer={state.allowStateTransfer} restartGeneration={state.hostRestart ?? 0} />
  </>
}
