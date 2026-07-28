import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { runProcessSession } from '../src/harness/processSession.js'
import type { RunEventType } from '../src/types.js'

describe('CLI process event delivery', () => {
  it('flushes parsed stdout in order before the process completion event', async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), 'opensaddle-process-events-'))
    const events: Array<{ type: RunEventType; text?: string; tool?: unknown }> = []
    const controller = new AbortController()

    try {
      const result = await runProcessSession({
        command: process.execPath,
        args: ['-e', 'console.log("first"); console.log("second")'],
        cwd: sessionRoot,
        signal: controller.signal,
        sessionRoot,
        emit: async (type, payload) => {
          events.push({
            type,
            text: typeof payload.text === 'string' ? payload.text : undefined,
            tool: payload.tool,
          })
        },
        onStdoutLine: async (line) => {
          // Without serialized flushing, the second line and cli.spawn
          // completion overtake this deliberately slower first line.
          if (line === 'first') await new Promise((resolve) => setTimeout(resolve, 25))
          return `${line}\n`
        },
      })

      assert.equal(result.exitCode, 0)
      assert.deepEqual(events.map((event) => [event.type, event.text, event.tool]), [
        ['tool.requested', undefined, 'cli.spawn'],
        ['agent.output.delta', 'first\n', undefined],
        ['agent.output.delta', 'second\n', undefined],
        ['tool.completed', undefined, 'cli.spawn'],
      ])
    } finally {
      await rm(sessionRoot, { recursive: true, force: true })
    }
  })
})
