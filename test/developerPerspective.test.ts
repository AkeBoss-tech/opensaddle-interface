import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedData } from '../src/data/seed.ts'
import { deriveDeveloperPerspective } from '../src/perspectives/developer/readModel.ts'
import type { RuntimeRunSummary } from '../src/services/contracts.ts'

const NOW = 2_000_000_000_000

function runtimeRun(overrides: Partial<RuntimeRunSummary> = {}): RuntimeRunSummary {
  return {
    runId: 'run-perspective',
    sessionId: 'session-perspective',
    projectId: 'proj-coding',
    threadId: 'chat-coding-pr',
    task: 'Verify the project surface',
    status: 'running',
    route: {
      modelKey: 'auto',
      harnessKey: 'coding',
      providerKey: 'codex',
      runtimeKey: 'local',
      reasons: [],
      cost: '$0.00',
    },
    createdAt: NOW - 10_000,
    updatedAt: NOW - 5_000,
    ...overrides,
  }
}

test('developer projections are deterministic, pure, and derived from canonical identities', () => {
  const data = createSeedData()
  const before = JSON.stringify(data)
  const runs = [
    runtimeRun(),
    runtimeRun({ status: 'queued', updatedAt: NOW - 20_000 }),
    runtimeRun({ runId: 'run-needs-approval', threadId: 'chat-prs', status: 'waiting', lastEventType: 'approval.requested', updatedAt: NOW - 2_000 }),
  ]

  const first = deriveDeveloperPerspective({
    data,
    projectId: 'proj-coding',
    durableRuns: runs,
    runtimeState: 'ready',
    asOf: NOW,
  })
  const second = deriveDeveloperPerspective({
    data,
    projectId: 'proj-coding',
    durableRuns: [...runs].reverse(),
    runtimeState: 'ready',
    asOf: NOW,
  })

  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(data), before)
  assert.equal(first.traces.filter((trace) => trace.id === 'run:run-perspective').length, 1)
  assert.ok(first.traces.some((trace) => trace.id === 'run:run-perspective' && trace.source === 'durable-runtime' && trace.status === 'Running'))
  assert.ok(first.columns.flatMap((column) => column.cards).every((card) => card.id.startsWith('thread:')))
  assert.equal(first.columns.find((column) => column.id === 'needs-you')?.cards.some((card) => card.runId === 'run-needs-approval'), true)
})

test('typed runtime lifecycle determines columns without persisting board state', () => {
  const data = createSeedData()
  const statuses: Array<[RuntimeRunSummary['status'], string]> = [
    ['queued', 'ready'],
    ['running', 'in-progress'],
    ['awaiting_input', 'needs-you'],
    ['failed', 'review'],
    ['completed', 'done'],
  ]

  for (const [status, expectedColumn] of statuses) {
    const model = deriveDeveloperPerspective({
      data,
      projectId: 'proj-coding',
      durableRuns: [runtimeRun({ status })],
      runtimeState: 'ready',
      asOf: NOW,
    })
    const card = model.columns.flatMap((column) => column.cards).find((candidate) => candidate.runId === 'run-perspective')
    assert.equal(card?.column, expectedColumn)
  }
})

test('missing runtime is distinct from a known empty snapshot', () => {
  const data = createSeedData()
  const unavailable = deriveDeveloperPerspective({
    data,
    projectId: 'proj-coding',
    durableRuns: [],
    runtimeState: 'unavailable',
    runtimeError: 'control plane offline',
    asOf: NOW,
  })
  const ready = deriveDeveloperPerspective({
    data,
    projectId: 'proj-coding',
    durableRuns: [],
    runtimeState: 'ready',
    asOf: NOW,
  })

  assert.equal(unavailable.runtimeState, 'unavailable')
  assert.equal(unavailable.runtimeError, 'control plane offline')
  assert.equal(ready.runtimeState, 'ready')
})

test('a parent perspective does not expose child-project data without a child permission check', () => {
  const data = createSeedData()
  const model = deriveDeveloperPerspective({
    data,
    projectId: 'proj-eng',
    durableRuns: [runtimeRun({ task: 'secret child task' })],
    runtimeState: 'ready',
    asOf: NOW,
  })

  assert.equal(model.traces.some((trace) => trace.title === 'secret child task'), false)
  assert.equal(model.columns.flatMap((column) => column.cards).some((card) => card.projectId === 'proj-coding'), false)
})
