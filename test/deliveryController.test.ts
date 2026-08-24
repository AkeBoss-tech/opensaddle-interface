import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  GovernedDeliveryController,
  GovernedDeliveryValidationError,
  type DeliveryRuntimeControls,
  type GovernedDeliveryReadTransport,
  type GovernedDeliverySnapshot,
} from '../src/features/delivery/index.ts'
import type { SessionEvent } from '../src/services/contracts.ts'
import type { AgentRunBlock } from '../src/types.ts'

const FIXTURE = new URL('../src/features/delivery/domain/snapshots/opensaddle.governed-delivery.v1/fixtures/golden.json', import.meta.url)
const HEAD = `git:${'b'.repeat(40)}`

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(FIXTURE, 'utf8')) as Record<string, unknown>
}

test('reconcile suppresses duplicate and out-of-order lifecycle replay', async () => {
  const controller = new GovernedDeliveryController()
  const document = await fixture()
  const first = controller.reconcile({ document, currentRepositoryRevision: HEAD })
  assert.equal(first.eventCount, 3)
  assert.equal(first.lastSequence, 3)

  const replay = structuredClone(document)
  const operation = replay.operation as Record<string, unknown>
  const lifecycle = operation.lifecycle as unknown[]
  operation.lifecycle = [lifecycle[2], lifecycle[0], lifecycle[1], structuredClone(lifecycle[1])]
  operation.replay = { ...(operation.replay as object), result: 'replayed' }
  ;(replay.effect_receipt as Record<string, unknown>).idempotency_result = 'replayed'
  const reconciled = controller.reconcile({ document: replay, currentRepositoryRevision: HEAD })
  assert.equal(reconciled.eventCount, 3)
  assert.equal(reconciled.lastSequence, 3)
  assert.equal(reconciled.projection.replayResult, 'replayed')
  assert.equal(reconciled.projection.receipt.idempotencyResult, 'replayed')
})

test('conflicting same-fence sequence fails closed', async () => {
  const controller = new GovernedDeliveryController()
  const document = await fixture()
  controller.reconcile({ document, currentRepositoryRevision: HEAD })
  const conflict = structuredClone(document)
  const operation = conflict.operation as Record<string, unknown>
  const lifecycle = operation.lifecycle as Array<Record<string, unknown>>
  lifecycle[1] = { ...lifecycle[1], event_type: 'effect.substituted' }
  assert.throws(
    () => controller.reconcile({ document: conflict, currentRepositoryRevision: HEAD }),
    (error) => error instanceof GovernedDeliveryValidationError && error.code === 'authority_mismatch',
  )
})

test('an older same-fence snapshot cannot regress a reconciled terminal receipt', async () => {
  const controller = new GovernedDeliveryController()
  const terminal = await fixture()
  controller.reconcile({ document: terminal, currentRepositoryRevision: HEAD })
  const older = structuredClone(terminal)
  const operation = older.operation as Record<string, unknown>
  operation.state = 'dispatching'
  operation.lifecycle = (operation.lifecycle as unknown[]).slice(0, 2)
  const reconciled = controller.reconcile({ document: older, currentRepositoryRevision: HEAD })
  assert.equal(reconciled.lastSequence, 3)
  assert.equal(reconciled.projection.terminal, 'completed_verified')
})

test('connect and reconnect retain replay identity without fabricating terminal state', async () => {
  const document = await fixture()
  let listener: ((value: unknown) => void) | undefined
  let unsubscribed = 0
  const transport: GovernedDeliveryReadTransport = {
    snapshot: async () => structuredClone(document),
    subscribe: (_operationId, onSnapshot) => {
      listener = onSnapshot
      return () => { unsubscribed += 1 }
    },
  }
  const controller = new GovernedDeliveryController()
  const updates: GovernedDeliverySnapshot[] = []
  const connect = () => controller.connect({
    operationId: 'publish-184',
    transport,
    projectionContext: () => ({ currentRepositoryRevision: HEAD }),
    onUpdate: (snapshot) => updates.push(snapshot),
  })
  assert.equal(await connect(), true)
  listener?.(structuredClone(document))
  assert.equal(controller.get('publish-184')?.eventCount, 3)
  assert.equal(await controller.reconnect({
    operationId: 'publish-184',
    transport,
    projectionContext: () => ({ currentRepositoryRevision: HEAD }),
    onUpdate: (snapshot) => updates.push(snapshot),
  }), true)
  assert.equal(unsubscribed, 1)
  assert.equal(controller.get('publish-184')?.reconnectCount, 1)
  assert.equal(controller.get('publish-184')?.eventCount, 3)
  assert.ok(updates.some((snapshot) => snapshot.availability === 'reconnecting'))
  assert.equal(controller.get('publish-184')?.projection.terminal, 'completed_verified')
})

test('cancel and intervention reuse injected runtime commands and await authority reconciliation', async () => {
  const calls: string[] = []
  const controls: DeliveryRuntimeControls = {
    cancel: async (runId) => { calls.push(`cancel:${runId}`) },
    intervene: async (runId, guidance) => { calls.push(`steer:${runId}:${guidance}`) },
  }
  const controller = new GovernedDeliveryController()
  controller.reconcile({ document: await fixture(), currentRepositoryRevision: HEAD })
  await controller.intervene('publish-184', 'publish-run', 'Re-run the focused check', controls)
  assert.equal(controller.get('publish-184')?.intervention, 'guidance_sent')
  await controller.cancel('publish-184', 'publish-run', controls)
  assert.equal(controller.get('publish-184')?.intervention, 'cancel_requested')
  assert.deepEqual(calls, ['steer:publish-run:Re-run the focused check', 'cancel:publish-run'])
  assert.equal(controller.get('publish-184')?.projection.terminal, 'completed_verified')
})

function run(): AgentRunBlock {
  return {
    id: 'run-1', kind: 'coding', title: 'Delivery run', model: 'test', harness: 'test', runtime: 'test',
    statusText: 'Starting', done: false, tools: [], plan: [], artifacts: [],
  }
}

function event(sequence: number, text: string): SessionEvent {
  return {
    event_id: `event-${sequence}`,
    session_id: 'session-1',
    run_id: 'run-1',
    sequence,
    timestamp: '2026-08-11T00:00:00Z',
    type: 'agent.output.delta',
    payload: { text },
  }
}

test('integrated run controller retains reconnect cursor and suppresses replay duplicates', () => {
  const controller = new GovernedDeliveryController()
  let listener: ((value: SessionEvent) => void) | undefined
  const subscribe = (_runId: string, onEvent: (value: SessionEvent) => void) => {
    listener = onEvent
    return () => {}
  }
  const texts: string[] = []
  const attach = () => controller.attachRun({
    runId: 'run-1', initialRun: run(), subscribe,
    onUpdate: (snapshot) => texts.push(snapshot.text),
  })
  assert.equal(attach(), true)
  listener?.(event(1, 'one '))
  controller.releaseRun('run-1')
  assert.equal(attach(), true)
  listener?.(event(1, 'duplicate '))
  listener?.(event(2, 'two'))
  assert.deepEqual(texts, ['one ', 'one two'])
})
