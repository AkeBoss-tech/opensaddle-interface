import { applicationRouteHref } from './applicationRouteHref'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectorInvocationResult, EnvironmentPreview, EnvironmentRevision, ExactArtifactRef, MalleableShellClient, RunConnectorCapability, ShellCommandDescriptor, ShellCommandResult } from '../../services/contracts'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { beginReviewWorkspaceTransition, buildReviewEnvironmentDefinition, hydrateReviewWorkspace, reviewCommandFailureTitle, reviewCommandUnavailableMessage, type ReviewWorkspaceLoadedState } from './reviewWorkspaceModel'
import { getSurface, registerSurface } from '../../surfaces/registry'

// Node's mounted renderer uses the classic JSX transform.
void React

export interface ReviewApplicationConfig { applicationId: string; commandId: string; packageProvenance?: { packageId: string; version: string; manifestDigest: string } }
// oxlint-disable-next-line react/only-export-components -- declarative config is part of the registered surface contract.
export const builtInReviewApplication: ReviewApplicationConfig = { applicationId: 'opensaddle.review.workspace.v1', commandId: 'dev.opensaddle.artifact.review' }

export function ReviewWorkspaceSurface({ client, runId, projectId, invocationId = '', artifactId = '', artifactDigest = '', application = builtInReviewApplication }: { client?: MalleableShellClient; runId: string; projectId: string; invocationId?: string; artifactId?:string;artifactDigest?:string; application?: ReviewApplicationConfig }) {
  const [descriptor, setDescriptor] = useState<ShellCommandDescriptor>()
  const [descriptors, setDescriptors] = useState<ShellCommandDescriptor[]>([])
  const [artifacts, setArtifacts] = useState<ExactArtifactRef[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [result, setResult] = useState<ShellCommandResult>()
  const [environment, setEnvironment] = useState<EnvironmentRevision>()
  const [preview, setPreview] = useState<EnvironmentPreview>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadedState, setLoadedState] = useState<ReviewWorkspaceLoadedState>()
  const [loadedRequestKey,setLoadedRequestKey]=useState('')
  const [connectors, setConnectors] = useState<RunConnectorCapability[]>([])
  const [selectedConnectorAction, setSelectedConnectorAction] = useState<{ connector: string; action: string }>()
  const [connectorArguments, setConnectorArguments] = useState<Record<string, unknown>>({})
  const [connectorResult, setConnectorResult] = useState<ConnectorInvocationResult>()
  const [perspective, setPerspective] = useState<'review' | 'evidence'>('review')
  const [staleResult, setStaleResult] = useState(false)
  const generation = useRef(0)
  const invocationLock = useRef(false)
  const invocationSequence = useRef(0)

  useEffect(() => {
    const currentGeneration = ++generation.current
    invocationSequence.current++
    invocationLock.current = false
    setBusy(false)
    let active = true
    if (!client || !runId || !projectId) return
    setLoadedState(undefined)
    setLoadedRequestKey('')
    setArtifacts([]); setDescriptor(undefined); setResult(undefined); setStaleResult(false)
    setLoading(true)
    setError('')
    setPreview(undefined)
    setSelectedConnectorAction(undefined)
    setConnectorArguments({})
    setConnectorResult(undefined)
    void Promise.all([
      client.commands(projectId),
      client.artifacts(runId, projectId),
      client.environment(projectId),
      client.invocations(projectId),
      client.connectors(runId),
      invocationId ? client.invocation(invocationId) : Promise.resolve(undefined),
    ]).then(([commands, refs, revision, invocations, discoveredConnectors, requestedInvocation]) => {
      if (!active || currentGeneration !== generation.current) return
      const discovered = commands.find((item) => item.command_id === application.commandId) ?? commands[0]
      const hydrated = hydrateReviewWorkspace({ projectId, runId }, refs, requestedInvocation ? [requestedInvocation] : invocations, discovered, application.commandId)
      const requestKey=`${artifactId}:${artifactDigest}`
      const explicitArtifact=Boolean(artifactId||artifactDigest)
      const requested=refs.find(item=>item.artifact_id===artifactId&&(!artifactDigest||item.digest===artifactDigest))
      setDescriptor(discovered)
      setDescriptors(commands)
      setArtifacts(explicitArtifact&&!requested?[]:refs)
      setSelectedId(explicitArtifact?(requested?.artifact_id??''):hydrated.selectedId)
      setEnvironment(revision)
      setResult(requested?hydrated.result&&hydrated.result.resource.artifact_id===requested.artifact_id&&hydrated.result.resource.digest===requested.digest?hydrated.result:undefined:explicitArtifact?undefined:hydrated.result)
      setStaleResult(!hydrated.result && (requestedInvocation ? requestedInvocation.command_id === application.commandId : invocations.some((item) => item.command_id === application.commandId)))
      setConnectors(discoveredConnectors)
      setLoadedState(hydrated)
      setLoadedRequestKey(requestKey)
      if(explicitArtifact&&!requested)setError('The requested artifact version is missing, changed, or no longer authorized.')
      setLoading(false)
    }).catch((reason) => { if (active) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false) } })
    return () => { active = false; generation.current++; invocationSequence.current++; invocationLock.current = false }
  }, [application.commandId, artifactDigest, artifactId, client, invocationId, projectId, runId])

  const identityMatches = Boolean(beginReviewWorkspaceTransition({ projectId, runId }, loadedState))&&loadedRequestKey===`${artifactId}:${artifactDigest}`
  const visibleDescriptor = identityMatches ? descriptor : undefined
  const visibleArtifacts = identityMatches ? artifacts : []
  const visibleResult = identityMatches ? result : undefined
  const visibleEnvironment = identityMatches ? environment : undefined
  const visibleConnectors = identityMatches ? connectors : []
  const resource = visibleArtifacts.find((item) => item.artifact_id === selectedId)
  const selectedConnector = visibleConnectors.find((item) => item.connector === selectedConnectorAction?.connector)
  const selectedAction = selectedConnector?.actions.find((item) => item.action === selectedConnectorAction?.action)
  const connectorReady = Boolean(selectedAction && selectedAction.input.required.every((field) => connectorArguments[field] !== undefined && connectorArguments[field] !== ''))
  const proposed = useMemo<EnvironmentRevision['definition'] | undefined>(() => {
    if (!visibleEnvironment || !visibleDescriptor) return undefined
    return buildReviewEnvironmentDefinition(visibleEnvironment, visibleDescriptor)
  }, [visibleDescriptor, visibleEnvironment])

  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

  const invokeSelected = useCallback(async () => {
    if (invocationLock.current || busy || loading) return
    if (!client || !resource || !visibleDescriptor) {
      setError('Select an authorized artifact and available review command before dispatching.')
      return
    }
    if (!visibleDescriptor.available.available) {
      setError(visibleDescriptor.available.reason ?? 'The selected review command is unavailable.')
      return
    }
    invocationLock.current = true
    const sequence = ++invocationSequence.current
    const currentGeneration = generation.current
    const selectedDescriptor = visibleDescriptor
    const selectedResource = resource
    // The existing result is protected by the same current authorization as
    // this fresh invocation. Hide it before the authority check crosses the
    // network so a revoked caller never keeps stale bytes on screen.
    setResult(undefined)
    setStaleResult(false)
    setBusy(true)
    setError('')
    try {
      const next = await client.invoke(selectedDescriptor, selectedResource)
      if (sequence !== invocationSequence.current || currentGeneration !== generation.current) return
      const exactResource = next.resource.project_id === selectedResource.project_id && next.resource.run_id === selectedResource.run_id && next.resource.artifact_id === selectedResource.artifact_id && next.resource.digest === selectedResource.digest
      if (next.command_id !== selectedDescriptor.command_id || next.version !== selectedDescriptor.version || next.descriptor_digest !== selectedDescriptor.descriptor_digest || !exactResource) throw new Error('Command result identity mismatch')
      setResult(next)
    } catch (reason) {
      if (sequence === invocationSequence.current && currentGeneration === generation.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (sequence === invocationSequence.current) {
        invocationLock.current = false
        if (currentGeneration === generation.current) setBusy(false)
      }
    }
  }, [busy, client, loading, resource, visibleDescriptor])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const dispatch = () => void invokeSelected()
    window.addEventListener('opensaddle:invoke-artifact-review', dispatch)
    return () => window.removeEventListener('opensaddle:invoke-artifact-review', dispatch)
  }, [invokeSelected])

  const invalidatePendingInvocation = () => {
    invocationSequence.current++
    invocationLock.current = false
    setBusy(false)
  }

  if (!client) return <main className="content-page"><EmptyState title="Review workspace unavailable" description="The connected control plane does not expose shared commands." /></main>
  if (!runId || !projectId) return <main className="content-page"><EmptyState title="Choose a completed outcome" description="Open an outcome from Command Center so its exact Project and Run can resolve authoritative artifacts." /></main>

  return <main className="content-page cc-page">
    <header className="cc-header"><div><span className="eyebrow">Public application boundary</span><h1>Review workspace</h1><p>Inspect one typed resource through the same command available to people and agents.</p></div></header>
    <div className="review-perspective-switch" role="tablist" aria-label="Artifact perspectives">
      <button type="button" role="tab" aria-selected={perspective === 'review'} onClick={() => setPerspective('review')}>Review perspective</button>
      <button type="button" role="tab" aria-selected={perspective === 'evidence'} onClick={() => setPerspective('evidence')}>Evidence perspective</button>
    </div>
    <section className="cc-unavailable" aria-label="Application provenance"><div><h2>Application</h2><code>{application.applicationId}</code></div><p>{visibleDescriptor?.package_ref ? <>Package <code>{visibleDescriptor.package_ref.package_id}@{visibleDescriptor.package_ref.version}</code> · manifest <code>{visibleDescriptor.package_ref.manifest_digest}</code>{visibleDescriptor.handler_id && <> · handler <code>{visibleDescriptor.handler_id}@{visibleDescriptor.handler_version}</code></>}</> : application.packageProvenance ? <>Package <code>{application.packageProvenance.packageId}@{application.packageProvenance.version}</code> · manifest <code>{application.packageProvenance.manifestDigest}</code></> : 'Package provenance is unavailable from the current command descriptor.'}</p></section>
    {(loading || !identityMatches) && <p role="status">Loading the exact Project, Run, artifacts, and command authority…</p>}
    {error && <section role="alert" className="cc-unavailable"><div><h2>{reviewCommandFailureTitle(error)}</h2></div><p>{error}</p>{/stale_command_descriptor/.test(error) && <p>Refresh this workspace to load the current command descriptor. The command was not retried.</p>}</section>}
    <div className="cc-grid">
      <section className="cc-panel"><span className="eyebrow">Resource inspector</span><h2>Exact artifact</h2><p>Project <code>{projectId}</code><br />Run <code>{runId}</code></p><label className="os-field"><span className="os-field__label">Artifact</span><select disabled={!identityMatches || loading} value={identityMatches ? selectedId : ''} onChange={(event) => { invalidatePendingInvocation(); setSelectedId(event.target.value); setResult((current) => current?.resource.artifact_id === event.target.value ? current : undefined) }}>{visibleArtifacts.map((item) => <option key={item.artifact_id} value={item.artifact_id}>{item.artifact_id} · {item.digest.slice(0, 12)}</option>)}</select></label>{resource && <dl><dt>Digest</dt><dd><code>{resource.digest}</code></dd></dl>}{identityMatches && !visibleArtifacts.length && <p role="status">No artifacts were returned for this Run.</p>}</section>
      <section className="cc-panel"><span className="eyebrow">Command inspector</span>{descriptors.length > 1 && <label className="os-field"><span className="os-field__label">Command</span><select aria-label="Review command" value={visibleDescriptor?.command_id ?? ''} onChange={(event) => { invalidatePendingInvocation(); setDescriptor(descriptors.find((item) => item.command_id === event.target.value)); setResult(undefined) }}>{descriptors.map((item) => <option key={item.command_id} value={item.command_id}>{item.title}</option>)}</select></label>}<h2>{visibleDescriptor?.title ?? 'Artifact review'}</h2>{visibleDescriptor ? <><p>{visibleDescriptor.description}</p><dl><dt>Command</dt><dd><code>{visibleDescriptor.command_id}@{visibleDescriptor.version}</code></dd><dt>Descriptor</dt><dd><code>{visibleDescriptor.descriptor_digest}</code></dd><dt>Effect</dt><dd>{visibleDescriptor.effect}</dd><dt>Authority</dt><dd>{visibleDescriptor.required_actions.join(', ')}</dd></dl>{!visibleDescriptor.available.available && <p role="status">{reviewCommandUnavailableMessage(visibleDescriptor)}</p>}<Button disabled={busy || loading || !resource || !visibleDescriptor.available.available} onClick={() => void invokeSelected()}>{visibleDescriptor.package_ref ? 'Run command' : 'Review artifact'}</Button></> : <p role="status">{loading ? 'Loading command authority…' : reviewCommandUnavailableMessage(undefined)}</p>}</section>
    </div>
    {resource&&visibleDescriptor&&<section className="cc-panel"><span className="eyebrow">Open with</span><h2>Continue in another application</h2><p>The destination will reauthorize this exact resource and command descriptor. Opening it does not rerun the command.</p><a className="cc-text-link" href={applicationRouteHref('artifact-evidence', new URLSearchParams({project:resource.project_id,run:resource.run_id,artifact:resource.artifact_id,digest:resource.digest,command:visibleDescriptor.command_id,version:String(visibleDescriptor.version),descriptor:visibleDescriptor.descriptor_digest,origin:application.applicationId,...(visibleResult?{invocation:visibleResult.invocation_id}:{})}))}>Open with Artifact evidence notebook</a></section>}
    {visibleResult && <section className="cc-panel" aria-labelledby="review-result"><span className="eyebrow">Result surface</span><h2 id="review-result">{visibleResult.result.summary ?? 'Review completed'}</h2><p><strong>{visibleResult.result.verified ? 'Verified' : 'Not verified'}</strong> · invocation <code>{visibleResult.invocation_id}</code></p><p>Receipt <code>{visibleResult.receipt.resource_digest}</code></p></section>}
    {perspective === 'evidence' && resource && <section className="cc-panel" aria-labelledby="evidence-perspective-title"><span className="eyebrow">Evidence perspective</span><h2 id="evidence-perspective-title">Exact resource lineage</h2><dl><dt>Artifact</dt><dd><code>{resource.artifact_id}</code></dd><dt>Digest</dt><dd><code>{resource.digest}</code></dd><dt>Project / Run</dt><dd><code>{resource.project_id}</code> / <code>{resource.run_id}</code></dd>{visibleResult && <><dt>Durable invocation</dt><dd><code>{visibleResult.invocation_id}</code></dd><dt>Verification</dt><dd>{visibleResult.result.verified ? 'Verified by the command result' : 'Not verified'}</dd></>}</dl></section>}
    {identityMatches && staleResult && <section className="cc-unavailable" role="status"><div><h2>Prior review is stale</h2></div><p>A durable review exists, but it does not match this artifact version, digest, and command descriptor.</p></section>}
    {identityMatches && !visibleResult && <section className="cc-unavailable" role="status"><div><h2>No prior review</h2></div><p>No durable invocation exists for this exact artifact and command descriptor. Closing this panel never cancels the underlying Run.</p></section>}
    {identityMatches && <section className="cc-panel" aria-labelledby="connected-resources"><span className="eyebrow">Run-scoped capabilities</span><h2 id="connected-resources">Connected resources</h2><p>Run grant <code>{runId}</code></p>{visibleConnectors.length ? <div className="cc-stack">{visibleConnectors.map((connector) => <article className="cc-project" key={`${connector.connector}:${connector.protocol_version}`}><div className="cc-row-top"><strong><code>{connector.connector}</code></strong><span className={`cc-status cc-status--${connector.status.state}`}>{connector.status.state}</span></div><p><code>{connector.protocol_version}</code></p>{connector.status.reason && <p role="status">{connector.status.reason}</p>}{connector.status.state === 'available' && connector.actions.map((action) => <div key={action.action}><Button variant="secondary" onClick={() => { setSelectedConnectorAction({ connector: connector.connector, action: action.action }); setConnectorArguments({}); setConnectorResult(undefined) }}>{action.title}</Button><p>{action.description}</p><dl><dt>Action</dt><dd><code>{action.action}</code></dd><dt>Effect</dt><dd>{action.effect}</dd><dt>Required input</dt><dd>{action.input.required.length ? action.input.required.join(', ') : 'None'}</dd></dl></div>)}</article>)}</div> : <p role="status">No connected-resource capability was granted for this Run.</p>}
      {selectedConnector && selectedAction && <form onSubmit={(event) => { event.preventDefault(); if (!connectorReady) return; void perform(async () => setConnectorResult(await client.invokeConnector(runId, selectedConnector.connector, selectedAction.action, connectorArguments))) }}><h3>{selectedAction.title}</h3><p>Exact grant: <code>{selectedConnector.connector}/{selectedAction.action}</code> · {selectedAction.effect}</p>{Object.entries(selectedAction.input.properties ?? {}).map(([field, rawSchema]) => { const schema = rawSchema as { type?: string; min_length?: number; max_length?: number; pattern?: string; enum?: string[]; minimum?: number; maximum?: number }; return <label className="os-field" key={field}><span className="os-field__label">{field}{selectedAction.input.required.includes(field) ? ' (required)' : ''}</span>{schema.enum ? <select required={selectedAction.input.required.includes(field)} value={String(connectorArguments[field] ?? '')} onChange={(event) => setConnectorArguments((current) => ({ ...current, [field]: event.target.value }))}><option value="">Select</option>{schema.enum.map((value) => <option key={value} value={value}>{value}</option>)}</select> : <input required={selectedAction.input.required.includes(field)} type={schema.type === 'integer' ? 'number' : 'text'} min={schema.minimum} max={schema.maximum} minLength={schema.min_length} maxLength={schema.max_length} pattern={schema.pattern} value={String(connectorArguments[field] ?? '')} onChange={(event) => setConnectorArguments((current) => ({ ...current, [field]: schema.type === 'integer' && event.target.value ? Number(event.target.value) : event.target.value }))} />}</label> })}<Button type="submit" disabled={busy || !connectorReady}>Run read</Button></form>}
      {connectorResult && <div role="status"><h3>Read result</h3><pre>{JSON.stringify(connectorResult.result, null, 2)}</pre><h3>Broker receipt</h3><p><code>{connectorResult.receipt.connector}/{connectorResult.receipt.action}</code></p><p>Request <code>{connectorResult.receipt.request_digest}</code><br />Response <code>{connectorResult.receipt.response_digest}</code><br />Credential lease <code>{connectorResult.receipt.credential_lease_id}</code></p><p><strong>Not artifact verification.</strong> This receipt proves broker dispatch and response binding only.</p></div>}
    </section>}
    {visibleEnvironment && proposed && <section className="cc-panel"><span className="eyebrow">Environment inspector</span><h2>Review workspace configuration</h2><p>Current revision {visibleEnvironment.revision}. The proposed change binds the exact command, <kbd>mod+shift+r</kbd>, and a dormant reviewer definition. It does not start a service.</p><div className="page-actions"><Button variant="secondary" disabled={busy || loading} onClick={() => void perform(async () => setPreview(await client.preview(projectId, visibleEnvironment.revision, proposed, 'Preview review workspace', visibleEnvironment.definition_digest)))}>Preview change</Button><Button disabled={busy || loading || !preview?.activatable} onClick={() => void perform(async () => { setEnvironment(await client.apply(projectId, visibleEnvironment.revision, proposed, 'Install review workspace', visibleEnvironment.definition_digest)); setPreview(undefined) })}>Apply preview</Button>{visibleEnvironment.parent_revision !== null && <Button variant="secondary" disabled={busy || loading} onClick={() => void perform(async () => setEnvironment(await client.revert(projectId, visibleEnvironment.revision, visibleEnvironment.parent_revision!, 'Restore previous environment')))}>Revert</Button>}</div>{preview && <div role="status"><p>Proposed digest <code>{preview.proposed_definition_digest}</code></p><p>Service health: {preview.observed_service_health.available ? 'available' : preview.observed_service_health.reason}</p></div>}</section>}
  </main>
}

if (!getSurface('artifact-review')) registerSurface({ id: 'artifact-review', inputs: ['client', 'runId', 'projectId', 'invocationId', 'artifactId', 'artifactDigest'], Component: ReviewWorkspaceSurface })
