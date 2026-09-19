import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import type { AgentBuilderOptions, AgentDefinition, AgentProfileClient, AgentProposal } from '../../services/remoteAgentProfiles'
import { AgentSetupSurface } from './AgentSetupPage'

// OS-AGENT-BUILDER-001: exact reviewed scopes remain visible and task admission
// uses live Core participant authority across the Interface client boundary.

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
void React

const digest = 'b'.repeat(64)
const definition: AgentDefinition = { title: 'Source reviewer', objective: 'Review the registered source', instructions: 'Stay within source evidence.', sourceId: 'src_1', harness: 'codex-app-server', grants: [], assumptions: ['The source is current'], evidence: [] }
const options: AgentBuilderOptions = { executionAvailable: true, canReview: true,
  sources: [{ sourceId: 'src_1', sourceKind: 'git', revision: 'rev-1', snapshotDigest: 'a'.repeat(64) }],
  harnesses: ['codex-app-server', 'claude-code-stream-json'],
  connectorActions: [{ connector: 'github', action: 'get_repository', title: 'Get repository',
    input: { required: ['owner', 'repo'], properties: { owner: { type: 'string' }, repo: { type: 'string' } } } }],
}
const proposed = (): AgentProposal => ({ proposalId: 'agp_1', projectId: 'P1', definitionDigest: digest, definition, status: 'proposed' })
const published = (): AgentProposal => ({ ...proposed(), status: 'published', reviewedBy: 'owner', publishedAt: '2026-09-19T00:00:00Z', participantId: 'ptc_1' })
const render = (client?: AgentProfileClient, canReview?: boolean) => <MemoryRouter><AgentSetupSurface client={client} projectId="P1" canReview={canReview} /></MemoryRouter>
const button = (view: ReactTestRenderer, label: string) => view.root.findAllByType('button').find((node) => node.children.join('') === label)!
const field = (view: ReactTestRenderer, label: string) => view.root.findByProps({ 'aria-label': label })

test('reviewed agent journey submits a deny-by-default draft, exact publication review, and one idempotent Run admission', async () => {
  const definitions: AgentDefinition[] = []
  const digests: string[] = []
  const keys: string[] = []
  let attempts = 0
  const client: AgentProfileClient = {
    options: async () => options,
    participant: async () => ({ projectId: 'P1', revision: 2, lifecycle: 'waiting' }),
    list: async () => [],
    propose: async (_project, value) => { definitions.push(value); return { ...proposed(), definition: value } },
    publish: async (_proposalId, value) => { digests.push(value); return { ...published(), definition: definitions[0] } },
    submitTask: async (_participantId, revision, task, key) => {
      assert.equal(revision, 2)
      assert.equal(task, 'Inspect the current source')
      keys.push(key)
      if (++attempts === 1) throw Error('response lost')
      return { messageId: 'pmsg_1', participantId: 'ptc_1', projectId: 'P1', runId: 'run_1', status: 'queued', participantRevision: 0, replayed: true }
    },
  }
  let view!: ReactTestRenderer
  await act(async () => { view = create(render(client)); await Promise.resolve() })
  await act(async () => {
    field(view, 'Agent name').props.onChange({ target: { value: definition.title } })
    field(view, 'Objective').props.onChange({ target: { value: definition.objective } })
    field(view, 'Instructions').props.onChange({ target: { value: definition.instructions } })
    field(view, 'Assumptions').props.onChange({ target: { value: definition.assumptions[0] } })
  })
  await act(async () => { field(view, 'Installed read action').props.onChange({ target: { value: 'github/get_repository' } }) })
  await act(async () => {
    field(view, 'Exact owner').props.onChange({ target: { value: 'company' } })
    field(view, 'Exact repo').props.onChange({ target: { value: 'finance' } })
    field(view, 'Permission rationale').props.onChange({ target: { value: 'Only this repository is relevant' } })
  })
  await act(async () => { button(view, 'Add exact read permission').props.onClick() })
  await act(async () => { view.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); await Promise.resolve() })
  assert.deepEqual(definitions[0].grants, [{ connector: 'github', action: 'get_repository', argumentEquals: { owner: 'company', repo: 'finance' }, rationale: 'Only this repository is relevant' }])
  const review = view.root.findByProps({ className: 'agent-setup-definition' })
  assert.equal(review.findByType('pre').children.join(''), 'Stay within source evidence.')
  assert.match(review.findAllByType('code').map((item) => item.children.join('')).join(' '), /finance/)
  assert.equal(button(view, 'Publish reviewed agent').props.disabled, true)
  await act(async () => { view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }); await Promise.resolve() })
  await act(async () => { button(view, 'Publish reviewed agent').props.onClick(); await Promise.resolve() })
  assert.deepEqual(digests, [digest])
  await act(async () => { field(view, 'Agent task').props.onChange({ target: { value: 'Inspect the current source' } }) })
  await act(async () => { view.root.findAllByType('form')[1].props.onSubmit({ preventDefault() {} }); await Promise.resolve() })
  assert.match(JSON.stringify(view.toJSON()), /response lost/)
  await act(async () => { view.root.findAllByType('form')[1].props.onSubmit({ preventDefault() {} }); await Promise.resolve() })
  assert.equal(keys[0], keys[1])
  assert.equal(view.root.findByType('a').props.href, '/project/P1/tasks/run_1')
  await act(async () => view.unmount())
})

test('ordinary members can inspect a proposed definition but do not receive a publish control', async () => {
  const client: AgentProfileClient = { options: async () => ({ ...options, canReview: false }), participant: async () => { throw Error('unexpected') }, list: async () => [proposed()], propose: async () => proposed(), publish: async () => { throw Error('unexpected') }, submitTask: async () => { throw Error('unexpected') } }
  let view!: ReactTestRenderer
  await act(async () => { view = create(render(client)); await Promise.resolve() })
  await act(async () => { view.root.findAllByType('button').find((node) => node.findAllByType('strong').some((title) => title.children.join('') === 'Source reviewer'))!.props.onClick(); await Promise.resolve() })
  assert.match(JSON.stringify(view.toJSON()), /Only a Project owner or admin can publish this exact draft/)
  assert.equal(view.root.findAllByType('button').some((node) => node.children.join('') === 'Publish reviewed agent'), false)
  await act(async () => view.unmount())
})

test('a saved draft stays reviewable when execution is unavailable', async () => {
  let participantReads = 0
  const client: AgentProfileClient = { options: async () => ({ ...options, executionAvailable: false }),
    participant: async () => { participantReads++; return { projectId: 'P1', revision: 4, lifecycle: 'paused' } },
    list: async () => [published()], propose: async () => proposed(), publish: async () => published(),
    submitTask: async () => { throw Error('should never submit') },
  }
  let view!: ReactTestRenderer
  await act(async () => { view = create(render(client)); await Promise.resolve() })
  await act(async () => { view.root.findAllByType('button').find((node) => node.findAllByType('strong').some((title) => title.children.join('') === 'Source reviewer'))!.props.onClick() })
  assert.match(JSON.stringify(view.toJSON()), /Task execution is unavailable/)
  assert.equal(participantReads, 0)
  await act(async () => view.unmount())
})

test('task admission checks current participant lifecycle before sending', async () => {
  let submissions = 0
  const client: AgentProfileClient = { options: async () => options,
    participant: async () => ({ projectId: 'P1', revision: 4, lifecycle: 'paused' }),
    list: async () => [published()], propose: async () => proposed(), publish: async () => published(),
    submitTask: async () => { submissions++; throw Error('unexpected') },
  }
  let view!: ReactTestRenderer
  await act(async () => { view = create(render(client)); await Promise.resolve() })
  await act(async () => { view.root.findAllByType('button').find((node) => node.findAllByType('strong').some((title) => title.children.join('') === 'Source reviewer'))!.props.onClick() })
  await act(async () => { field(view, 'Agent task').props.onChange({ target: { value: 'Inspect' } }) })
  await act(async () => { view.root.findAllByType('form')[1].props.onSubmit({ preventDefault() {} }); await Promise.resolve() })
  assert.match(JSON.stringify(view.toJSON()), /no longer available/)
  assert.equal(submissions, 0)
  await act(async () => view.unmount())
})
