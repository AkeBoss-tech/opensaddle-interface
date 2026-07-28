import type { RuntimeRunSummary } from '../../services/contracts'
import type { AgentRunBlock } from '../../types'

export interface RunLifecycleControls {
  canPause: boolean
  canResume: boolean
  canStop: boolean
  canRetry: boolean
}

const TERMINAL_STATUSES = new Set<RuntimeRunSummary['status']>([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
])

function supportsProcessSignals(provider: string | undefined): boolean {
  return !/\bcodex\b/i.test(provider ?? '')
}

export function runtimeRunLifecycleControls(run: RuntimeRunSummary): RunLifecycleControls {
  const terminal = TERMINAL_STATUSES.has(run.status)
  const provider = run.route.providerKey && run.route.providerKey !== 'auto'
    ? run.route.providerKey
    : run.route.harnessKey
  const signalCapable = supportsProcessSignals(provider)
  return {
    canPause: run.status === 'running' && signalCapable,
    canResume: run.status === 'paused' && signalCapable,
    canStop: !terminal,
    canRetry: terminal,
  }
}

export function agentRunLifecycleControls(run: AgentRunBlock): RunLifecycleControls {
  const paused = /^Paused\b/i.test(run.statusText)
  const waiting = /^(?:Queued|Starting|Waiting)\b/i.test(run.statusText)
  const signalCapable = supportsProcessSignals(run.harness)
  return {
    canPause: !run.done && !paused && !waiting && signalCapable,
    canResume: !run.done && paused && signalCapable,
    canStop: !run.done,
    canRetry: run.done,
  }
}
