import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { ApplicationRendererCandidate, ApplicationRendererDescriptor, EnvironmentRevision, MalleableShellClient } from '../services/contracts'
import { CanonicalRendererLifecycle } from './CanonicalRendererLifecycle'

void React
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Object.assign(globalThis, { addEventListener: () => {}, removeEventListener: () => {}, ResizeObserver: class { observe() {} disconnect() {} } })
const digest = (value: string) => value.repeat(64).slice(0, 64)
const stateSchema = { type: 'object' as const, additionalProperties: false as const, maxProperties: 1, properties: { query: { type: 'string' as const, maxLength: 200 } } }
const candidate = (version: string, revision = 1): ApplicationRendererCandidate => ({ application_id: 'review-evidence', title: 'Evidence view', package_id: 'pkg', package_version: version, manifest_digest: digest(version), content_digest: digest(version === '1' ? 'a' : 'b'), size_bytes: 10, state_schema_version: 1, state_max_bytes: 8192, state_schema: stateSchema, state_migrations: [], state_compatibility: { accepts_from_versions: [1] }, available: { available: true, reason: null }, enablement: { status: 'enabled', version: '1', revision }, activation: { desired: version === '1', observed_health: 'unavailable', receipt: null }, environment_application: { application_id: 'review-evidence', version: Number(version), definition_digest: digest(version === '1' ? 'c' : 'd'), source_ref: { authority: 'core', resource_type: 'application-renderer', resource_id: `pkg/${version}`, version, digest: `sha256:${digest(version === '1' ? 'a' : 'b')}` }, package_ref: { package_id: 'pkg', version, manifest_digest: digest(version) }, instances: [{ instance_id: 'review-main', defaults: { density: 'comfortable', presentation: 'document', order: 1 } }] } })
const renderer = (version: string): ApplicationRendererDescriptor => ({ application_id: 'review-evidence', instance_id: 'review-main', entry_file: 'view.html', content_digest: digest(version === '1' ? 'a' : 'b'), size: 10, media_type: 'text/html; profile=opensaddle-renderer-fragment.v1; charset=utf-8', package_ref: { package_id: 'pkg', version, manifest_digest: digest(version) }, input_schema: {}, output_schema: {}, state_schema_version: 1, state_max_bytes: 8192, state_schema: stateSchema, state_migrations: [], sandbox_policy: { scripts: true, same_origin: false, network_isolation: 'unavailable', navigation_containment: 'host_observed_only' }, authority: 'core', execution_trust: 'trusted_signed_publisher' })
const environment = (revision: number, version: string): EnvironmentRevision => ({ schema_version: 'opensaddle.environment.v1', project_id: 'P', revision, definition: { commands: [], bindings: [], services: [], packages: [candidate(version).environment_application.package_ref!], applications: [candidate(version).environment_application] }, definition_digest: digest(String(revision)), changed_by: 'owner', reason: null, parent_revision: revision ? revision - 1 : null, created_at: null })
const resource = { project_id: 'P', run_id: 'R', artifact_id: 'A', digest: digest('f') }
const projection = { resource, text: 'report', verified_bytes: true as const, fact_verification: 'not_verified' as const }
const findButton = (view: ReactTestRenderer, label: string) => view.root.findAllByType('button').find(node => node.children.join('').includes(label))!
const until = async (check: () => boolean) => { for (let index = 0; index < 30 && !check(); index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 2)) }); assert.ok(check()) }

test('replacement uses exact enablement then Environment preview/apply and offers rollback after host failure', async () => {
  const oldWindow = globalThis.window
  Object.assign(globalThis, { window: {} })
  let version = '1', env = environment(1, '1'), enableRevision = 1
  const calls: string[] = []
  const client = {
    applicationRenderers: async () => [renderer(version)],
    applicationRendererCandidates: async () => [candidate('1', enableRevision), candidate('2', enableRevision)],
    enableApplicationRendererCandidate: async (_project: string, next: ApplicationRendererCandidate) => { calls.push(`enable:${next.package_version}:${next.enablement?.revision}`); version = next.package_version; enableRevision++; return {} },
    environment: async () => env,
    preview: async (_project: string, revision: number) => { calls.push(`preview:${revision}`); return { activatable: true, requirements: [] } },
    apply: async (_project: string, revision: number, definition: EnvironmentRevision['definition']) => { calls.push(`apply:${revision}`); env = { ...environment(revision + 1, version), definition }; return env },
    revert: async (_project: string, revision: number, target: number) => { calls.push(`revert:${revision}:${target}`); env = environment(revision + 1, '1'); version = '1'; return env },
  } as unknown as MalleableShellClient
  let view!: ReactTestRenderer
  await act(async () => { view = create(<CanonicalRendererLifecycle client={client} resource={resource} projection={projection} connectionKey="owner" />); await new Promise(resolve => setImmediate(resolve)) })
  await act(async () => { findButton(view, 'Replace with').props.onClick(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) })
  assert.deepEqual(calls.slice(0, 3), ['enable:2:1', 'preview:1', 'apply:1'])
  assert.match(JSON.stringify(view.toJSON()), /replacement did not become ready/i)
  await act(async () => { findButton(view, 'Restore previous').props.onClick(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) })
  assert.deepEqual(calls.slice(3), ['enable:1:2', 'preview:2', 'apply:2'])
  assert.match(JSON.stringify(view.toJSON()), /Selected version.*1/s)
  await act(async () => view.unmount())
  globalThis.window = oldWindow
})

test('replacement refuses an incompatible state contract before enablement and leaves the current application active', async () => {
  const oldWindow = globalThis.window
  Object.assign(globalThis, { window: {} })
  const incompatible = {
    ...candidate('2'),
    state_schema_version: 2,
    state_schema: { ...stateSchema, properties: { search: { type: 'string' as const, maxLength: 200 } } },
    state_migrations: [],
  }
  let enables = 0
  const client = {
    applicationRenderers: async () => [renderer('1')],
    applicationRendererCandidates: async () => [candidate('1'), incompatible],
    enableApplicationRendererCandidate: async () => { enables++ },
    environment: async () => environment(1, '1'),
  } as unknown as MalleableShellClient
  let view!: ReactTestRenderer
  await act(async () => { view = create(<CanonicalRendererLifecycle client={client} resource={resource} projection={projection} connectionKey="owner" />); await new Promise(resolve => setImmediate(resolve)) })
  await act(async () => { findButton(view, 'Replace with').props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
  assert.equal(enables, 0)
  assert.match(JSON.stringify(view.toJSON()), /Replacement refused.*current application and its saved state remain active/i)
  assert.match(JSON.stringify(view.toJSON()), /Selected version.*1/s)
  await act(async () => view.unmount())
  globalThis.window = oldWindow
})

test('mounted replacement validates and freezes the actual saved state before enablement', async () => {
  const oldWindow = globalThis.window
  const fragment = '<p>state renderer</p>'
  const contentDigest = createHash('sha256').update(fragment).digest('hex')
  const current = { ...renderer('1'), content_digest: contentDigest, size: fragment.length }
  const next = {
    ...candidate('2'),
    content_digest: contentDigest,
    state_schema_version: 2,
    state_schema: { type: 'object' as const, additionalProperties: false as const, maxProperties: 1, properties: { search: { type: 'string' as const, maxLength: 1 } } },
    state_migrations: [{ from_version: 1, to_version: 2, operations: [{ op: 'rename' as const, from: 'query', to: 'search' }] }],
  }
  const listeners: Array<(event: any) => void> = []
  const requests: any[] = []
  let enables = 0
  Object.assign(globalThis, { window: { opensaddleDesktop: true, opensaddle: {
    onApplicationRendererEvent: (listener: (event: any) => void) => { listeners.push(listener); return () => {} },
    openApplicationRenderer: async (request: any) => { requests.push(request); return { identity: [request.connectionKey, request.instanceId, request.generation, request.packageRef.package_id, request.packageRef.version, request.packageRef.manifest_digest, request.contentDigest, request.projection.resource.project_id, request.projection.resource.run_id, request.projection.resource.artifact_id, request.projection.resource.digest].join('\0'), rendererPid: 2 } },
    closeApplicationRenderer: async () => true,
    setApplicationRendererBounds: async () => true,
  } } })
  const client = {
    applicationRenderers: async () => [current],
    applicationRendererCandidates: async () => [candidate('1'), next],
    applicationRendererContent: async () => new Response(fragment, { headers: { 'Content-Type': current.media_type, 'Content-Length': String(fragment.length) } }),
    enableApplicationRendererCandidate: async () => { enables++ },
    environment: async () => environment(1, '1'),
  } as unknown as MalleableShellClient
  let view!: ReactTestRenderer
  await act(async () => { view = create(<CanonicalRendererLifecycle client={client} resource={resource} projection={projection} connectionKey="owner" />, { createNodeMock: () => ({ getBoundingClientRect: () => ({ x: 0, y: 0, width: 500, height: 320 }) }) }) })
  await until(() => requests.length === 1 && listeners.length === 1)
  const request = requests[0]
  const identity = [request.connectionKey, request.instanceId, request.generation, request.packageRef.package_id, request.packageRef.version, request.packageRef.manifest_digest, request.contentDigest, request.projection.resource.project_id, request.projection.resource.run_id, request.projection.resource.artifact_id, request.projection.resource.digest].join('\0')
  await act(async () => listeners[0]({ identity, instanceId: request.instanceId, generation: request.generation, kind: 'state', state: { query: 'long saved query' } }))
  await act(async () => { findButton(view, 'Replace with').props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
  assert.equal(enables, 0)
  assert.match(JSON.stringify(view.toJSON()), /current saved state cannot be migrated.*current application and its saved state remain active/i)
  await act(async () => view.unmount())
  globalThis.window = oldWindow
})

test('desktop lifecycle reports loading, ready, and error with the exact native generation', async () => {
  const oldWindow = globalThis.window
  const originalSetTimeout = globalThis.setTimeout
  const heartbeats: Array<() => void> = []
  globalThis.setTimeout = ((handler: TimerHandler, delay?: number, ...args: any[]) => {
    if (delay === 10_000) { heartbeats.push(() => typeof handler === 'function' && handler(...args)); return 999_999 as any }
    return originalSetTimeout(handler, delay, ...args)
  }) as typeof setTimeout
  const fragment = '<p>health renderer</p>'
  const contentDigest = createHash('sha256').update(fragment).digest('hex')
  const current = { ...renderer('1'), content_digest: contentDigest, size: fragment.length }
  const listeners: Array<(event: any) => void> = []
  const requests: any[] = []
  const reports: Array<{ sequence: number; state: string; error_code?: string }> = []
  let releaseReady!: () => void
  const readyAck = new Promise<void>(resolve => { releaseReady = resolve })
  Object.assign(globalThis, { window: { opensaddleDesktop: true, opensaddle: {
    onApplicationRendererEvent: (listener: (event: any) => void) => { listeners.push(listener); return () => {} },
    openApplicationRenderer: async (request: any) => { requests.push(request); return { identity: [request.connectionKey, request.instanceId, request.generation, request.packageRef.package_id, request.packageRef.version, request.packageRef.manifest_digest, request.contentDigest, request.projection.resource.project_id, request.projection.resource.run_id, request.projection.resource.artifact_id, request.projection.resource.digest].join('\0'), rendererPid: 2 } },
    closeApplicationRenderer: async () => true,
    setApplicationRendererBounds: async () => true,
  } } })
  const client = {
    applicationRenderers: async () => [current],
    applicationRendererCandidates: async () => [candidate('1')],
    applicationRendererContent: async () => new Response(fragment, { headers: { 'Content-Type': current.media_type, 'Content-Length': String(fragment.length) } }),
    environment: async () => environment(1, '1'),
    createRendererHostSession: async () => ({ session_id: 'rhs_1', report_token: 'opaque', expires_at: 'later', next_sequence: 4, host_identity_authority: 'client_asserted' as const }),
    reportRendererHostObservation: async (_session: string, _token: string, input: { sequence: number; state: 'loading' | 'ready' | 'error'; error_code?: string }) => { reports.push(input); if (input.state === 'ready') await readyAck; return {} },
  } as unknown as MalleableShellClient
  let view!: ReactTestRenderer
  await act(async () => { view = create(<CanonicalRendererLifecycle client={client} resource={resource} projection={projection} connectionKey="owner" />, { createNodeMock: () => ({ getBoundingClientRect: () => ({ x: 0, y: 0, width: 500, height: 320 }) }) }) })
  await until(() => requests.length === 1 && reports.some(value => value.state === 'loading'))
  const request = requests[0]
  const identity = [request.connectionKey, request.instanceId, request.generation, request.packageRef.package_id, request.packageRef.version, request.packageRef.manifest_digest, request.contentDigest, request.projection.resource.project_id, request.projection.resource.run_id, request.projection.resource.artifact_id, request.projection.resource.digest].join('\0')
  await act(async () => listeners[0]({ identity, instanceId: request.instanceId, generation: request.generation, kind: 'ready' }))
  await until(() => reports.some(value => value.state === 'ready'))
  await act(async () => listeners[0]({ identity, instanceId: request.instanceId, generation: request.generation, kind: 'error', error: 'renderer_crashed' }))
  releaseReady()
  await until(() => reports.some(value => value.state === 'error'))
  assert.deepEqual(reports.slice(0, 3), [
    { sequence: 4, state: 'loading' },
    { sequence: 5, state: 'ready' },
    { sequence: 6, state: 'error', error_code: 'renderer_unavailable' },
  ])
  for (const heartbeat of heartbeats) heartbeat()
  await act(async () => { await Promise.resolve() })
  assert.equal(reports.length, 3)
  assert.match(JSON.stringify(view.toJSON()), /client-asserted desktop observation is not semantic verification/i)
  await act(async () => view.unmount())
  globalThis.setTimeout = originalSetTimeout
  globalThis.window = oldWindow
})

// INV-RENDERER-HEALTH-FENCE: response ambiguity cannot preserve ready after the native process has failed.
test('a native crash after a committed ready response loss reconciles the terminal sequence', async () => {
  const oldWindow = globalThis.window
  const fragment = '<p>health renderer</p>'
  const contentDigest = createHash('sha256').update(fragment).digest('hex')
  const current = { ...renderer('1'), content_digest: contentDigest, size: fragment.length }
  const listeners: Array<(event: any) => void> = []
  const requests: any[] = []
  let sessions = 0
  const reports: Array<{ session: string; sequence: number; state: string }> = []
  Object.assign(globalThis, { window: { opensaddleDesktop: true, opensaddle: {
    onApplicationRendererEvent: (listener: (event: any) => void) => { listeners.push(listener); return () => {} },
    openApplicationRenderer: async (request: any) => { requests.push(request); return { identity: [request.connectionKey, request.instanceId, request.generation, request.packageRef.package_id, request.packageRef.version, request.packageRef.manifest_digest, request.contentDigest, request.projection.resource.project_id, request.projection.resource.run_id, request.projection.resource.artifact_id, request.projection.resource.digest].join('\0'), rendererPid: 2 } },
    closeApplicationRenderer: async () => true,
    setApplicationRendererBounds: async () => true,
  } } })
  const client = {
    applicationRenderers: async () => [current], applicationRendererCandidates: async () => [candidate('1')],
    applicationRendererContent: async () => new Response(fragment, { headers: { 'Content-Type': current.media_type, 'Content-Length': String(fragment.length) } }), environment: async () => environment(1, '1'),
    createRendererHostSession: async () => { sessions++; return { session_id: 'old', report_token: 'old-token', expires_at: 'later', next_sequence: 7, host_identity_authority: 'client_asserted' as const } },
    reportRendererHostObservation: async (session: string, _token: string, input: { sequence: number; state: 'loading' | 'ready' | 'error' }) => { reports.push({ session, ...input }); if (session === 'old' && input.sequence === 8) throw Error('temporary offline after commit'); return {} },
    rendererHostObservations: async () => ({ schema_version: 'opensaddle.renderer-host-observations.v1' as const, project_id: 'P', generated_at: 'now', authority: 'host_reported' as const, semantic_correctness: 'not_verified' as const, items: [{ session_id: 'old', project_id: 'P', subject: 'owner', host_id: 'desktop', application_id: 'review-evidence', instance_id: 'review-main', package_ref: current.package_ref, environment_revision: 1, environment_definition_digest: environment(1, '1').definition_digest, generation: 1, state: 'ready' as const, error_code: null, sequence: 8, updated_at: 'now', expires_at: 'later' }] }),
  } as unknown as MalleableShellClient
  let view!: ReactTestRenderer
  await act(async () => { view = create(<CanonicalRendererLifecycle client={client} resource={resource} projection={projection} connectionKey="owner" />, { createNodeMock: () => ({ getBoundingClientRect: () => ({ x: 0, y: 0, width: 500, height: 320 }) }) }) })
  await until(() => requests.length === 1 && reports.length === 1)
  const request = requests[0]
  const identity = [request.connectionKey, request.instanceId, request.generation, request.packageRef.package_id, request.packageRef.version, request.packageRef.manifest_digest, request.contentDigest, request.projection.resource.project_id, request.projection.resource.run_id, request.projection.resource.artifact_id, request.projection.resource.digest].join('\0')
  await act(async () => listeners[0]({ identity, instanceId: request.instanceId, generation: request.generation, kind: 'ready' }))
  await until(() => reports.some(value => value.session === 'old' && value.sequence === 8))
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /Host report: ready/)
  assert.match(JSON.stringify(view.toJSON()), /Host observation unavailable:.*temporary offline after commit/)
  await act(async () => listeners[0]({ identity, instanceId: request.instanceId, generation: request.generation, kind: 'error' }))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_050)) })
  await until(() => reports.some(value => value.session === 'old' && value.sequence === 9 && value.state === 'error'))
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /Host report:.*ready/)
  assert.match(JSON.stringify(view.toJSON()), /Host report:.*error/)
  assert.equal(reports.filter(value => value.session === 'old' && value.sequence === 8).length, 1)
  assert.equal(sessions, 1)
  await act(async () => view.unmount())
  globalThis.window = oldWindow
})

test('an expired observation session restarts the native host with a new generation', async () => {
  const oldWindow = globalThis.window
  const fragment = '<p>health renderer</p>'
  const contentDigest = createHash('sha256').update(fragment).digest('hex')
  const current = { ...renderer('1'), content_digest: contentDigest, size: fragment.length }
  const listeners: Array<(event: any) => void> = []
  const requests: any[] = []
  let sessions = 0
  const reports: Array<{ session: string; sequence: number; state: string }> = []
  Object.assign(globalThis, { window: { opensaddleDesktop: true, opensaddle: {
    onApplicationRendererEvent: (listener: (event: any) => void) => { listeners.push(listener); return () => {} },
    openApplicationRenderer: async (request: any) => { requests.push(request); return { identity: [request.connectionKey, request.instanceId, request.generation, request.packageRef.package_id, request.packageRef.version, request.packageRef.manifest_digest, request.contentDigest, request.projection.resource.project_id, request.projection.resource.run_id, request.projection.resource.artifact_id, request.projection.resource.digest].join('\0'), rendererPid: 2 } },
    closeApplicationRenderer: async () => true,
    setApplicationRendererBounds: async () => true,
  } } })
  const client = {
    applicationRenderers: async () => [current], applicationRendererCandidates: async () => [candidate('1')],
    applicationRendererContent: async () => new Response(fragment, { headers: { 'Content-Type': current.media_type, 'Content-Length': String(fragment.length) } }), environment: async () => environment(1, '1'),
    createRendererHostSession: async () => ({ session_id: `session-${++sessions}`, report_token: `token-${sessions}`, expires_at: 'later', next_sequence: 1, host_identity_authority: 'client_asserted' as const }),
    reportRendererHostObservation: async (session: string, _token: string, input: { sequence: number; state: 'loading' | 'ready' | 'error' }) => { reports.push({ session, ...input }); if (session === 'session-1' && input.state === 'ready') throw Error('session expired'); if (session === 'session-2' && input.state === 'error') throw Error('authority revoked'); return {} },
    rendererHostObservations: async () => ({ schema_version: 'opensaddle.renderer-host-observations.v1' as const, project_id: 'P', generated_at: 'now', authority: 'host_reported' as const, semantic_correctness: 'not_verified' as const, items: [{ session_id: 'session-1', project_id: 'P', subject: 'owner', host_id: 'desktop', application_id: 'review-evidence', instance_id: 'review-main', package_ref: current.package_ref, environment_revision: 1, environment_definition_digest: environment(1, '1').definition_digest, generation: 1, state: 'unknown' as const, error_code: null, sequence: 1, updated_at: 'now', expires_at: 'past', reason: 'session_expired_or_selection_changed' }] }),
  } as unknown as MalleableShellClient
  let view!: ReactTestRenderer
  await act(async () => { view = create(<CanonicalRendererLifecycle client={client} resource={resource} projection={projection} connectionKey="owner" />, { createNodeMock: () => ({ getBoundingClientRect: () => ({ x: 0, y: 0, width: 500, height: 320 }) }) }) })
  await until(() => requests.length === 1 && reports.some(value => value.state === 'loading'))
  const first = requests[0]
  const firstIdentity = [first.connectionKey, first.instanceId, first.generation, first.packageRef.package_id, first.packageRef.version, first.packageRef.manifest_digest, first.contentDigest, first.projection.resource.project_id, first.projection.resource.run_id, first.projection.resource.artifact_id, first.projection.resource.digest].join('\0')
  await act(async () => listeners[0]({ identity: firstIdentity, instanceId: first.instanceId, generation: first.generation, kind: 'state', state: { query: 'expiry-restart-proof' } }))
  await act(async () => listeners[0]({ identity: firstIdentity, instanceId: first.instanceId, generation: first.generation, kind: 'ready' }))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_050)) })
  await until(() => requests.length === 2 && sessions === 2)
  assert.notEqual(requests[1].generation, first.generation)
  assert.deepEqual(requests[1].state, { query: 'expiry-restart-proof' })
  assert.equal(reports.filter(value => value.session === 'session-1' && value.state === 'ready').length, 1)
  assert.ok(reports.some(value => value.session === 'session-2' && value.state === 'loading'))
  const second = requests[1]
  const secondIdentity = [second.connectionKey, second.instanceId, second.generation, second.packageRef.package_id, second.packageRef.version, second.packageRef.manifest_digest, second.contentDigest, second.projection.resource.project_id, second.projection.resource.run_id, second.projection.resource.artifact_id, second.projection.resource.digest].join('\0')
  await act(async () => listeners[1]({ identity: secondIdentity, instanceId: second.instanceId, generation: second.generation, kind: 'ready' }))
  await until(() => reports.some(value => value.session === 'session-2' && value.state === 'ready'))
  await act(async () => listeners[1]({ identity: secondIdentity, instanceId: second.instanceId, generation: second.generation, kind: 'error' }))
  await until(() => reports.some(value => value.session === 'session-2' && value.state === 'error'))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.equal(sessions, 2)
  assert.match(JSON.stringify(view.toJSON()), /Host observation unavailable:.*authority revoked/)
  await act(async () => view.unmount())
  globalThis.window = oldWindow
})
