import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ProjectModelBudgetPanel } from './ProjectModelBudgetPanel'
import { ProjectModelBudgetClient } from '../../services/projectModelBudget'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const flush = () => new Promise(resolve => setImmediate(resolve))
const budget = (projectId = 'p', revision = 1, canManage = true) => ({
  schema_version: 'opensaddle.project-model-budget.v1', project_id: projectId, scope: 'hosted_model_routes_only',
  viewer_role: canManage ? 'owner' : 'member', can_manage: canManage, state: 'configured',
  max_reserved_cost_microunits: 20, reserved_cost_microunits: 6, revision,
  configured_by: 'alice', updated_at: '2026-09-19T00:00:00Z', recent_changes: [{ revision,
    previous_max_reserved_cost_microunits: null, max_reserved_cost_microunits: 20,
    configured_by: 'alice', recorded_at: '2026-09-19T00:00:00Z' }, ...(revision > 1 ? [{ revision: 1,
      previous_max_reserved_cost_microunits: null, max_reserved_cost_microunits: 20,
      configured_by: 'alice', recorded_at: '2026-09-19T00:00:00Z' }] : [])],
})
const button = (view: ReactTestRenderer, name: string) => view.root.findAllByType('button').find(node => node.findAllByType('span').some(span => span.children.join('') === name))
const rendered = (view: ReactTestRenderer) => JSON.stringify(view.toJSON())

// PROJECT-MODEL-BUDGET-UI-1: mounted real client/UI, external HTTP controlled.
test('owner reviews exact revision and sees a refreshed shared reservation after one PUT', async t => {
  const writes: unknown[] = []
  let revision = 1
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'PUT') { writes.push(JSON.parse(String(init.body))); revision = 2 }
    return Response.json(budget('p', revision))
  })
  let view!: ReactTestRenderer
  await act(async () => { view = create(<ProjectModelBudgetPanel projectId="p" client={new ProjectModelBudgetClient('https://core.example', () => 'alice')} />); await flush() })
  assert.match(rendered(view), /Native Codex and Claude spend is outside this limit/)
  assert.match(rendered(view), /failed or uncertain provider calls/)
  await act(async () => { view.root.findByProps({ 'aria-label': 'New lifetime limit in route microunits' }).props.onChange({ target: { value: '12' } }) })
  await act(async () => { button(view, 'Review budget change')!.props.onClick() })
  assert.match(rendered(view), /replacing revision/)
  assert.equal(writes.length, 0)
  await act(async () => { button(view, 'Save reviewed budget')!.props.onClick(); await flush() })
  assert.deepEqual(writes, [{ max_reserved_cost_microunits: 12, expected_revision: 1 }])
  assert.match(rendered(view), /Budget saved/)
  assert.match(rendered(view), /Revision/)
  await act(async () => view.unmount())
})

test('stale revision and revoked membership remove review controls until an explicit reload', async t => {
  let status = 200, puts = 0
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'PUT') { puts++; return Response.json({ detail: 'conflict' }, { status: 409 }) }
    return status === 200 ? Response.json(budget()) : Response.json({ detail: 'private' }, { status })
  })
  let view!: ReactTestRenderer
  await act(async () => { view = create(<ProjectModelBudgetPanel projectId="p" client={new ProjectModelBudgetClient('https://core.example', () => 'alice')} />); await flush() })
  await act(async () => { view.root.findByProps({ 'aria-label': 'New lifetime limit in route microunits' }).props.onChange({ target: { value: '12' } }) })
  await act(async () => { button(view, 'Review budget change')!.props.onClick() })
  await act(async () => { button(view, 'Save reviewed budget')!.props.onClick(); await flush() })
  assert.equal(puts, 1)
  assert.match(rendered(view), /Reload before reviewing a new limit/)
  assert.equal(button(view, 'Save reviewed budget'), undefined)
  assert.equal(view.root.findAllByProps({ 'aria-label': 'New lifetime limit in route microunits' }).length, 0)
  status = 403
  await act(async () => { button(view, 'Reload budget')!.props.onClick(); await flush() })
  assert.match(rendered(view), /Current Project membership/)
  assert.equal(rendered(view).includes('20 route microunits'), false)
  await act(async () => view.unmount())
})

test('member is read only and late old-Project response cannot populate replacement', async t => {
  let pending = false
  let release!: (response: Response) => void
  t.mock.method(globalThis, 'fetch', async (url: string) => pending ? new Promise<Response>(resolve => { release = resolve }) : Response.json(budget(url.includes('/projects/q/') ? 'q' : 'p', 1, false)))
  const client = new ProjectModelBudgetClient('https://core.example', () => 'alice')
  let view!: ReactTestRenderer
  await act(async () => { view = create(<ProjectModelBudgetPanel projectId="p" client={client} />); await flush() })
  assert.match(rendered(view), /Only a current Project owner or admin/)
  assert.equal(button(view, 'Review budget change'), undefined)
  pending = true
  await act(async () => { button(view, 'Reload budget')!.props.onClick(); await flush() })
  const old = release
  await act(async () => { view.update(<ProjectModelBudgetPanel projectId="q" client={client} />); await flush() })
  await act(async () => { old(Response.json(budget('p'))); await flush() })
  assert.equal(rendered(view).includes('20 route microunits'), false)
  await act(async () => { release(Response.json(budget('q', 1, false))); await flush() })
  assert.match(rendered(view), /Only a current Project owner or admin/)
  await act(async () => view.unmount())
})
