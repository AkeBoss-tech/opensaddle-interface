import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import type { HostedAgentClient, HostedAgentDefinition, HostedAgentOptions, HostedAgentProposal, HostedPendingTask } from '../../services/remoteHostedAgents'
import { HostedAgentSetupSurface } from './HostedAgentSetupPage'

// OS-HOSTED-AGENT-UI-001: mounted Project journey exposes exact review,
// current human controls, and an ambiguous task without silent resubmission.
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
void React

const d = 'a'.repeat(64)
const definition: HostedAgentDefinition = { title: 'Source reviewer', objective: 'Review a registered source',
  instructions: 'Use the registered source claim only.', sourceId: 'src_1', externalWorkerId: 'worker_1',
  assumptions: ['The claim is current.'], evidence: [] }
const options: HostedAgentOptions = { projectId: 'P1', canReview: true,
  sources: [{ sourceId: 'src_1', sourceKind: 'uploaded_snapshot', revision: 'rev-1', snapshotDigest: d }],
  workers: [{ workerId: 'worker_1', registeredAt: '2026-09-19T00:00:00Z', registeredBy: 'owner' }] }
const proposal = (published = false): HostedAgentProposal => ({ proposalId: 'agp_1', projectId: 'P1', definition,
  definitionDigest: d, sourceRevision: 'rev-1', sourceDigest: d,
  workerRegisteredAt: '2026-09-19T00:00:00Z', workerRegisteredBy: 'owner', proposedBy: 'member',
  status: published ? 'published' : 'proposed', ...(published ? { agentId: 'hag_1', publishedBy: 'owner' } : {}),
  revision: published ? 1 : 0, enabled: published })
const field = (view: ReactTestRenderer, label: string) => view.root.findByProps({ 'aria-label': label })
const button = (view: ReactTestRenderer, label: string) => view.root.findAllByType('button').find(node => node.children.join('') === label)!
const rendered = (view: ReactTestRenderer) => JSON.stringify(view.toJSON())
const visibleText = (node: unknown): string => typeof node === 'string' ? node :
  node && typeof node === 'object' && 'children' in node && Array.isArray(node.children)
    ? node.children.map(visibleText).join('') : ''

test('Project owner reviews exact source/worker metadata, publishes digest, pauses by CAS, and does not grant connectors', async () => {
  const proposed: HostedAgentDefinition[] = []
  const publishedDigests: string[] = []
  const lifecycleCalls: Array<[number, boolean]> = []
  const client: HostedAgentClient = {
    options: async () => options, list: async () => [], events: async () => [{ eventId: 'hae_1', revision: 1,
      action: 'published', actor: 'owner', recordedAt: '2026-09-19T00:01:00Z' }],
    propose: async (_project, value) => { proposed.push(value); return { ...proposal(), definition: value } },
    publish: async (_id, digest) => { publishedDigests.push(digest); return proposal(true) },
    lifecycle: async (_id, revision, enabled) => { lifecycleCalls.push([revision, enabled]);
      return { ...proposal(true), revision: 2, enabled: false } },
    submitTask: async () => { throw Error('not requested') }, pendingTask: () => undefined,
    discardPendingTask: async () => {},
  }
  let view!: ReactTestRenderer
  await act(async () => { view = create(<MemoryRouter><HostedAgentSetupSurface client={client} projectId="P1" /></MemoryRouter>) })
  await act(async () => {
    field(view, 'Hosted agent name').props.onChange({ target: { value: definition.title } })
    field(view, 'Hosted objective').props.onChange({ target: { value: definition.objective } })
    field(view, 'Hosted instructions').props.onChange({ target: { value: definition.instructions } })
    field(view, 'Hosted remote worker').props.onChange({ target: { value: 'worker_1' } })
    field(view, 'Hosted assumptions').props.onChange({ target: { value: definition.assumptions[0] } })
  })
  await act(async () => { view.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }) })
  assert.deepEqual(proposed[0], definition)
  assert.match(rendered(view), /source revision|rev-1/)
  assert.match(rendered(view), new RegExp(d))
  assert.match(rendered(view), /worker_1/)
  assert.match(rendered(view), /No Core connector or memory grants/)
  assert.equal(button(view, 'Publish reviewed external agent').props.disabled, true)
  await act(async () => { view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }) })
  await act(async () => { button(view, 'Publish reviewed external agent').props.onClick() })
  assert.deepEqual(publishedDigests, [d])
  await act(async () => { button(view, 'Pause external agent').props.onClick() })
  assert.deepEqual(lifecycleCalls, [[1, false]])
  assert.match(visibleText(view.toJSON()), /Paused at revision 2/)
  await act(async () => view.unmount())
})

test('member sees no publish or lifecycle control, and a paused exact pending task can be retried without a new key', async () => {
  let retained: HostedPendingTask | undefined = { agentId: 'hag_1', agentRevision: 1,
    taskDigest: d, key: 'same-key', createdAt: '2026-09-19T00:01:00Z' }
  const attempts: Array<[number, string]> = []
  const client: HostedAgentClient = {
    options: async () => ({ ...options, canReview: false }), list: async () => [{ ...proposal(true), revision: 2, enabled: false }],
    events: async () => [], propose: async () => { throw Error('unused') },
    publish: async () => { throw Error('member cannot publish') }, lifecycle: async () => { throw Error('member cannot change lifecycle') },
    submitTask: async (_project, _id, revision, task) => { attempts.push([revision, task]); retained = undefined;
      return { agentId: 'hag_1', taskId: 'hat_1', runId: 'run_1', replayed: true } },
    pendingTask: () => retained, discardPendingTask: async () => { retained = undefined },
  }
  let view!: ReactTestRenderer
  await act(async () => { view = create(<MemoryRouter><HostedAgentSetupSurface client={client} projectId="P1" /></MemoryRouter>) })
  await act(async () => { view.root.findByProps({ 'aria-label': 'Hosted agent drafts' }).findByType('button').props.onClick() })
  assert.equal(view.root.findAllByType('button').some(node => node.children.join('') === 'Enable external agent'), false)
  assert.match(rendered(view), /earlier task submission may have succeeded/)
  await act(async () => { field(view, 'Hosted agent task').props.onChange({ target: { value: 'Inspect the source' } }) })
  await act(async () => { view.root.findAllByType('form')[1].props.onSubmit({ preventDefault() {} }) })
  assert.deepEqual(attempts, [[1, 'Inspect the source']])
  assert.equal(view.root.findByType('a').props.href, '/project/P1/tasks/run_1')
  await act(async () => view.unmount())
})

test('late Project response cannot restore a previous identity or Project', async () => {
  let release!: (value: HostedAgentOptions) => void
  const stale: HostedAgentClient = { options: () => new Promise(resolve => { release = resolve }),
    list: async () => [proposal()], events: async () => [], propose: async () => { throw Error('unused') },
    publish: async () => { throw Error('unused') }, lifecycle: async () => { throw Error('unused') },
    submitTask: async () => { throw Error('unused') }, pendingTask: () => undefined, discardPendingTask: async () => {} }
  const current: HostedAgentClient = { ...stale,
    options: async () => ({ ...options, projectId: 'P2', sources: [], workers: [] }), list: async () => [] }
  let view!: ReactTestRenderer
  await act(async () => { view = create(<MemoryRouter><HostedAgentSetupSurface client={stale} projectId="P1" /></MemoryRouter>) })
  await act(async () => { field(view, 'Hosted instructions').props.onChange({ target: { value: 'PRIVATE PROJECT A DRAFT' } }) })
  await act(async () => { view.update(<MemoryRouter><HostedAgentSetupSurface client={current} projectId="P2" /></MemoryRouter>) })
  await act(async () => { release(options) })
  assert.match(rendered(view), /No external agent drafts are saved/)
  assert.equal(rendered(view).includes('Source reviewer'), false)
  assert.equal(rendered(view).includes('PRIVATE PROJECT A DRAFT'), false)
  await act(async () => view.unmount())
})

test('choosing a second proposal fences late history and pending state from the first', async () => {
  const first = proposal(true)
  const second = { ...proposal(true), proposalId: 'agp_2', agentId: 'hag_2',
    definition: { ...definition, title: 'Second agent' } }
  let releaseFirst!: (value: Awaited<ReturnType<HostedAgentClient['events']>>) => void
  const client: HostedAgentClient = {
    options: async () => options, list: async () => [first, second],
    events: id => id === first.proposalId ? new Promise(resolve => { releaseFirst = resolve }) :
      Promise.resolve([{ eventId: 'hae_2', revision: 1, action: 'published', actor: 'second-owner', recordedAt: '2026-09-19T00:02:00Z' }]),
    propose: async () => { throw Error('unused') }, publish: async () => { throw Error('unused') },
    lifecycle: async () => { throw Error('unused') }, submitTask: async () => { throw Error('unused') },
    pendingTask: (_project, agentId) => agentId === first.agentId ? { agentId: first.agentId!, agentRevision: 1,
      taskDigest: d, key: 'first-key', createdAt: '2026-09-19T00:00:00Z' } : undefined,
    discardPendingTask: async () => {},
  }
  let view!: ReactTestRenderer
  await act(async () => { view = create(<MemoryRouter><HostedAgentSetupSurface client={client} projectId="P1" /></MemoryRouter>) })
  const choices = view.root.findByProps({ 'aria-label': 'Hosted agent drafts' }).findAllByType('button')
  await act(async () => { choices[0].props.onClick() })
  await act(async () => { choices[1].props.onClick() })
  await act(async () => { releaseFirst([{ eventId: 'hae_old', revision: 1, action: 'published',
    actor: 'first-owner', recordedAt: '2026-09-19T00:01:00Z' }]) })
  assert.match(rendered(view), /second-owner/)
  assert.equal(rendered(view).includes('first-owner'), false)
  assert.equal(rendered(view).includes('first-key'), false)
  assert.match(rendered(view), /Second agent/)
  await act(async () => view.unmount())
})

test('a late publication response updates its list row without replacing another selected agent', async () => {
  const first = proposal()
  const second = { ...proposal(true), proposalId: 'agp_2', agentId: 'hag_2',
    definition: { ...definition, title: 'Second agent', instructions: 'Second agent only.' } }
  let release!: (value: HostedAgentProposal) => void
  const client: HostedAgentClient = {
    options: async () => options, list: async () => [first, second], events: async () => [],
    propose: async () => { throw Error('unused') },
    publish: () => new Promise(resolve => { release = resolve }),
    lifecycle: async () => { throw Error('unused') }, submitTask: async () => { throw Error('unused') },
    pendingTask: () => undefined, discardPendingTask: async () => {},
  }
  let view!: ReactTestRenderer
  await act(async () => { view = create(<MemoryRouter><HostedAgentSetupSurface client={client} projectId="P1" /></MemoryRouter>) })
  await act(async () => { view.root.findByProps({ 'aria-label': 'Hosted agent drafts' }).findAllByType('button')[0].props.onClick() })
  await act(async () => { view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }) })
  await act(async () => { button(view, 'Publish reviewed external agent').props.onClick() })
  await act(async () => { view.root.findByProps({ 'aria-label': 'Hosted agent drafts' }).findAllByType('button')[1].props.onClick() })
  await act(async () => { release(proposal(true)) })
  const detail = view.root.findByProps({ className: 'agent-setup-definition' })
  assert.match(visibleText(detail), /Second agent only/)
  assert.equal(visibleText(detail).includes('Use the registered source claim only'), false)
  assert.match(visibleText(view.root.findByProps({ 'aria-label': 'Hosted agent drafts' })), /Fixture source reviewer|Source reviewer/)
  await act(async () => view.unmount())
})
