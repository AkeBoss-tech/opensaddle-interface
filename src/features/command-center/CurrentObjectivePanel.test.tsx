import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { CommandCenterSnapshot } from '../../services/contracts'
import { CurrentObjectivePanel } from './CurrentObjectivePanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
void React

function snapshot(state: CommandCenterSnapshot['priorityStatus']['state'], revision = 7): CommandCenterSnapshot {
  return {
    generatedAt: '2026-09-07T05:00:00Z',
    priority: state === 'available' ? { projectId: 'P1', goalId: 'G1', goalRevision: revision, objective: 'Ship the daily loop', acceptanceCriteria: ['Find the real objective', 'Resolve human attention'], status: 'working', updatedAt: '2026-09-07T04:59:00Z' } : null,
    priorityStatus: { state, reason: state === 'ambiguous' ? 'Two active Goals are authorized; no explicit selection exists.' : state === 'unavailable' ? 'goal_authority_not_configured' : undefined },
    attentionItems: [], activeRuns: [], projects: state === 'ambiguous' ? [{ projectId: 'P1', status: 'active', objective: 'First objective' }, { projectId: 'P2', status: 'active', objective: 'Second objective' }] : state === 'empty' ? [{ projectId: 'P1', status: 'active' }] : [], outcomes: [], unavailableSections: state === 'unavailable' ? ['priority'] : [],
  }
}

async function mount(value: CommandCenterSnapshot) {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<MemoryRouter><CurrentObjectivePanel snapshot={value} projectName={(id) => `Project ${id}`} /></MemoryRouter>) })
  return renderer
}

test('mounted objective updates to the revised Goal identity without retaining the old revision', async () => {
  const renderer = await mount(snapshot('available', 7))
  assert.match(JSON.stringify(renderer.toJSON()), /Ship the daily loop.*G1.*revision.*7.*Acceptance criteria/s)
  await act(async () => { renderer.update(<MemoryRouter><CurrentObjectivePanel snapshot={snapshot('available', 8)} projectName={(id) => `Project ${id}`} /></MemoryRouter>) })
  assert.equal(renderer.root.findByType('a').props.href, '/project/P1/overview')
  const revised = JSON.stringify(renderer.toJSON())
  assert.match(revised, /revision.*8/)
  assert.equal(renderer.root.findAllByType('code').some((node) => node.children.join('') === '7'), false)
})

test('mounted multi-project ambiguity explains why Home does not select a priority', async () => {
  const markup = JSON.stringify((await mount(snapshot('ambiguous'))).toJSON())
  assert.match(markup, /Two active Goals are authorized; no explicit selection exists/)
  assert.doesNotMatch(markup, /#1|Ship the daily loop/)
})

test('mounted objective distinguishes configured empty from unavailable authority', async () => {
  const empty = await mount(snapshot('empty'))
  assert.match(JSON.stringify(empty.toJSON()), /No active objective is recorded/)
  assert.equal(empty.root.findByType('a').props.href, '/project/P1/overview')
  assert.match(empty.root.findByType('a').children.join(''), /Create objective/)
  const unavailable=JSON.stringify((await mount(snapshot('unavailable'))).toJSON());assert.match(unavailable,/Objective tracking is not configured for this server/);assert.doesNotMatch(unavailable,/goal_authority_not_configured/)
})
