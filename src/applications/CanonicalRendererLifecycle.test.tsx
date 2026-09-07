import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { ApplicationRendererCandidate, ApplicationRendererDescriptor, EnvironmentRevision, MalleableShellClient } from '../services/contracts'
import { CanonicalRendererLifecycle } from './CanonicalRendererLifecycle'

void React
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const digest = (value: string) => value.repeat(64).slice(0, 64)
const candidate = (version: string, revision = 1): ApplicationRendererCandidate => ({ application_id: 'review-evidence', title: 'Evidence view', package_id: 'pkg', package_version: version, manifest_digest: digest(version), content_digest: digest(version === '1' ? 'a' : 'b'), size_bytes: 10, state_schema_version: 1, state_compatibility: { accepts_from_versions: [1] }, available: { available: true, reason: null }, enablement: { status: 'enabled', version: '1', revision }, activation: { desired: version === '1', observed_health: 'unavailable', receipt: null }, environment_application: { application_id: 'review-evidence', version: Number(version), definition_digest: digest(version === '1' ? 'c' : 'd'), source_ref: { authority: 'core', resource_type: 'application-renderer', resource_id: `pkg/${version}`, version, digest: `sha256:${digest(version === '1' ? 'a' : 'b')}` }, package_ref: { package_id: 'pkg', version, manifest_digest: digest(version) }, instances: [{ instance_id: 'review-main', defaults: { density: 'comfortable', presentation: 'document', order: 1 } }] } })
const renderer = (version: string): ApplicationRendererDescriptor => ({ application_id: 'review-evidence', instance_id: 'review-main', entry_file: 'view.html', content_digest: digest(version === '1' ? 'a' : 'b'), size: 10, media_type: 'text/html; profile=opensaddle-renderer-fragment.v1; charset=utf-8', package_ref: { package_id: 'pkg', version, manifest_digest: digest(version) }, input_schema: {}, output_schema: {}, state_schema_version: 1, sandbox_policy: { scripts: true, same_origin: false, network_isolation: 'unavailable', navigation_containment: 'host_observed_only' }, authority: 'core', execution_trust: 'trusted_signed_publisher' })
const environment = (revision: number, version: string): EnvironmentRevision => ({ schema_version: 'opensaddle.environment.v1', project_id: 'P', revision, definition: { commands: [], bindings: [], services: [], packages: [candidate(version).environment_application.package_ref!], applications: [candidate(version).environment_application] }, definition_digest: digest(String(revision)), changed_by: 'owner', reason: null, parent_revision: revision ? revision - 1 : null, created_at: null })
const resource = { project_id: 'P', run_id: 'R', artifact_id: 'A', digest: digest('f') }
const projection = { resource, text: 'report', verified_bytes: true as const, fact_verification: 'not_verified' as const }
const findButton = (view: ReactTestRenderer, label: string) => view.root.findAllByType('button').find(node => node.children.join('').includes(label))!

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
