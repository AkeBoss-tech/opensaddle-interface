import type { HarnessExecutionPolicy, RouteEstimate, RunEventType } from '../types.js'

/** Which implementation executes a coding (or CLI-backed) run. */
export type CodingProvider =
  | 'opensaddle'
  | 'codex'
  | 'claude'
  | 'cursor'
  | 'gemini'
  | 'opencode'
  | 'antigravity'
  | 'custom'

export type HarnessAvailability = 'available' | 'missing' | 'disabled'

export interface HarnessProfile {
  id: CodingProvider | string
  label: string
  /** Executable on PATH, or absolute path. Empty for native opensaddle. */
  command: string
  description: string
  kind: 'native' | 'cli'
  /** Optional provider protocol. Codex's rich-client integration uses app-server JSONL. */
  protocol?: 'cli' | 'codex-app-server' | 'acp'
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

export interface HarnessInteractionQuestion {
  id: string
  header?: string
  prompt: string
  options?: Array<{ label: string; description?: string }>
  allowOther?: boolean
  secret?: boolean
}

export interface HarnessInteractionRequest {
  id: string
  kind: 'approval' | 'input'
  method: string
  prompt: string
  detail?: string
  questions?: HarnessInteractionQuestion[]
  availableDecisions?: string[]
  metadata?: Record<string, unknown>
}

export interface HarnessInteractionResponse {
  approved?: boolean
  scope?: 'once' | 'session'
  text?: string
  answers?: Record<string, string[]>
  form?: Record<string, unknown>
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
  /** Provider-native durable conversation identifier used for exact resume. */
  providerSessionId?: string
  providerSessionMode?: 'resume' | 'fork'
  providerTurnId?: string
  profile?: HarnessProfile
  executionPolicy?: HarnessExecutionPolicy
  signal: AbortSignal
  emit: HarnessEmit
  requestInteraction?: (request: HarnessInteractionRequest) => Promise<HarnessInteractionResponse>
}

export interface HarnessRunResult {
  summary: string
  exitCode?: number
  providerId: string
  /** The adapter already streamed this summary into agent.output.delta events. */
  outputAlreadyEmitted?: boolean
}

export interface HarnessAdapter {
  readonly id: string
  run(input: HarnessRunInput): Promise<HarnessRunResult>
  /** Inject user guidance into the currently active native turn when supported. */
  steer?(runId: string, text: string): Promise<boolean>
}
