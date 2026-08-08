import assert from 'node:assert/strict'
import test from 'node:test'
import { OperationController } from '../src/features/runs/operationController.ts'
import type { SessionEvent } from '../src/services/contracts.ts'
import type { AgentRunBlock } from '../src/types.ts'

function run(id: string): AgentRunBlock {
  return {
    id, kind: 'coding', title: id, model: 'test', harness: 'test', runtime: 'test',
    statusText: 'Starting', done: false, tools: [], plan: [], artifacts: [],
  }
}

function event(runId: string, sequence: number, type: SessionEvent['type'], payload: Record<string, unknown> = {}): SessionEvent {
  return {
    event_id: `${runId}-${sequence}`,
    session_id: `session-${runId}`,
    run_id: runId,
    sequence,
    timestamp: '2026-08-07T12:00:00Z',
    type,
    payload,
  }
}

function harness() {
  const listeners = new Map<string, (item: SessionEvent) => void>()
  const errors = new Map<string, (error: Error) => void>()
  const unsubscribeCount = new Map<string, number>()
  return {
    listeners,
    errors,
    unsubscribeCount,
    subscribe: (runId: string, listener: (item: SessionEvent) => void, onError?: (error: Error) => void) => {
      listeners.set(runId, listener)
      if (onError) errors.set(runId, onError)
      return () => unsubscribeCount.set(runId, (unsubscribeCount.get(runId) ?? 0) + 1)
    },
  }
}

test('isolates concurrent run output and suppresses duplicate attachments/events', () => {
  const controller = new OperationController()
  const runtime = harness()
  const updates = new Map<string, string[]>()
  const attach = (runId: string) => controller.attach({
    runId,
    initialRun: run(runId),
    subscribe: runtime.subscribe,
    onUpdate: (snapshot) => updates.set(runId, [...(updates.get(runId) ?? []), snapshot.text]),
  })

  assert.equal(attach('run-a'), true)
  assert.equal(attach('run-b'), true)
  assert.equal(attach('run-a'), false)
  runtime.listeners.get('run-a')!(event('run-a', 1, 'agent.output.delta', { text: 'alpha' }))
  runtime.listeners.get('run-b')!(event('run-b', 1, 'agent.output.delta', { text: 'bravo' }))
  runtime.listeners.get('run-a')!(event('run-a', 1, 'agent.output.delta', { text: 'duplicate' }))

  assert.deepEqual(updates.get('run-a'), ['alpha'])
  assert.deepEqual(updates.get('run-b'), ['bravo'])
  assert.equal(controller.get('run-a')?.text, 'alpha')
  assert.equal(controller.get('run-b')?.text, 'bravo')
})

test('reconnect replay resumes from the retained cursor without duplicating transcript', () => {
  const controller = new OperationController()
  const runtime = harness()
  const texts: string[] = []
  const attach = () => controller.attach({
    runId: 'run-1', initialRun: run('run-1'), subscribe: runtime.subscribe,
    onUpdate: (snapshot) => texts.push(snapshot.text),
  })
  attach()
  runtime.listeners.get('run-1')!(event('run-1', 1, 'agent.output.delta', { text: 'hello ' }))
  runtime.errors.get('run-1')!(new Error('disconnected'))
  assert.equal(controller.has('run-1'), false)

  assert.equal(attach(), true)
  runtime.listeners.get('run-1')!(event('run-1', 1, 'agent.output.delta', { text: 'hello ' }))
  runtime.listeners.get('run-1')!(event('run-1', 2, 'agent.output.delta', { text: 'world' }))
  assert.deepEqual(texts, ['hello ', 'hello world'])
})

test('owns the honest terminal receipt and keeps final output before closure', () => {
  const controller = new OperationController()
  const runtime = harness()
  const statuses: string[] = []
  controller.attach({
    runId: 'run-1', initialRun: run('run-1'), subscribe: runtime.subscribe,
    onUpdate: (snapshot) => statuses.push(snapshot.run.statusText),
  })
  runtime.listeners.get('run-1')!(event('run-1', 1, 'agent.failed', { error: 'provider unavailable' }))
  assert.equal(controller.has('run-1'), true)
  runtime.listeners.get('run-1')!(event('run-1', 2, 'agent.output.delta', { text: 'last diagnostic' }))
  runtime.listeners.get('run-1')!(event('run-1', 3, 'session.closed', { status: 'failed' }))

  assert.equal(controller.has('run-1'), false)
  assert.equal(controller.get('run-1')?.run.done, true)
  assert.equal(controller.get('run-1')?.run.failure?.message, 'provider unavailable')
  assert.equal(controller.get('run-1')?.text, 'last diagnostic')
  assert.equal(runtime.unsubscribeCount.get('run-1'), 1)
  assert.ok(statuses.some((status) => /unavailable|could not finish|failed/i.test(status)))
})
