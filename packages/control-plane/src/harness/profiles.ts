import type { HarnessProfile } from './types.js'

/**
 * Built-in harness profiles.
 *
 * Pattern borrowed from KRAIL runner profiles (command + prompt wiring) and
 * T3 Code provider drivers (one adapter per CLI, shared process session).
 */
export const BUILTIN_PROFILES: HarnessProfile[] = [
  {
    id: 'opensaddle',
    label: 'OpenSaddle coding agent',
    command: '',
    description: 'Native harness: model gateway + workspace tools (read/write/shell) inside the provisioned runtime.',
    kind: 'native',
    promptMode: 'native',
    codingAffinity: 1,
    supportsCancel: true,
    supportsStreaming: true,
  },
  {
    id: 'codex',
    label: 'Codex App Server',
    command: 'codex',
    description: 'OpenAI Codex app-server over stdio JSONL with streamed thread and turn events.',
    kind: 'cli',
    protocol: 'codex-app-server',
    promptMode: 'final_arg',
    baseArgs: ['exec', '--skip-git-repo-check', '--json', '--sandbox', 'workspace-write'],
    cwdArgs: ['--cd'],
    modelFlag: '--model',
    modelIds: {
      gpt: 'gpt-5.4',
      claude: 'gpt-5.4',
      sonnet: 'gpt-5.3-codex',
      gemini: 'gpt-5.3-codex-spark',
      llama: 'gpt-5.3-codex-mini',
    },
    approvalPolicy: 'none',
    codingAffinity: 0.95,
    supportsCancel: true,
    supportsStreaming: true,
  },
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    description: 'Anthropic Claude Code CLI in print mode.',
    kind: 'cli',
    promptMode: 'final_arg',
    baseArgs: ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    modelFlag: '--model',
    modelIds: {
      gpt: 'sonnet',
      claude: 'opus',
      sonnet: 'sonnet',
      gemini: 'haiku',
      llama: 'haiku',
    },
    approvalPolicy: 'shell',
    codingAffinity: 0.92,
    supportsCancel: true,
    supportsStreaming: true,
  },
  {
    id: 'cursor',
    label: 'Cursor Agent',
    command: 'cursor-agent',
    description: 'Cursor agent CLI.',
    kind: 'cli',
    promptMode: 'final_arg',
    modelFlag: '--model',
    modelIds: {
      gpt: 'gpt-5.4',
      claude: 'claude-opus-4',
      sonnet: 'claude-sonnet-4',
      gemini: 'gemini-2.5-pro',
      llama: 'gpt-5.4-mini',
    },
    codingAffinity: 0.9,
    supportsCancel: true,
    supportsStreaming: false,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    description: 'Google Gemini CLI with stream-json output.',
    kind: 'cli',
    promptMode: 'flag',
    promptFlag: '--prompt',
    baseArgs: ['--output-format', 'stream-json', '--approval-mode', 'yolo'],
    cwdArgs: ['--include-directories'],
    modelFlag: '--model',
    modelIds: {
      gpt: 'gemini-2.5-pro',
      claude: 'gemini-2.5-pro',
      sonnet: 'gemini-2.5-flash',
      gemini: 'gemini-2.5-pro',
      llama: 'gemini-2.5-flash-lite',
    },
    codingAffinity: 0.8,
    supportsCancel: true,
    supportsStreaming: true,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    description: 'OpenCode CLI.',
    kind: 'cli',
    promptMode: 'final_arg',
    baseArgs: ['run'],
    modelFlag: '--model',
    modelIds: {
      gpt: 'openai/gpt-5.4',
      claude: 'anthropic/claude-opus-4',
      sonnet: 'anthropic/claude-sonnet-4',
      gemini: 'google/gemini-2.5-pro',
      llama: 'meta/llama-4',
    },
    codingAffinity: 0.85,
    supportsCancel: true,
    supportsStreaming: false,
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    command: 'antigravity',
    description: 'Antigravity agent CLI using its configured account and model router.',
    kind: 'cli',
    promptMode: 'final_arg',
    approvalPolicy: 'none',
    codingAffinity: 0.78,
    supportsCancel: true,
    supportsStreaming: false,
  },
]

export function mergeProfiles(overrides: HarnessProfile[]): HarnessProfile[] {
  const byId = new Map(BUILTIN_PROFILES.map((p) => [p.id, p]))
  for (const profile of overrides) {
    const existing = byId.get(profile.id)
    byId.set(profile.id, existing ? { ...existing, ...profile } : profile)
  }
  return [...byId.values()]
}
