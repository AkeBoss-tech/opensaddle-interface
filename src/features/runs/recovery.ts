import type { RuntimeRunSummary } from '../../services/contracts'
import type { AgentRunBlock } from '../../types'

const PROVIDER_LABELS: Record<string, string> = {
  opensaddle: 'OpenSaddle',
  codex: 'Codex',
  claude: 'Claude Code',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  antigravity: 'Antigravity',
  custom: 'Project harness',
}

const RUNTIME_LABELS: Record<string, string> = {
  local: 'Local desktop',
  browser: 'Browser sandbox',
  sandbox: 'Cloud sandbox',
  vm: 'Project VM',
  gpu: 'GPU runtime',
  restricted: 'Restricted runtime',
}

export function isRecoverableRuntimeRun(run: RuntimeRunSummary): boolean {
  return run.status === 'queued'
    || run.status === 'provisioning'
    || run.status === 'running'
    || run.status === 'waiting'
    || run.status === 'awaiting_input'
    || run.status === 'paused'
}

export function selectOrphanedRuntimeRuns(
  runs: readonly RuntimeRunSummary[],
  representedRunIds: ReadonlySet<string>,
  projectIds: ReadonlySet<string>,
): RuntimeRunSummary[] {
  return runs.filter((run) =>
    isRecoverableRuntimeRun(run)
    && !representedRunIds.has(run.runId)
    && projectIds.has(run.projectId))
}

export function selectThreadLinkedRuntimeRuns(
  runs: readonly RuntimeRunSummary[],
  representedRunIds: ReadonlySet<string>,
  threadIds: ReadonlySet<string>,
): RuntimeRunSummary[] {
  return runs.filter((run) =>
    !representedRunIds.has(run.runId)
    && typeof run.threadId === 'string'
    && threadIds.has(run.threadId))
}

export function runtimeRunToAgentBlock(run: RuntimeRunSummary): AgentRunBlock {
  const provider = run.route.providerKey && run.route.providerKey !== 'auto'
    ? run.route.providerKey
    : run.route.harnessKey
  const providerLabel = PROVIDER_LABELS[provider] ?? provider
  const done = run.status === 'completed'
    || run.status === 'failed'
    || run.status === 'cancelled'
    || run.status === 'timed_out'
  const statusText = run.status === 'paused'
    ? 'Paused · ready to resume'
    : run.status === 'waiting' || run.status === 'awaiting_input'
      ? 'Waiting for your answer'
      : run.status === 'queued' && !!run.parentRunId
      ? 'Queued after current turn'
      : run.status === 'queued' || run.status === 'provisioning'
        ? 'Starting'
        : run.status === 'running'
          ? 'Working'
          : run.status === 'completed'
            ? 'Completed'
            : run.status === 'cancelled'
              ? 'Stopped'
              : run.status === 'timed_out'
                ? 'Timed out'
              : `${providerLabel} could not finish`

  return {
    id: run.runId,
    parentRunId: run.parentRunId ?? run.retryOfRunId,
    providerSessionId: run.providerSessionId,
    providerSessionMode: run.providerSessionMode,
    providerTurnId: run.providerTurnId,
    providerKey: run.route.providerKey,
    runtimeAttached: run.attached,
    executionMode: run.executionMode,
    kind: run.route.harnessKey === 'coding'
      ? 'coding'
      : run.route.harnessKey === 'research'
        ? 'research'
        : run.route.harnessKey === 'browser'
          ? 'browser'
          : 'ops',
    title: run.retryOfRunId ? `${providerLabel} retry` : `${providerLabel} run`,
    model: run.route.nativeModelDefault
      ? `${providerLabel} default`
      : run.route.modelId ?? run.route.modelKey,
    reasoningEffort: run.route.reasoningEffort,
    harness: providerLabel,
    runtime: RUNTIME_LABELS[run.route.runtimeKey] ?? run.route.runtimeKey,
    statusText,
    queuedTask: run.status === 'waiting' || run.status === 'queued' ? run.task : undefined,
    done,
    tools: [],
    plan: [],
    artifacts: [],
    activity: [],
    warnings: [],
    cost: run.route.cost,
    failure: run.status === 'failed'
      ? {
        kind: 'runtime',
        title: `${providerLabel} could not finish`,
        message: run.error ?? 'The harness stopped before completing the run.',
        recovery: 'Retry from the saved checkpoint after reviewing the last visible activity.',
        retryable: true,
      }
      : run.status === 'cancelled'
        ? {
          kind: 'interrupted',
          title: 'The run was stopped',
          message: 'This run was stopped before it completed.',
          recovery: 'Retry from the saved checkpoint when you are ready to continue.',
          retryable: true,
        }
        : run.status === 'timed_out'
          ? {
            kind: 'runtime',
            title: 'The run timed out',
            message: 'The harness exceeded its configured time limit.',
            recovery: 'Retry from the saved checkpoint when you are ready to continue.',
            retryable: true,
          }
          : undefined,
  }
}

export function reconcileDurableRunBlock(
  current: AgentRunBlock,
  durableRun: RuntimeRunSummary,
): AgentRunBlock {
  const durable = runtimeRunToAgentBlock(durableRun)
  return {
    ...current,
    parentRunId: durable.parentRunId ?? current.parentRunId,
    providerSessionId: durable.providerSessionId ?? current.providerSessionId,
    providerSessionMode: durable.providerSessionMode ?? current.providerSessionMode,
    providerTurnId: durable.providerTurnId ?? current.providerTurnId,
    providerKey: durable.providerKey ?? current.providerKey,
    runtimeAttached: durable.runtimeAttached,
    executionMode: durable.executionMode ?? current.executionMode,
    title: durableRun.retryOfRunId ? durable.title : current.title,
    statusText: durable.statusText,
    done: durable.done,
    failure: current.failure ?? durable.failure,
  }
}
