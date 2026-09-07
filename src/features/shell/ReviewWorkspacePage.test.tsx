import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { EnvironmentRevision, ExactArtifactRef, MalleableShellClient, ShellCommandDescriptor, ShellCommandResult } from '../../services/contracts'
import { ReviewWorkspaceSurface } from './ReviewWorkspaceSurface'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
void React

const descriptor = (available = true): ShellCommandDescriptor => ({ command_id: 'dev.opensaddle.artifact.review', version: 2, descriptor_digest: 'descriptor-new', title: 'Review artifacts', description: 'Review exact metadata', effect: 'read', required_actions: ['artifacts:read'], available: { available, reason: available ? undefined : 'artifact registry offline' }, input_schema: {}, output_schema: {} })
const artifact = (id: string, project = 'P1', run = 'R1'): ExactArtifactRef => ({ project_id: project, run_id: run, artifact_id: id, digest: `digest-${id}` })
const invocation = (resource: ExactArtifactRef): ShellCommandResult => ({ invocation_id: `inv-${resource.artifact_id}`, project_id: resource.project_id, command_id: 'dev.opensaddle.artifact.review', version: 2, descriptor_digest: 'descriptor-new', invoked_by: 'user-1', created_at: '2026-09-07T04:00:00Z', resource, input: {}, status: 'completed', result: { summary: `Reviewed ${resource.artifact_id}`, verified: false }, receipt: { effect: 'read', resource_digest: resource.digest, verified: false } })
const environment = (commands: EnvironmentRevision['definition']['commands'] = []): EnvironmentRevision => ({ schema_version: 'opensaddle.environment.v1', project_id: 'P1', revision: 3, definition: { commands, bindings: [], services: [], packages: [] }, definition_digest: 'environment-base', changed_by: null, reason: null, parent_revision: 2, created_at: null })

function client(overrides: Partial<MalleableShellClient> = {}): MalleableShellClient {
  return {
    commands: async () => [descriptor()], artifacts: async () => [artifact('A')], invocations: async () => [], invocation: async () => { throw new Error('unused') },
    connectors: async () => [{ connector: 'github', protocol_version: 'opensaddle.connector.v1', status: { state: 'available', reason: null }, actions: [{ action: 'get_repository', title: 'Get repository', description: 'Read bounded repository metadata.', effect: 'read', input: { required: ['owner', 'repo'], properties: { owner: { type: 'string', min_length: 1, max_length: 100, pattern: '^[A-Za-z0-9_.-]+$' }, repo: { type: 'string', min_length: 1, max_length: 100, pattern: '^[A-Za-z0-9_.-]+$' } } }, result: { type: 'object', additional_properties: true } }] }],
    invokeConnector: async (_run, connector, action, args) => ({ result: { name: `${String(args.owner)}/${String(args.repo)}` }, receipt: { connector, action, request_digest: 'request-digest', response_digest: 'response-digest', credential_lease_id: 'lease-opaque' } }),
    environment: async () => environment(), invoke: async (_id, resource) => invocation(resource),
    preview: async () => ({ schema_version: 'opensaddle.environment-preview.v1', project_id: 'P1', base_revision: 3, base_definition_digest: 'environment-base', proposed_definition_digest: 'proposed', diff: { commands: { added: [], removed: [] }, bindings: { added: [], removed: [] }, services: { added: [], removed: [] } }, requirements: [], activatable: true, observed_service_health: { available: false, reason: 'unavailable' } }),
    apply: async () => environment(), revert: async () => environment(), ...overrides,
  }
}

async function mount(api: MalleableShellClient, projectId = 'P1', runId = 'R1') {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ReviewWorkspaceSurface client={api} projectId={projectId} runId={runId} />) })
  return renderer
}

test('mounted invocation deep link selects the exact durable result over another Run result', async () => {
  const exact = invocation(artifact('A')); exact.invocation_id = 'inv-exact'
  const unrelated = invocation(artifact('B')); unrelated.invocation_id = 'inv-unrelated'
  const api = client({ artifacts: async () => [artifact('A'), artifact('B')], invocations: async () => [unrelated], invocation: async (id) => { assert.equal(id, 'inv-exact'); return exact } })
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ReviewWorkspaceSurface client={api} projectId="P1" runId="R1" invocationId="inv-exact" />) })
  const markup = JSON.stringify(renderer.toJSON()); assert.match(markup, /inv-exact/); assert.doesNotMatch(markup, /inv-unrelated/); assert.equal(renderer.root.findByType('select').props.value, 'A')
})

test('mounted surface selects the exact artifact belonging to the restored durable invocation', async () => {
  const a = artifact('A'); const b = artifact('B')
  const renderer = await mount(client({ artifacts: async () => [a, b], invocations: async () => [invocation(b)] }))
  const select = renderer.root.findByType('select')
  assert.equal(select.props.value, 'B')
  assert.match(JSON.stringify(renderer.toJSON()), /Reviewed B/)
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /inv-A/)
})

test('explicit same-Run artifact handoff fails closed when its digest changes',async()=>{const a=artifact('A');const renderer=await mount(client({artifacts:async()=>[a]}));await act(async()=>{renderer.update(<ReviewWorkspaceSurface client={client({artifacts:async()=>[{...a,digest:'digest-new'}]})} projectId="P1" runId="R1" artifactId="A" artifactDigest="digest-A"/>);await Promise.resolve()});const markup=JSON.stringify(renderer.toJSON());assert.match(markup,/requested artifact version is missing, changed, or no longer authorized/);assert.doesNotMatch(markup,/digest-new|Open with Artifact evidence notebook/);assert.equal(renderer.root.findAllByType('select')[0]?.props.value,'')})

test('same exact artifact and durable result survive switching between two perspectives', async () => {
  const exact = artifact('A')
  const renderer = await mount(client({ artifacts: async () => [exact], invocations: async () => [invocation(exact)] }))
  const evidence = renderer.root.findAllByType('button').find((button) => button.children.join('') === 'Evidence perspective')
  assert.ok(evidence)
  await act(async () => { evidence.props.onClick() })
  const markup = JSON.stringify(renderer.toJSON())
  assert.match(markup, /Evidence perspective.*A.*digest-A.*inv-A/s)
})

test('mounted generic shell discovers and invokes two package commands without command-specific UI', async () => {
  const packageCommand = (id: string, title: string): ShellCommandDescriptor => ({ ...descriptor(), command_id: id, title, package_ref: { package_id: 'example.review-tools', version: '1.0.0', manifest_digest: 'manifest-1' }, contribution_id: id, handler_id: `handler.${id}`, handler_version: 1 })
  const commands = [packageCommand('example.summarize', 'Summarize artifact'), packageCommand('example.classify', 'Classify artifact')]
  const invoked: ShellCommandDescriptor[] = []
  const renderer = await mount(client({ commands: async () => commands, invoke: async (selected, resource) => { invoked.push(selected); return { ...invocation(resource), command_id: selected.command_id, result: { summary: `${selected.command_id} result`, verified: false } } } }))
  const commandSelect = renderer.root.findAllByType('select').find((node) => node.props['aria-label'] === 'Review command')
  assert.ok(commandSelect)
  await act(async () => { commandSelect.props.onChange({ target: { value: 'example.classify' } }) })
  const run = renderer.root.findAllByType('button').find((button) => button.findAllByProps({ className: 'os-button__label' }).some((label) => label.children.join('') === 'Run command'))
  assert.ok(run)
  await act(async () => { run.props.onClick() }); await act(async () => {})
  assert.deepEqual(invoked.map(({ command_id, version, descriptor_digest }) => ({ command_id, version, descriptor_digest })), [{ command_id: 'example.classify', version: 2, descriptor_digest: 'descriptor-new' }])
  const markup = JSON.stringify(renderer.toJSON()); assert.match(markup, /example\.review-tools/); assert.match(markup, /manifest-1/); assert.match(markup, /handler\.example\.classify/)
})

test('palette and keybinding intent dispatches the selected extension command through the canonical client', async () => {
  ;(globalThis as typeof globalThis & { window: EventTarget }).window = new EventTarget()
  const extension = { ...descriptor(), command_id: 'example.review', version: 7, descriptor_digest: 'exact-descriptor', package_ref: { package_id: 'example.review-tools', version: '1.0.0', manifest_digest: 'manifest-1' } }
  const calls: Array<{ command: string; version: number; digest: string; resource: ExactArtifactRef }> = []
  const renderer = await mount(client({ commands: async () => [extension], invoke: async (selected, resource) => { calls.push({ command: selected.command_id, version: selected.version, digest: selected.descriptor_digest, resource }); return { ...invocation(resource), command_id: selected.command_id, version: selected.version, descriptor_digest: selected.descriptor_digest } } }))
  await act(async () => { window.dispatchEvent(new CustomEvent('opensaddle:invoke-artifact-review')) })
  assert.deepEqual(calls, [{ command: 'example.review', version: 7, digest: 'exact-descriptor', resource: artifact('A') }])
  assert.match(JSON.stringify(renderer.toJSON()), /inv-A/)
  await act(async () => renderer.unmount())
  delete (globalThis as typeof globalThis & { window?: EventTarget }).window
})

test('shared dispatch intent fails closed when discovered command authority is denied', async () => {
  ;(globalThis as typeof globalThis & { window: EventTarget }).window = new EventTarget()
  let calls = 0
  const renderer = await mount(client({ commands: async () => [descriptor(false)], invoke: async (_selected, resource) => { calls++; return invocation(resource) } }))
  await act(async () => { window.dispatchEvent(new CustomEvent('opensaddle:invoke-artifact-review')) })
  assert.equal(calls, 0)
  assert.match(JSON.stringify(renderer.toJSON()), /artifact registry offline/)
  await act(async () => renderer.unmount())
  delete (globalThis as typeof globalThis & { window?: EventTarget }).window
})

test('shared dispatch locks same-tick duplicate intent and rejects substituted result identity', async () => {
  ;(globalThis as typeof globalThis & { window: EventTarget }).window = new EventTarget()
  let calls = 0
  const renderer = await mount(client({ invoke: async (_selected, resource) => { calls++; return { ...invocation(resource), resource: artifact('other') } } }))
  await act(async () => {
    window.dispatchEvent(new CustomEvent('opensaddle:invoke-artifact-review'))
    window.dispatchEvent(new CustomEvent('opensaddle:invoke-artifact-review'))
  })
  assert.equal(calls, 1)
  assert.match(JSON.stringify(renderer.toJSON()), /Command result identity mismatch/)
  await act(async () => renderer.unmount())
  delete (globalThis as typeof globalThis & { window?: EventTarget }).window
})

test('pending shared dispatch cannot publish after route and client replacement', async () => {
  ;(globalThis as typeof globalThis & { window: EventTarget }).window = new EventTarget()
  let resolveOld!: (value: ShellCommandResult) => void
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ReviewWorkspaceSurface client={client({ invoke: async () => new Promise(resolve => { resolveOld = resolve }) })} projectId="P1" runId="R1" />) })
  await act(async () => { window.dispatchEvent(new CustomEvent('opensaddle:invoke-artifact-review')) })
  await act(async () => { renderer.update(<ReviewWorkspaceSurface client={client()} projectId="P2" runId="R2" />) })
  await act(async () => { resolveOld(invocation(artifact('A'))); await Promise.resolve() })
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /inv-A|Reviewed A/)
  await act(async () => renderer.unmount())
  delete (globalThis as typeof globalThis & { window?: EventTarget }).window
})

test('changing selected artifact fences a pending shared command result', async () => {
  ;(globalThis as typeof globalThis & { window: EventTarget }).window = new EventTarget()
  let resolveOld!: (value: ShellCommandResult) => void
  const a = artifact('A'); const b = artifact('B')
  const renderer = await mount(client({ artifacts: async () => [a, b], invoke: async () => new Promise(resolve => { resolveOld = resolve }) }))
  await act(async () => { window.dispatchEvent(new CustomEvent('opensaddle:invoke-artifact-review')) })
  const artifactSelect = renderer.root.findAllByType('select').find(node => node.props['aria-label'] !== 'Review command')!
  await act(async () => { artifactSelect.props.onChange({ target: { value: 'B' } }) })
  await act(async () => { resolveOld(invocation(a)); await Promise.resolve() })
  const markup = JSON.stringify(renderer.toJSON())
  assert.match(markup, /digest-B/)
  assert.doesNotMatch(markup, /inv-A|Reviewed A/)
  await act(async () => renderer.unmount())
  delete (globalThis as typeof globalThis & { window?: EventTarget }).window
})

test('mounted perspectives distinguish stale result, revoked access, and unavailable resources', async () => {
  const a = artifact('A')
  const stale = await mount(client({ artifacts: async () => [a], invocations: async () => [invocation(artifact('B'))] }))
  assert.match(JSON.stringify(stale.toJSON()), /Prior review is stale.*does not match this artifact version, digest, and command descriptor/s)

  const revoked = await mount(client({ artifacts: async () => { throw new Error('403 project access revoked') } }))
  assert.match(JSON.stringify(revoked.toJSON()), /Artifact access revoked.*403 project access revoked/s)
  assert.equal(revoked.root.findAllByType('button').some((button) => button.children.join('') === 'Review artifact' && !button.props.disabled), false)

  const unavailable = await mount(client({ artifacts: async () => { throw new Error('404 artifact registry not found') } }))
  assert.match(JSON.stringify(unavailable.toJSON()), /Review resources unavailable.*404 artifact registry not found/s)
})

test('mounted preview submits the exact discovered descriptor in place of a stale ref', async () => {
  let proposed: EnvironmentRevision['definition'] | undefined
  const api = client({ environment: async () => environment([{ command_id: 'dev.opensaddle.artifact.review', version: 1, descriptor_digest: 'descriptor-old' }]), preview: async (_project, _revision, definition) => { proposed = definition; return client().preview('P1', 3, definition, '', '') } })
  const renderer = await mount(api)
  const previewButton = renderer.root.findAllByType('button').find((button) => button.findAllByProps({ className: 'os-button__label' }).some((label) => label.children.join('') === 'Preview change'))!
  await act(async () => { await previewButton.props.onClick() })
  assert.deepEqual(proposed?.commands, [{ command_id: 'dev.opensaddle.artifact.review', version: 2, descriptor_digest: 'descriptor-new' }])
})

test('mounted route transition hides prior identities and actions while new responses are deferred', async () => {
  let resolveArtifacts!: (value: ExactArtifactRef[]) => void
  const api = client({ artifacts: async (run) => run === 'R1' ? [artifact('A')] : new Promise((resolve) => { resolveArtifacts = resolve }), invocations: async (project) => project === 'P1' ? [invocation(artifact('A'))] : [] })
  const renderer = await mount(api)
  assert.match(JSON.stringify(renderer.toJSON()), /inv-A/)
  await act(async () => { renderer.update(<ReviewWorkspaceSurface client={api} projectId="P2" runId="R2" />) })
  const pending = JSON.stringify(renderer.toJSON())
  assert.match(pending, /Loading the exact Project/)
  assert.doesNotMatch(pending, /inv-A|digest-A|Preview change|Revert/)
  await act(async () => { resolveArtifacts([artifact('C', 'P2', 'R2')]) })
  assert.match(JSON.stringify(renderer.toJSON()), /digest-C/)
})

test('mounted command inspector announces the server unavailable reason', async () => {
  const renderer = await mount(client({ commands: async () => [descriptor(false)] }))
  const markup = JSON.stringify(renderer.toJSON())
  assert.match(markup, /artifact registry offline/)
  const review = renderer.root.findAllByType('button').find((button) => button.findAllByProps({ className: 'os-button__label' }).some((label) => label.children.join('') === 'Review artifact'))!
  assert.equal(review.props.disabled, true)
})

test('mounted command invocation reports a stale descriptor without retrying', async () => {
  let attempts = 0
  const renderer = await mount(client({ invoke: async () => { attempts += 1; throw new Error('{"code":"stale_command_descriptor"}') } }))
  const review = renderer.root.findAllByType('button').find((button) => button.findAllByProps({ className: 'os-button__label' }).some((label) => label.children.join('') === 'Review artifact'))!
  await act(async () => { review.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)) })
  const markup = JSON.stringify(renderer.toJSON())
  assert.equal(attempts, 1)
  assert.match(markup, /Command descriptor changed.*stale_command_descriptor.*was not retried/s)
})

test('mounted connected-resource inspector uses server labels and truthful status', async () => {
  const renderer = await mount(client())
  const markup = JSON.stringify(renderer.toJSON())
  assert.match(markup, /Connected resources.*github.*Get repository.*Read bounded repository metadata/s)
  assert.match(markup, /owner.*repo/)
})

test('mounted connected-resource inspector hides actions while the connector is offline', async () => {
  const api = client({ connectors: async () => [{ ...(await client().connectors('R1'))[0]!, status: { state: 'offline', reason: 'executor_offline' } }] })
  const renderer = await mount(api)
  const markup = JSON.stringify(renderer.toJSON())
  assert.match(markup, /offline.*executor_offline/s)
  assert.doesNotMatch(markup, /Get repository|Read bounded repository metadata/)
})

test('mounted read action submits discovered bounded arguments and separates broker receipt from verification', async () => {
  let dispatched: Record<string, unknown> | undefined
  const api = client({ invokeConnector: async (_run, connector, action, args) => { dispatched = { connector, action, args }; return { result: { full_name: 'AkeBoss-tech/opensaddle' }, receipt: { connector, action, request_digest: 'request-digest', response_digest: 'response-digest', credential_lease_id: 'lease-opaque' } } } })
  const renderer = await mount(api)
  const buttons = renderer.root.findAllByType('button')
  const open = buttons.find((button) => button.findAllByProps({ className: 'os-button__label' }).some((label) => label.children.join('') === 'Get repository'))!
  await act(async () => { open.props.onClick() })
  const fields = renderer.root.findAllByType('input')
  await act(async () => { fields[0]!.props.onChange({ target: { value: 'AkeBoss-tech' } }); fields[1]!.props.onChange({ target: { value: 'opensaddle' } }) })
  const form = renderer.root.findByType('form')
  await act(async () => { form.props.onSubmit({ preventDefault() {} }); await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert.deepEqual(dispatched, { connector: 'github', action: 'get_repository', args: { owner: 'AkeBoss-tech', repo: 'opensaddle' } })
  const markup = JSON.stringify(renderer.toJSON())
  assert.match(markup, /AkeBoss-tech\/opensaddle.*Broker receipt.*request-digest.*Not artifact verification/s)
  assert.equal(fields[0]!.props.maxLength, 100)
  assert.equal(fields[0]!.props.pattern, '^[A-Za-z0-9_.-]+$')
})

test('mounted read action reports an exact broker denial without a receipt', async () => {
  const renderer = await mount(client({ invokeConnector: async () => { throw new Error('connector_action_denied') } }))
  const open = renderer.root.findAllByType('button').find((button) => button.findAllByProps({ className: 'os-button__label' }).some((label) => label.children.join('') === 'Get repository'))!
  await act(async () => { open.props.onClick() })
  const fields = renderer.root.findAllByType('input')
  await act(async () => { fields[0]!.props.onChange({ target: { value: 'AkeBoss-tech' } }); fields[1]!.props.onChange({ target: { value: 'opensaddle' } }) })
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); await new Promise((resolve) => setTimeout(resolve, 0)) })
  const markup = JSON.stringify(renderer.toJSON())
  assert.match(markup, /connector_action_denied/)
  assert.doesNotMatch(markup, /Broker receipt/)
})

test('mounted connected-resource inspector renders the no-grant path without an action', async () => {
  const renderer = await mount(client({ connectors: async () => [] }))
  const markup = JSON.stringify(renderer.toJSON())
  assert.match(markup, /No connected-resource capability was granted for this Run/)
  assert.doesNotMatch(markup, /Get repository|Run read/)
})
