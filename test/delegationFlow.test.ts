import assert from 'node:assert/strict'
import test from 'node:test'
import { createAndOpenDelegatedChannel, selectAuthoritativeRootRun } from '../src/features/runs/delegationFlow'
import type { DelegationRequest, DelegationResult } from '../src/services/contracts'
import type { AgentRunBlock, Message } from '../src/types'

const request: DelegationRequest = {
  idempotencyKey: 'delegate-once',
  task: 'Review the release boundary',
  harnessId: 'codex',
  sessionStrategy: 'fork_if_supported',
}

const result: DelegationResult = {
  delegationId: 'dlg-1',
  parentThreadId: 'thread-parent',
  childThreadId: 'thread-child',
  runId: 'run-child',
  status: 'bound',
  parentBoundarySequence: 3,
  selectedRoute: { harness: 'codex' },
  effectivePolicy: { credentials_inherited: false },
}

test('hydrates an authoritative child Channel before navigating to it', async () => {
  const events: string[] = []
  const opened = await createAndOpenDelegatedChannel({
    runtime: {
      delegate: async (parentRunId, observed) => {
        assert.equal(parentRunId, 'run-parent')
        assert.deepEqual(observed, request)
        events.push('delegate')
        return result
      },
    },
    parentRunId: 'run-parent',
    request,
    hydrateThread: async (threadId) => {
      assert.equal(threadId, 'thread-child')
      events.push('hydrate')
    },
    navigate: (path) => {
      assert.equal(path, '/chat/thread-child')
      events.push('navigate')
    },
  })

  assert.equal(opened, result)
  assert.deepEqual(events, ['delegate', 'hydrate', 'navigate'])
})

test('does not hydrate or navigate when server delegation is rejected', async () => {
  const events: string[] = []
  await assert.rejects(createAndOpenDelegatedChannel({
    runtime: {
      delegate: async () => {
        events.push('delegate')
        throw new Error('delegation write access is disabled')
      },
    },
    parentRunId: 'run-parent',
    request,
    hydrateThread: async () => { events.push('hydrate') },
    navigate: () => { events.push('navigate') },
  }), /write access is disabled/)
  assert.deepEqual(events, ['delegate'])
})

test('only a server-issued root run can become a delegation parent', () => {
  const run = (id: string): AgentRunBlock => ({
    id,
    kind: 'coding',
    title: 'Run',
    model: 'Codex default',
    harness: 'Codex',
    runtime: 'Local desktop',
    statusText: 'Running',
    done: false,
    tools: [],
    plan: [],
    artifacts: [],
  })
  const message = (id: string, block: AgentRunBlock, runtimeRunId?: string): Message => ({
    id,
    chatId: 'thread-parent',
    role: 'assistant',
    text: '',
    createdAt: 1,
    run: block,
    runtimeRunId,
  })

  assert.equal(selectAuthoritativeRootRun([
    message('optimistic', run('pending')),
  ]), undefined)
  assert.equal(selectAuthoritativeRootRun([
    message('authoritative', run('run-parent'), 'run-parent'),
    message('optimistic', run('pending')),
  ])?.id, 'run-parent')
})
