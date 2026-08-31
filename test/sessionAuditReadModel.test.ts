import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedData } from '../src/data/seed.ts'
import { BUNDLED_REVIEW_PLUGINS, SESSION_AUDIT_PLUGIN } from '../src/extensions/bundledReviewPlugins.ts'
import { deriveSessionAudit } from '../src/features/review/sessionAuditReadModel.ts'
import type { RuntimeRunSummary } from '../src/services/contracts.ts'

const NOW = 2_000_000_000_000

function run(overrides: Partial<RuntimeRunSummary> = {}): RuntimeRunSummary {
  return {
    runId: 'run-audit-1',
    sessionId: 'session-audit-1',
    projectId: 'proj-coding',
    threadId: 'chat-audit',
    task: 'Review and verify the codebase',
    status: 'completed',
    route: {
      modelKey: 'gpt',
      modelId: 'gpt-test',
      harnessKey: 'coding',
      providerKey: 'codex',
      runtimeKey: 'local',
      reasons: ['configured harness'],
      cost: '$0.10',
    },
    createdAt: NOW - 60_000,
    updatedAt: NOW,
    ...overrides,
  }
}

test('session audit is a default bundled, projection-only plugin', () => {
  assert.equal(SESSION_AUDIT_PLUGIN.bundled, true)
  assert.equal(SESSION_AUDIT_PLUGIN.authority, 'projection-only')
  assert.ok(SESSION_AUDIT_PLUGIN.capabilities.includes('action.project-audit.v1'))
  assert.ok(BUNDLED_REVIEW_PLUGINS.some((plugin) => plugin.id === SESSION_AUDIT_PLUGIN.id))
})

test('session audit reconciles authoritative runs with measured usage and aggregate prompt patterns', () => {
  const data = createSeedData()
  data.chats = [{
    id: 'chat-audit', projectId: 'proj-coding', title: 'Audit', visibility: 'private',
    createdAt: NOW - 120_000, updatedAt: NOW, sharedWith: [],
  }]
  data.messages = [
    { id: 'prompt-1', chatId: 'chat-audit', role: 'user', text: 'Please review the architecture and verify all tests', createdAt: NOW - 70_000 },
    {
      id: 'answer-1', chatId: 'chat-audit', role: 'assistant', text: '', createdAt: NOW,
      runtimeRunId: 'run-audit-1',
      run: {
        id: 'run-audit-1', kind: 'coding', title: 'Audit', model: 'gpt-test', harness: 'Codex', runtime: 'Local',
        statusText: 'Completed', done: true, tools: [], plan: [], artifacts: [], usage: { inputTokens: 800, outputTokens: 200 },
      },
    },
  ]

  const model = deriveSessionAudit({
    data,
    projectIds: new Set(['proj-coding']),
    durableRuns: [run()],
    runtimeReady: true,
    now: NOW,
  })

  assert.equal(model.provenance, 'authoritative-runs')
  assert.equal(model.sessionCount, 1)
  assert.equal(model.totalTokens, 1_000)
  assert.deepEqual(model.tokenCoverage, { measured: 1, total: 1 })
  assert.equal(model.successRate, 1)
  assert.equal(model.averageDurationMs, 60_000)
  assert.deepEqual(model.harnesses, [{ label: 'codex', value: 1 }])
  assert.ok(model.promptPatterns.some((pattern) => pattern.label === 'Review or diagnose' && pattern.value === 1))
  assert.ok(model.promptPatterns.some((pattern) => pattern.label === 'Verify or test' && pattern.value === 1))
})

test('session audit labels fallback snapshots and never invents unavailable token metrics', () => {
  const data = createSeedData()
  data.agentSessions = [{
    id: 'session-local', agentId: 'agent-coding', projectId: 'proj-coding', status: 'running',
    harness: 'Claude Code', model: 'Sonnet', startedAt: NOW, title: 'Maintain service',
  }]
  data.chats = []
  data.messages = []

  const model = deriveSessionAudit({
    data,
    projectIds: new Set(['proj-coding']),
    durableRuns: [],
    runtimeReady: false,
    now: NOW,
  })

  assert.equal(model.provenance, 'workspace-snapshot')
  assert.equal(model.sessionCount, 1)
  assert.equal(model.activeCount, 1)
  assert.equal(model.totalTokens, undefined)
  assert.deepEqual(model.tokenCoverage, { measured: 0, total: 1 })
  assert.equal(model.successRate, undefined)
})
