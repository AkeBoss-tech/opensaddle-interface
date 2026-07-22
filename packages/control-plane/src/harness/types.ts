import type { RouteEstimate, RunEventType } from '../types.js'

/** Which implementation executes a coding (or CLI-backed) run. */
export type CodingProvider =
  | 'opensaddle'
  | 'codex'
  | 'claude'
  | 'cursor'
  | 'gemini'
  | 'opencode'
  | 'custom'

export type HarnessAvailability = 'available' | 'missing' | 'disabled'

export interface HarnessProfile {
  id: CodingProvider | string
  label: string
  /** Executable on PATH, or absolute path. Empty for native opensaddle. */
  command: string
  description: string
  kind: 'native' | 'cli'
  /** How the prompt is passed to the CLI. */
  promptMode: 'final_arg' | 'flag' | 'stdin' | 'native'
  promptFlag?: string
  /** Extra args before the prompt. */
  baseArgs?: string[]
  /** Args that enable structured/stream output when supported. */
  streamArgs?: string[]
  /** Optional cwd flag prefix, e.g. ["--cd"] → `--cd <workspace>`. */
  cwdArgs?: string[]
  /** Flag used to pass an explicit model id into the CLI (e.g. `--model`). */
  modelFlag?: string
  /**
   * Map OpenSaddle model keys → CLI-native model ids.
   * Missing keys fall back to the control-plane route's configured model name.
   */
  modelIds?: Partial<Record<'gpt' | 'claude' | 'sonnet' | 'gemini' | 'llama', string>>
  /** Capability requiring a human gate before this harness starts. */
  approvalPolicy?: 'none' | 'shell' | 'all'
  /** Env vars required for the CLI to be considered usable. */
  requiredEnv?: string[]
  /** Whether this profile participates in auto-routing for coding tasks. */
  codingAffinity: number
  supportsCancel: boolean
  supportsStreaming: boolean
}

export interface HarnessStatus {
  id: string
  label: string
  kind: 'native' | 'cli'
  availability: HarnessAvailability
  command?: string
  resolvedPath?: string
  description: string
  codingAffinity: number
  reason?: string
}

export interface HarnessEmit {
  (type: RunEventType, payload: Record<string, unknown>): Promise<void>
}

export interface HarnessRunInput {
  runId: string
  sessionId: string
  task: string
  projectId: string
  agentId?: string
  route: RouteEstimate
  workspacePath: string
  providerId: string
  signal: AbortSignal
  emit: HarnessEmit
}

export interface HarnessRunResult {
  summary: string
  exitCode?: number
  providerId: string
}

export interface HarnessAdapter {
  readonly id: string
  run(input: HarnessRunInput): Promise<HarnessRunResult>
}
