import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appendTranscript } from '../../../src/features/runs/transcript.js'
import { createOrderedEventEmitter } from '../../../src/services/orderedEvents.js'
import type { SessionEvent } from '../../../src/services/contracts.js'
import { applyRunEvent } from '../../../src/lib/runEvents.js'
import type { AgentRunBlock } from '../../../src/types/index.js'

function event(sequence: number, text = String(sequence)): SessionEvent {
  return {
    event_id: `event-${sequence}`,
    session_id: 'session-1',
    run_id: 'run-1',
    sequence,
    timestamp: new Date(sequence).toISOString(),
    type: 'agent.output.delta',
    payload: { text },
  }
}

describe('durable client event handling', () => {
  it('orders snapshot and SSE events without dropping early deltas', () => {
    const received: number[] = []
    const emit = createOrderedEventEmitter((item) => received.push(item.sequence))

    emit(event(2))
    emit(event(0))
    emit(event(1))
    emit(event(2))

    assert.deepEqual(received, [0, 1, 2])
  })

  it('merges token deltas, cumulative snapshots, and repeated finals', () => {
    let transcript = appendTranscript('', 'Hello')
    transcript = appendTranscript(transcript, ' world')
    transcript = appendTranscript(transcript, 'Hello world!')
    transcript = appendTranscript(transcript, 'Hello world!')

    assert.equal(transcript, 'Hello world!')
  })

  it('removes partial overlap during event replay', () => {
    assert.equal(
      appendTranscript('Implemented the change.', 'the change. Tests pass.'),
      'Implemented the change. Tests pass.',
    )
  })

  it('persists used files and clarification state in the run record', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      kind: 'coding',
      title: 'Coding run',
      model: 'Codex',
      harness: 'Coding',
      runtime: 'Local',
      statusText: 'Working',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const withFile = applyRunEvent(initial, {
      ...event(0),
      type: 'file.changed',
      payload: { path: 'src/retry.ts' },
    })
    const waiting = applyRunEvent(withFile, {
      ...event(1),
      type: 'agent.input.requested',
      payload: { prompt: 'Should retries use exponential backoff?' },
    })

    assert.equal(waiting.sources?.[0]?.label, 'src/retry.ts')
    assert.equal(waiting.inputRequest?.kind, 'clarification')
    assert.match(waiting.inputRequest?.prompt ?? '', /exponential backoff/)
  })
})
