import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create } from 'react-test-renderer'
import type { ProjectGoal, ProjectGoalClient } from '../../services/contracts'
import { GoalRevisionConflictError } from '../../services/remoteProjectGoals'
import { ProjectGoalEditor } from './ProjectGoalEditor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
void React
const goal = (revision = 2): ProjectGoal => ({ goalId: 'G1', projectId: 'P1', version: 1, revision, objective: 'Old objective', acceptanceCriteria: ['Old result'], status: 'planning', policyReceipt: {}, evidence: [], createdAt: '', updatedAt: '', availableActions: { start: false, pause: false, resume: false, stop: false } })

test('mounted editor creates without implying execution', async () => {
  let created: unknown
  const client = { get: async () => null, set: async (_: string, input: unknown) => { created = input; return goal(0) } } as ProjectGoalClient
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<ProjectGoalEditor projectId="P1" client={client} />) })
  await act(async () => {})
  const areas = renderer.root.findAllByType('textarea')
  await act(async () => { areas[0].props.onChange({ target: { value: 'New objective' } }); areas[1].props.onChange({ target: { value: 'Result one\nResult two' } }) })
  await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  assert.deepEqual(created, { objective: 'New objective', acceptanceCriteria: ['Result one', 'Result two'] })
  assert.match(JSON.stringify(renderer.toJSON()), /does not start work/)
})

test('mounted editor retains draft on exact revision conflict and offers explicit reload', async () => {
  const client = { get: async () => goal(), set: async () => goal(), revise: async () => { throw new GoalRevisionConflictError(3) } } as ProjectGoalClient
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(<ProjectGoalEditor projectId="P1" client={client} />) }); await act(async () => {})
  const objective = renderer.root.findAllByType('textarea')[0]
  await act(async () => { objective.props.onChange({ target: { value: 'My retained draft' } }) })
  await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  assert.equal(renderer.root.findAllByType('textarea')[0].props.value, 'My retained draft')
  assert.match(JSON.stringify(renderer.toJSON()), /changed on the server.*draft has been kept.*Reload latest/s)
})
