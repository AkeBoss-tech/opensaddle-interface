import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import {act, create, type ReactTestRenderer} from 'react-test-renderer'
import {ProjectTaskFeed} from './ProjectTaskFeed'
import {DispatchPerspective} from './builtins'
import type {JourneySnapshot} from '../../features/onboarding/ConnectedJourneySurface'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true
const snapshot = (projectId: string, status = 'running'): JourneySnapshot => ({projectId, members: [], workers: [], activeRuns: [{runId: 'run-one', task: 'Inspect source', status, leaseEpoch: 1, requestedBy: 'owner', cancellationRequested: false}]})

// PROJECT-TASK-FEED-1: all Perspectives receive current scoped canonical task data.
test('mounted host advances board status, preserves unchanged projection identity, hides failed reads and recovers', async t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  let status = 'running', failed = false, reads = 0
  const authority = {snapshot: async () => {reads++; if (failed) throw Error('403'); return snapshot('P', status)}}
  let view!: ReactTestRenderer
  t.after(async () => {await act(async () => view.unmount()); t.mock.timers.reset()})
  await act(async () => {view = create(<ProjectTaskFeed authority={authority} projectId="P" connectionKey="account-one">{model => <DispatchPerspective model={model} onOpenTask={() => {}} onNewTask={() => {}}/>}</ProjectTaskFeed>)})
  const first = view.root.findByType(DispatchPerspective).props.model
  assert.match(JSON.stringify(view.toJSON()), /running/)
  await act(async () => t.mock.timers.tick(5000))
  assert.equal(view.root.findByType(DispatchPerspective).props.model, first, 'unchanged polls must not reset installed frames')
  status = 'completed'
  await act(async () => t.mock.timers.tick(5000))
  assert.match(JSON.stringify(view.toJSON()), /completed/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /running/)
  failed = true
  await act(async () => t.mock.timers.tick(5000))
  assert.equal(view.root.findAllByType(DispatchPerspective).length, 0)
  assert.match(JSON.stringify(view.toJSON()), /Rechecking/)
  failed = false
  await act(async () => t.mock.timers.tick(5000))
  assert.equal(view.root.findAllByType(DispatchPerspective).length, 1)
  assert.equal(reads, 5)
})

test('Project/account changes fence late responses and slow reads expire without overlapping requests', async t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  let reads = 0
  const pending: Array<(value: JourneySnapshot) => void> = []
  const authority = {snapshot: () => {reads++; return new Promise<JourneySnapshot>(resolve => pending.push(resolve))}}
  let view!: ReactTestRenderer
  const render = (projectId: string, account: string) => <ProjectTaskFeed authority={authority} projectId={projectId} connectionKey={account}>{model => <p>{model.projectId}:{model.tasks[0]?.status}</p>}</ProjectTaskFeed>
  t.after(async () => {await act(async () => view.unmount()); t.mock.timers.reset()})
  await act(async () => {view = create(render('P', 'first'))})
  await act(async () => {view.update(render('Q', 'second'))})
  await act(async () => pending[0](snapshot('P')))
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /running/)
  await act(async () => pending[1](snapshot('Q')))
  assert.match(JSON.stringify(view.toJSON()), /running/)
  await act(async () => t.mock.timers.tick(5000))
  await act(async () => t.mock.timers.tick(15000))
  assert.match(JSON.stringify(view.toJSON()), /timed out/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /running/)
  await act(async () => t.mock.timers.tick(30000))
  assert.equal(reads, 3, 'a hung read must not accumulate requests')
  await act(async () => pending[2](snapshot('Q', 'completed')))
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /completed/)
  await act(async () => t.mock.timers.tick(5000))
  await act(async () => pending[3](snapshot('P', 'completed')))
  assert.match(JSON.stringify(view.toJSON()), /Rechecking/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /completed/)
})
