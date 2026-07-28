import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isRecoverableRuntimeRun,
  runtimeRunToAgentBlock,
  selectOrphanedRuntimeRuns,
  selectThreadLinkedRuntimeRuns,
} from '../../../src/features/runs/recovery.js'
import {
  agentRunLifecycleControls,
  runtimeRunLifecycleControls,
} from '../../../src/features/runs/lifecycleControls.js'
import { appendTranscript } from '../../../src/features/runs/transcript.js'
import { createOrderedEventEmitter } from '../../../src/services/orderedEvents.js'
import { shouldStopRunReconciliation } from '../../../src/services/opensaddleClient.js'
import { buildPlanRevision } from '../../../src/features/thread/planRevision.js'
import type { RuntimeRunSummary, SessionEvent } from '../../../src/services/contracts.js'
import { applyRunEvent } from '../../../src/lib/runEvents.js'
import { adoptNativeContinuation } from '../../../src/lib/nativeContinuation.js'
import {
  clampInspectorWidth,
  parseThreadInspectorState,
  selectInspectorAttention,
} from '../../../src/features/thread/inspectorState.js'
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

function runtimeRun(status: RuntimeRunSummary['status']): RuntimeRunSummary {
  return {
    runId: 'run-recovered',
    sessionId: 'session-recovered',
    projectId: 'project-local',
    threadId: 'thread-durable',
    sourceMessageId: 'message-source',
    task: 'Continue the durable task',
    status,
    route: {
      modelKey: 'gpt',
      modelId: 'gpt-5.6',
      harnessKey: 'coding',
      providerKey: 'codex',
      runtimeKey: 'local',
      reasons: ['test'],
      cost: 'CLI provider metering',
    },
    providerSessionId: 'thread-native-123',
    providerSessionMode: 'resume',
    providerTurnId: 'turn-native-4',
    executionMode: 'project',
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('durable client event handling', () => {
  it('stops reconciling terminal and expired runs', () => {
    assert.equal(shouldStopRunReconciliation(404), true)
    assert.equal(shouldStopRunReconciliation(410), true)
    assert.equal(shouldStopRunReconciliation(200, 'completed'), true)
    assert.equal(shouldStopRunReconciliation(200, 'failed'), true)
    assert.equal(shouldStopRunReconciliation(200, 'cancelled'), true)
    assert.equal(shouldStopRunReconciliation(200, 'running'), false)
    assert.equal(shouldStopRunReconciliation(503), false)
  })

  it('shows only lifecycle controls supported by the active harness state', () => {
    const codex = runtimeRun('running')
    assert.deepEqual(runtimeRunLifecycleControls(codex), {
      canPause: false,
      canResume: false,
      canStop: true,
      canRetry: false,
    })
    const claude = {
      ...codex,
      route: { ...codex.route, providerKey: 'claude' as const },
    }
    assert.equal(runtimeRunLifecycleControls(claude).canPause, true)
    assert.deepEqual(runtimeRunLifecycleControls({ ...claude, status: 'queued' }), {
      canPause: false,
      canResume: false,
      canStop: true,
      canRetry: false,
    })
    assert.deepEqual(runtimeRunLifecycleControls({ ...claude, status: 'completed' }), {
      canPause: false,
      canResume: false,
      canStop: false,
      canRetry: true,
    })
  })

  it('keeps waiting and timed-out durable runs truthful after hydration', () => {
    const waiting = runtimeRunToAgentBlock(runtimeRun('awaiting_input'))
    assert.equal(waiting.statusText, 'Waiting for your answer')
    assert.equal(waiting.done, false)
    assert.equal(agentRunLifecycleControls(waiting).canPause, false)
    assert.equal(agentRunLifecycleControls(waiting).canStop, true)

    const timedOut = runtimeRunToAgentBlock(runtimeRun('timed_out'))
    assert.equal(timedOut.statusText, 'Timed out')
    assert.equal(timedOut.done, true)
    assert.equal(timedOut.failure?.title, 'The run timed out')
    assert.equal(agentRunLifecycleControls(timedOut).canRetry, true)
  })

  it('turns edited plan lines into bounded same-turn steering guidance', () => {
    const revision = buildPlanRevision('  - Inspect the existing flow  \n\n* Add coverage\nVerify the result')
    assert.deepEqual(revision?.steps, [
      'Inspect the existing flow',
      'Add coverage',
      'Verify the result',
    ])
    assert.equal(
      revision?.prompt,
      'Revise the active task plan to follow these steps:\n- Inspect the existing flow\n- Add coverage\n- Verify the result',
    )
    assert.equal(buildPlanRevision(' \n '), undefined)
  })

  it('keeps lifecycle activity out of the provider-authored task plan', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      kind: 'coding',
      title: 'Coding run',
      model: 'Codex',
      harness: 'Codex',
      runtime: 'Local',
      statusText: 'Starting',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const started = applyRunEvent(initial, {
      ...event(0),
      type: 'agent.started',
      payload: { provider: 'codex' },
    })
    const working = applyRunEvent(started, {
      ...event(1),
      type: 'agent.output.delta',
      payload: { status: 'Inspecting repository' },
    })

    assert.deepEqual(working.plan, [])
    assert.equal(working.statusText, 'Inspecting repository')
    assert.equal(working.activity?.at(-1)?.label, 'Inspecting repository')

    const planned = applyRunEvent(working, {
      ...event(2),
      type: 'plan.updated',
      payload: {
        plan: [
          { step: 'Inspect context', status: 'completed' },
          { step: 'Incorporate user revision', status: 'inProgress' },
          { step: 'Report result', status: 'pending' },
        ],
      },
    })
    assert.deepEqual(planned.plan, [
      { label: 'Inspect context', status: 'done' },
      { label: 'Incorporate user revision', status: 'active' },
      { label: 'Report result', status: 'pending' },
    ])
  })

  it('keeps thread inspectors quiet by default and prioritizes actionable evidence', () => {
    assert.deepEqual(parseThreadInspectorState(undefined), {
      open: false,
      tab: 'overview',
      width: 292,
    })
    assert.equal(clampInspectorWidth(100), 260)
    assert.equal(clampInspectorWidth(800), 520)

    const run: AgentRunBlock = {
      id: 'run-attention',
      kind: 'coding',
      title: 'Coding run',
      model: 'Codex',
      harness: 'Codex',
      runtime: 'Local',
      statusText: 'Waiting for approval',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
      inputRequest: {
        kind: 'approval',
        id: 'approval-1',
        prompt: 'Allow network access?',
      },
    }
    assert.deepEqual(selectInspectorAttention({
      run,
      failedChecks: ['Typecheck'],
      changedPaths: ['src/app.ts'],
    }), {
      key: 'approval:approval-1',
      tab: 'access',
    })
    assert.deepEqual(selectInspectorAttention({
      run: { ...run, inputRequest: undefined, done: true },
      failedChecks: ['Typecheck'],
      changedPaths: ['src/app.ts'],
    }), {
      key: 'checks:Typecheck',
      tab: 'checks',
    })
    assert.deepEqual(selectInspectorAttention({
      run: {
        ...run,
        inputRequest: undefined,
        done: true,
        failure: {
          kind: 'authentication',
          title: 'Codex needs sign-in',
          message: 'The native session could not authenticate.',
          recovery: 'Sign in and retry.',
          retryable: true,
        },
      },
      failedChecks: [],
      changedPaths: ['src/app.ts'],
    }), {
      key: 'failure:run-attention:authentication',
      tab: 'activity',
    })
    assert.deepEqual(selectInspectorAttention({
      run: undefined,
      failedChecks: [],
      changedPaths: ['src/app.ts'],
    }), {
      key: 'changes:src/app.ts',
      tab: 'changes',
    })
  })

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

  it('keeps resolved and checkpoint-cancelled harness interactions as durable evidence', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      kind: 'coding',
      title: 'Coding run',
      model: 'Codex',
      harness: 'Codex',
      runtime: 'Local',
      statusText: 'Working',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const requested = applyRunEvent(initial, {
      ...event(0),
      type: 'approval.requested',
      payload: {
        request_id: 'approval-1',
        prompt: 'Allow npm test?',
        detail: 'npm test',
        available_decisions: ['accept', 'acceptForSession', 'decline'],
      },
    })
    const allowed = applyRunEvent(requested, {
      ...event(1),
      type: 'approval.resolved',
      payload: { request_id: 'approval-1', allowed: true, scope: 'session' },
    })

    assert.equal(allowed.inputRequest, undefined)
    assert.equal(allowed.statusText, 'Approval granted')
    assert.equal(allowed.activity?.at(-1)?.label, 'Approval granted')
    assert.equal(allowed.activity?.at(-1)?.detail, 'Allowed for this session')

    const requestedAgain = applyRunEvent(allowed, {
      ...event(2),
      type: 'input.requested',
      payload: { request_id: 'question-1', prompt: 'Which release channel?' },
    })
    const recovered = applyRunEvent(requestedAgain, {
      ...event(3),
      type: 'agent.paused',
      payload: { reason: 'control_plane_restarted', resumable: true },
    })

    assert.equal(recovered.inputRequest, undefined)
    assert.equal(recovered.statusText, 'Paused · ready to resume')
    assert.match(recovered.activity?.at(-1)?.detail ?? '', /pending request will be reissued/)

    const steered = applyRunEvent(recovered, {
      ...event(4),
      type: 'user.input.submitted',
      payload: { kind: 'steer', text: 'Keep the patch limited to authentication.' },
    })
    assert.equal(steered.statusText, 'Guidance accepted')
    assert.equal(steered.activity?.at(-1)?.label, 'Guidance sent')
    assert.equal(steered.activity?.at(-1)?.detail, 'Keep the patch limited to authentication.')
  })

  it('attributes provider-native nested file changes to the visible run', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      kind: 'coding',
      title: 'Coding run',
      model: 'Claude',
      harness: 'Claude Code',
      runtime: 'Local',
      statusText: 'Working',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const changed = applyRunEvent(initial, {
      ...event(0),
      type: 'file.change.updated',
      payload: {
        item: {
          type: 'tool_use',
          name: 'Edit',
          input: { file_path: 'src/native-events.ts' },
        },
      },
    })

    assert.equal(changed.sources?.[0]?.label, 'src/native-events.ts')
    assert.equal(changed.activity?.[0]?.label, 'Changed src/native-events.ts')
  })

  it('folds structured runtime questions and clears them after submission', () => {
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
    const waiting = applyRunEvent(initial, {
      ...event(0),
      type: 'input.requested',
      payload: {
        request_id: 'codex:question-1',
        prompt: 'Choose a release channel',
        questions: [{
          id: 'release',
          header: 'Release channel',
          prompt: 'Where should I publish?',
          options: [{ label: 'Preview', description: 'Safe test deployment' }],
          multiSelect: true,
          allowOther: true,
        }],
      },
    })
    assert.equal(waiting.inputRequest?.id, 'codex:question-1')
    assert.equal(waiting.inputRequest?.questions?.[0]?.options?.[0]?.label, 'Preview')
    assert.equal(waiting.inputRequest?.questions?.[0]?.multiSelect, true)

    const continued = applyRunEvent(waiting, {
      ...event(1),
      type: 'user.input.submitted',
      payload: { request_id: 'codex:question-1', answer_count: 1 },
    })
    assert.equal(continued.inputRequest, undefined)
    assert.equal(continued.statusText, 'Continuing')
  })

  it('keeps native tools and command output visible in the conversation run card', () => {
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
    const commandStarted = applyRunEvent(initial, {
      ...event(0),
      type: 'command.started',
      payload: {
        item: {
          id: 'cmd-1',
          type: 'commandExecution',
          command: '/bin/zsh -lc "npm test"',
          status: 'inProgress',
        },
      },
    })
    const commandCompleted = applyRunEvent(commandStarted, {
      ...event(1),
      type: 'command.completed',
      payload: {
        item: {
          id: 'cmd-1',
          type: 'commandExecution',
          command: '/bin/zsh -lc "npm test"',
          status: 'completed',
          aggregatedOutput: '70 tests passed\n',
          exitCode: 0,
          durationMs: 1200,
        },
      },
    })
    const toolStarted = applyRunEvent(commandCompleted, {
      ...event(2),
      type: 'tool.requested',
      payload: { tool: 'read_file', tool_id: 'tool-1', args: { path: 'src/app.ts' } },
    })
    const toolCompleted = applyRunEvent(toolStarted, {
      ...event(3),
      type: 'tool.completed',
      payload: { tool: 'read_file', tool_id: 'tool-1', output: 'export {}' },
    })
    const housekeepingStarted = applyRunEvent(toolCompleted, {
      ...event(4),
      type: 'tool.requested',
      payload: { tool: 'runtime.provision', tool_id: 'housekeeping-1' },
    })
    const housekeepingCompleted = applyRunEvent(housekeepingStarted, {
      ...event(5),
      type: 'tool.completed',
      payload: { tool: 'runtime.provision', tool_id: 'housekeeping-1', status: 'completed' },
    })

    assert.equal(housekeepingCompleted.tools.length, 2)
    assert.equal(housekeepingCompleted.tools[0]?.name, '/bin/zsh -lc "npm test"')
    assert.equal(housekeepingCompleted.tools[0]?.output, '70 tests passed\n')
    assert.equal(housekeepingCompleted.tools[0]?.status, 'success')
    assert.equal(housekeepingCompleted.tools[0]?.duration, '1200ms')
    assert.deepEqual(housekeepingCompleted.artifacts[0]?.table?.rows, [
      ['Tests · npm test', 'pass', '1200ms'],
    ])
    assert.equal(housekeepingCompleted.activity?.find((item) => item.kind === 'check')?.label, 'Tests passed')
    assert.equal(housekeepingCompleted.tools[1]?.name, 'read_file')
    assert.match(housekeepingCompleted.tools[1]?.input ?? '', /src\/app\.ts/)
    assert.equal(housekeepingCompleted.tools[1]?.output, 'export {}')
  })

  it('promotes failed verification commands without treating ordinary shell commands as checks', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      kind: 'coding',
      title: 'Coding run',
      model: 'Claude',
      harness: 'Claude Code',
      runtime: 'Local',
      statusText: 'Working',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const failedTypecheck = applyRunEvent(initial, {
      ...event(0),
      type: 'command.completed',
      payload: {
        item: {
          id: 'cmd-1',
          command: 'pnpm run typecheck',
          status: 'failed',
          exitCode: 2,
          durationMs: 840,
        },
      },
    })
    const ordinaryCommand = applyRunEvent(failedTypecheck, {
      ...event(1),
      type: 'command.completed',
      payload: {
        item: {
          id: 'cmd-2',
          command: 'git status --short',
          status: 'completed',
          exitCode: 0,
        },
      },
    })
    const explicitVerification = applyRunEvent(ordinaryCommand, {
      ...event(2),
      type: 'verification.completed',
      payload: {
        checks: [{ name: 'Workspace clean', ok: true, duration: '12ms' }],
      },
    })

    assert.deepEqual(explicitVerification.artifacts[0]?.table?.rows, [
      ['Typecheck · pnpm run typecheck', 'fail', '840ms'],
      ['Workspace clean', 'pass', '12ms'],
    ])
    assert.equal(explicitVerification.artifacts[0]?.subtitle, 'Some checks failed')
    assert.equal(explicitVerification.activity?.filter((item) => item.kind === 'check').length, 2)
    assert.equal(explicitVerification.activity?.find((item) => item.kind === 'check')?.label, 'Typecheck failed')
  })

  it('shows provider-native checkpoint provenance in run activity', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      kind: 'coding',
      title: 'Coding run',
      model: 'Codex',
      harness: 'Coding',
      runtime: 'Local',
      statusText: 'Resuming',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const resumed = applyRunEvent(initial, {
      ...event(3),
      type: 'tool.completed',
      payload: {
        tool: 'codex.thread.resume',
        thread_id: 'thread-native-123',
        persistent: true,
      },
    })

    assert.equal(resumed.statusText, 'Codex thread resumed')
    assert.equal(resumed.activity?.at(-1)?.label, 'Codex thread resumed')
    assert.equal(resumed.activity?.at(-1)?.detail, 'thread-native-123')
  })

  it('adopts a forked provider session as the canonical next-turn session', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      providerSessionId: 'thread-source',
      providerSessionMode: 'fork',
      kind: 'coding',
      title: 'Forked coding run',
      model: 'Codex',
      harness: 'Codex',
      runtime: 'Local',
      statusText: 'Working',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const forked = applyRunEvent(initial, {
      ...event(3),
      type: 'tool.completed',
      payload: {
        tool: 'codex.thread.fork',
        source_thread_id: 'thread-source',
        thread_id: 'thread-child',
        persistent: true,
      },
    })

    assert.equal(forked.providerSessionId, 'thread-child')
    assert.equal(forked.providerSessionMode, 'resume')
    assert.equal(forked.statusText, 'Codex thread forked')

    const checkpointed = applyRunEvent(forked, {
      ...event(4),
      type: 'tool.completed',
      payload: {
        tool: 'codex.turn.completed',
        thread_id: 'thread-child',
        turn_id: 'turn-child-1',
        persistent: true,
      },
    })
    assert.equal(checkpointed.providerTurnId, 'turn-child-1')
    assert.equal(checkpointed.activity?.at(-1)?.label, 'Codex checkpoint saved')
  })

  it('creates ordinary task continuity from the first native provider session', () => {
    const created = adoptNativeContinuation({
      sessionId: 'thread-first',
      checkpointId: 'turn-first',
      provider: 'codex',
      sourcePath: '/workspace/project',
    })
    assert.deepEqual(created, {
      provider: 'codex',
      sessionId: 'thread-first',
      checkpointId: 'turn-first',
      sourcePath: '/workspace/project',
      authority: 'opensaddle_managed',
      mode: 'resume',
    })

    const advanced = adoptNativeContinuation({
      existing: {
        provider: 'claude',
        sessionId: 'source-session',
        sourcePath: '/native/session.jsonl',
        authority: 'hybrid',
        mode: 'fork',
      },
      sessionId: 'child-session',
      sourcePath: '/ignored',
    })
    assert.equal(advanced?.sessionId, 'child-session')
    assert.equal(advanced?.authority, 'hybrid')
    assert.equal(advanced?.sourcePath, '/native/session.jsonl')
    assert.equal(advanced?.mode, 'resume')
  })

  it('turns native harness failures into concise recovery guidance', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      kind: 'coding',
      title: 'Coding run',
      model: 'Codex',
      harness: 'Codex',
      runtime: 'Local',
      statusText: 'Working',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const failed = applyRunEvent(initial, {
      ...event(3),
      type: 'agent.failed',
      payload: { error: 'Codex login required before starting a thread' },
    })

    assert.equal(failed.done, true)
    assert.equal(failed.statusText, 'Codex needs sign-in')
    assert.equal(failed.failure?.kind, 'authentication')
    assert.equal(failed.failure?.retryable, true)
    assert.match(failed.failure?.recovery ?? '', /refresh harness availability/i)
  })

  it('persists native context usage and runtime warnings for the visible run', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      kind: 'coding',
      title: 'Coding run',
      model: 'Codex',
      harness: 'Codex',
      runtime: 'Local',
      statusText: 'Working',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const withUsage = applyRunEvent(initial, {
      ...event(3),
      type: 'usage.updated',
      payload: {
        tokenUsage: {
          total: {
            totalTokens: 43_754,
            inputTokens: 43_575,
            cachedInputTokens: 21_248,
            outputTokens: 179,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 258_400,
        },
      },
    })
    const warned = applyRunEvent(withUsage, {
      ...event(4),
      type: 'warning',
      payload: { severity: 'warning', message: 'Approaching a provider rate limit' },
    })

    assert.equal(warned.usage?.totalTokens, 43_754)
    assert.equal(warned.usage?.cachedInputTokens, 21_248)
    assert.equal(warned.usage?.contextWindow, 258_400)
    assert.equal(warned.usage?.contextPercent, 16.9)
    assert.equal(warned.warnings?.[0]?.message, 'Approaching a provider rate limit')
    assert.match(warned.activity?.[0]?.detail ?? '', /16.9%/)
  })

  it('keeps server-reported native CLI metering with the durable run', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      kind: 'coding',
      title: 'Coding run',
      model: 'Claude default',
      harness: 'Claude Code',
      runtime: 'Local desktop',
      statusText: 'Starting',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const created = applyRunEvent(initial, {
      ...event(0),
      type: 'session.created',
      payload: {
        mode: 'local',
        execution_mode: 'plan',
        route: { providerKey: 'claude', cost: 'CLI provider metering' },
      },
    })

    assert.equal(created.cost, 'CLI provider metering')
    assert.equal(created.statusText, 'Session ready · plan · local')
    assert.equal(created.executionMode, 'plan')
  })

  it('presents a restart-recovered run as a resumable checkpoint', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      kind: 'coding',
      title: 'Coding run',
      model: 'Codex default',
      harness: 'Codex',
      runtime: 'Local desktop',
      statusText: 'Working',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const recovered = applyRunEvent(initial, {
      ...event(4),
      type: 'agent.paused',
      payload: {
        reason: 'control_plane_restarted',
        runtime_id: 'runtime-1',
        resumable: true,
      },
    })

    assert.equal(recovered.done, false)
    assert.equal(recovered.statusText, 'Paused · ready to resume')
    assert.equal(recovered.activity?.at(-1)?.label, 'Run recovered after restart')
    assert.equal(recovered.activity?.at(-1)?.detail, 'Saved workspace and provider session retained')
  })

  it('reconstructs an orphaned server run as a native resumable conversation block', () => {
    const summary = runtimeRun('paused')
    assert.equal(isRecoverableRuntimeRun(summary), true)
    assert.equal(isRecoverableRuntimeRun(runtimeRun('completed')), false)
    assert.deepEqual(
      selectOrphanedRuntimeRuns(
        [summary, { ...runtimeRun('running'), runId: 'already-visible' }, runtimeRun('completed')],
        new Set(['already-visible']),
        new Set(['project-local']),
      ).map((run) => run.runId),
      ['run-recovered'],
    )
    assert.deepEqual(
      selectThreadLinkedRuntimeRuns(
        [summary, { ...runtimeRun('completed'), runId: 'completed-linked' }],
        new Set(['run-recovered']),
        new Set(['thread-durable']),
      ).map((run) => run.runId),
      ['completed-linked'],
    )

    const recovered = runtimeRunToAgentBlock(summary)
    assert.equal(recovered.id, 'run-recovered')
    assert.equal(recovered.done, false)
    assert.equal(recovered.statusText, 'Paused · ready to resume')
    assert.equal(recovered.harness, 'Codex')
    assert.equal(recovered.runtime, 'Local desktop')
    assert.equal(recovered.providerSessionId, 'thread-native-123')
    assert.equal(recovered.providerTurnId, 'turn-native-4')
    assert.equal(recovered.executionMode, 'project')
    assert.equal(recovered.cost, 'CLI provider metering')
    assert.equal(
      runtimeRunToAgentBlock({
        ...summary,
        route: { ...summary.route, nativeModelDefault: true },
      }).model,
      'Codex default',
    )
  })

  it('preserves resolved hunk state when the server refreshes the remaining diff', () => {
    const initial: AgentRunBlock = {
      id: 'run-1',
      executionMode: 'review',
      kind: 'coding',
      title: 'Review run',
      model: 'Codex default',
      harness: 'Codex',
      runtime: 'Local desktop',
      statusText: 'Starting',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const first = applyRunEvent(initial, {
      ...event(0),
      type: 'diff.updated',
      payload: {
        files: [{
          path: 'review.txt',
          patch: [
            'diff --git a/review.txt b/review.txt',
            '--- a/review.txt',
            '+++ b/review.txt',
            '@@ -1,2 +1,2 @@',
            '-before',
            '+after',
            ' context',
            '@@ -20,2 +20,2 @@',
            '-later before',
            '+later after',
            ' later context',
            '',
          ].join('\n'),
        }],
      },
    })
    first.artifacts[0]!.diff![0]!.hunks[0]!.status = 'accepted'

    const refreshed = applyRunEvent(first, {
      ...event(1),
      type: 'diff.updated',
      payload: {
        files: [{
          path: 'review.txt',
          patch: [
            'diff --git a/review.txt b/review.txt',
            '--- a/review.txt',
            '+++ b/review.txt',
            '@@ -1,2 +1,2 @@',
            '-before',
            '+after',
            ' context',
            '',
          ].join('\n'),
        }],
      },
    })

    assert.equal(refreshed.artifacts[0]?.diff?.[0]?.hunks[0]?.status, 'accepted')
  })
})
