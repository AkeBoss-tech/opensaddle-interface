import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ApplicationRendererCandidate, ApplicationRendererDescriptor, EnvironmentRevision, ExactArtifactRef, MalleableShellClient } from '../services/contracts'
import type { ApplicationProjection } from './executableApplication'
import { DesktopApplicationHost } from './DesktopApplicationHost'
import { validateApplicationState, validateApplicationStateMigration, validateApplicationStateSchema, type ApplicationState } from './applicationState'

void React

type Ready = {
  client: MalleableShellClient
  environment: EnvironmentRevision
  renderer: ApplicationRendererDescriptor
  candidates: ApplicationRendererCandidate[]
  previous?: { revision: number; renderer: ApplicationRendererDescriptor; application: NonNullable<EnvironmentRevision['definition']['applications']>[number] }
  pending?: boolean
  error?: string
  hostStatus: 'loading' | 'ready' | 'error'
  allowStateTransfer: boolean
  stateNotice?: string
  initialState?: ApplicationState
}
type State = { kind: 'loading' } | { kind: 'unavailable'; reason: string } | ({ kind: 'ready' } & Ready)
const samePackage = (a: { package_id: string; version: string; manifest_digest: string }, b: { package_id: string; version: string; manifest_digest: string }) => a.package_id === b.package_id && a.version === b.version && a.manifest_digest === b.manifest_digest
const packageKey = (value: { package_id: string; version: string; manifest_digest: string }) => `${value.package_id}\0${value.version}\0${value.manifest_digest}`
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

function replacementStateContract(current: ApplicationRendererDescriptor, candidate: ApplicationRendererCandidate) {
  try {
    const currentSchema = validateApplicationStateSchema(current.state_schema)
    const nextSchema = validateApplicationStateSchema(candidate.state_schema)
    if (current.state_schema_version === candidate.state_schema_version) {
      if (JSON.stringify(currentSchema) !== JSON.stringify(nextSchema)) {
        throw Error('The replacement changes its saved-state schema without a migration.')
      }
      return { migration: undefined, notice: undefined }
    }
    if (!candidate.state_compatibility?.accepts_from_versions.includes(current.state_schema_version)) {
      throw Error('The replacement does not accept saved state from the selected version.')
    }
    const migration = candidate.state_migrations
      ?.map(value => validateApplicationStateMigration(value, nextSchema, candidate.state_schema_version))
      .find((value): value is NonNullable<typeof value> => Boolean(value && value.from_version === current.state_schema_version && value.to_version === candidate.state_schema_version))
    if (!migration) throw Error('The replacement does not declare the required saved-state migration.')
    const removed = migration.operations.filter(operation => operation.op === 'drop').map(operation => operation.path)
    return {
      migration,
      notice: removed.length > 0 ? `The signed migration removes saved fields: ${removed.join(', ')}.` : undefined,
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
  const [state, setState] = useState<State>({ kind: 'loading' })

  const authorityKey = `${connectionKey}\0${resource.project_id}\0${resource.run_id}\0${resource.artifact_id}\0${resource.digest}\0${applicationId}\0${instanceId}`
  if (stateAuthority.current !== authorityKey) {
    stateAuthority.current = authorityKey
    rendererStates.current.clear()
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
      const initialState = restoreSnapshot ? rendererStates.current.get(packageKey(renderer.package_ref)) : undefined
      setState({ kind: 'ready', client, environment, renderer, candidates: eligible, previous, hostStatus: 'loading', allowStateTransfer, stateNotice, initialState })
    } catch (reason) {
      if (current === generation.current) setState(value => previous && value.kind === 'ready'
        ? { ...value, previous, pending: false, error: errorText(reason), hostStatus: 'error' }
        : { kind: 'unavailable', reason: errorText(reason) })
    }
  }, [applicationId, client, instanceId, resource.project_id])

  useEffect(() => { busy.current = false; void load(); return () => { generation.current++; busy.current = false } }, [load])
  const observeHostStatus = useCallback((hostStatus: 'loading' | 'ready' | 'error') => setState(value => value.kind === 'ready' && value.hostStatus !== hostStatus ? { ...value, hostStatus } : value), [])
  if (state.kind === 'ready') activeRenderer.current = state.renderer
  else activeRenderer.current = undefined
  const observeRendererState = useCallback((value: ApplicationState) => {
    const renderer = activeRenderer.current
    if (!renderer) return
    const valid = validateApplicationState(value, renderer.state_schema)
    if (valid) rendererStates.current.set(packageKey(renderer.package_ref), valid)
  }, [])

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
    try {
      replacementStateContract(state.renderer, candidate)
    } catch (reason) {
      setState(value => value.kind === 'ready' ? { ...value, error: errorText(reason) } : value)
      return
    }
    const previous = { revision: state.environment.revision, renderer: state.renderer, application }
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
    <section className="cc-panel"><span className="eyebrow">Application lifecycle</span><h2>{state.renderer.application_id}</h2><p><strong>Selected version {state.renderer.package_ref.version}</strong> · signed package installed and enabled.</p><p>Core confirms the desired configuration. Runtime health from Core is unavailable; the desktop host reports its own isolated process state below.</p>{state.stateNotice && <p role="status">{state.stateNotice}</p>}{alternatives.length > 0 && <div className="page-actions">{alternatives.map(candidate => <button key={`${candidate.package_id}:${candidate.package_version}`} className="secondary-btn" disabled={state.pending} onClick={() => void replace(candidate)}>Replace with {candidate.title} {candidate.package_version}</button>)}</div>}{state.hostStatus === 'error' && state.previous && <div role="alert"><p>The replacement did not become ready in the desktop host.</p><button className="primary-btn" disabled={state.pending} onClick={() => void rollback()}>Restore previous version</button></div>}{state.error && <p role="alert">{state.error}</p>}<details><summary>Installed application details</summary><p>Environment revision {state.environment.revision} · package <code>{state.renderer.package_ref.package_id}@{state.renderer.package_ref.version}</code></p>{state.candidates.map(candidate => <p key={`${candidate.package_id}:${candidate.package_version}`}><code>{candidate.package_version}</code> · {candidate.enablement?.version === candidate.package_version && candidate.enablement.status === 'enabled' ? 'enabled' : 'installed'} · Core runtime health unavailable</p>)}</details></section>
    <DesktopApplicationHost client={client} projectId={resource.project_id} manifest={state.renderer} connectionKey={connectionKey} projection={projection} onStatus={observeHostStatus} onState={observeRendererState} initialState={state.initialState} allowStateTransfer={state.allowStateTransfer} />
  </>
}
