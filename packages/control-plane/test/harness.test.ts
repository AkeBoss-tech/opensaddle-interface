import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeCliLine } from '../src/harness/normalizers.js'
import { BUILTIN_PROFILES } from '../src/harness/profiles.js'
import { buildArgs, emitStructuredCliEvent } from '../src/harness/cliAdapter.js'
import { which } from '../src/harness/index.js'
import { estimateRoute, selectReadyCodingProvider } from '../src/router.js'
import { containsUnsupportedToolCall } from '../src/modelGateway.js'
import {
  codexForkCheckpoint,
  codexInteractionDeniedByPolicy,
  codexInteractionRequest,
  codexInteractionResult,
  codexSandboxMode,
  codexThreadConfig,
  mergeCodexMessage,
} from '../src/harness/codexAppServer.js'
import type { ControlPlaneConfig } from '../src/config.js'
import type { HarnessEmit } from '../src/harness/types.js'

function testConfig(overrides: Partial<ControlPlaneConfig> = {}): ControlPlaneConfig {
  return {
    mode: 'local',
    host: '127.0.0.1',
    port: 8765,
    dataDir: '/tmp/opensaddle-test',
    workspaceDir: '/tmp/opensaddle-test/workspaces',
    corsOrigins: ['http://localhost:5173'],
    apiKeys: new Map(),
    bootstrapAdminId: 'user-ad',
    modelRoutes: {
      gpt: { baseUrl: 'http://127.0.0.1:9/v1', model: 'test' },
      claude: { baseUrl: 'http://127.0.0.1:9/v1', model: 'test-claude' },
    },
    defaultModel: 'gpt',
    defaultCodingProvider: 'opensaddle',
    codingProviders: ['opensaddle', 'codex', 'claude', 'cursor', 'gemini', 'opencode'],
    harnessProfiles: [],
    runtimeProvider: 'local',
    dockerImage: 'node:22-alpine',
    runtimeTtlMs: 3_600_000,
    allowedRepoRoots: ['/tmp'],
    maxConcurrentRuns: 4,
    modelProvider: 'openai-compatible',
    ...overrides,
  }
}

describe('coding harness routing', () => {
  it('selects coding harness + default provider for code tasks', () => {
    const route = estimateRoute('Please refactor this TypeScript module and add tests', testConfig())
    assert.equal(route.harnessKey, 'coding')
    assert.equal(route.providerKey, 'opensaddle')
    assert.ok(route.reasons.some((r) => /Coding/.test(r)))
  })

  it('routes file inspection through the coding harness', () => {
    const route = estimateRoute('Inspect package.json and report the package name', testConfig())
    assert.equal(route.harnessKey, 'coding')
    assert.equal(estimateRoute('Inspect vite.config.ts and report the base path', testConfig()).harnessKey, 'coding')
  })

  it('honors an explicit provider override', () => {
    const route = estimateRoute('fix a bug in the repo', testConfig(), { providerKey: 'codex', modelKey: 'sonnet' })
    assert.equal(route.harnessKey, 'coding')
    assert.equal(route.providerKey, 'codex')
    assert.equal(route.modelKey, 'sonnet')
  })

  it('selects the first configured ready provider when the preferred harness is unavailable', () => {
    const selected = selectReadyCodingProvider(
      'opensaddle',
      ['opensaddle', 'codex', 'claude'],
      [
        { id: 'opensaddle', availability: 'available', readiness: 'unavailable' },
        { id: 'codex', availability: 'available', readiness: 'ready' },
        { id: 'claude', availability: 'available', readiness: 'ready' },
      ],
    )
    assert.equal(selected, 'codex')
  })

  it('keeps a ready preferred coding provider', () => {
    const selected = selectReadyCodingProvider(
      'claude',
      ['opensaddle', 'codex', 'claude'],
      [
        { id: 'codex', availability: 'available', readiness: 'ready' },
        { id: 'claude', availability: 'available', readiness: 'ready' },
      ],
    )
    assert.equal(selected, 'claude')
  })

  it('optimizes model by task complexity', () => {
    const cfg = testConfig({
      modelRoutes: {
        gpt: { baseUrl: 'http://127.0.0.1:9/v1', model: 'test' },
        claude: { baseUrl: 'http://127.0.0.1:9/v1', model: 'test-claude' },
        sonnet: { baseUrl: 'http://127.0.0.1:9/v1', model: 'test-sonnet' },
      },
    })
    const hard = estimateRoute('Refactor the auth architecture and migrate concurrency', cfg)
    assert.equal(hard.harnessKey, 'coding')
    assert.equal(hard.modelKey, 'claude')
    assert.ok(hard.reasons.some((r) => /Complex coding/.test(r)))
    const easy = estimateRoute('Fix a typo in the README comments', cfg)
    assert.equal(easy.harnessKey, 'coding')
    assert.equal(easy.modelKey, 'sonnet')
    assert.ok(easy.reasons.some((r) => /Narrow coding/.test(r)))
  })

  it('maps model keys into CLI --model args for Codex', async () => {
    const { buildArgs } = await import('../src/harness/cliAdapter.js')
    const { BUILTIN_PROFILES } = await import('../src/harness/profiles.js')
    const codex = BUILTIN_PROFILES.find((p) => p.id === 'codex')!
    const args = buildArgs(codex, 'fix the bug', '/tmp/ws', 'gpt-5.4')
    assert.ok(args.includes('--model'))
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-5.4')
  })

  it('maps local Claude permissions into native CLI controls', async () => {
    const { buildArgs } = await import('../src/harness/cliAdapter.js')
    const claude = BUILTIN_PROFILES.find((profile) => profile.id === 'claude')!
    const args = buildArgs(claude, 'fix the bug', '/tmp/ws', undefined, {
      sandbox: 'full-access',
      approvals: 'never',
      network: true,
      allowedTools: ['Bash', 'Edit'],
      deniedTools: ['WebFetch'],
    })
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions')
    assert.ok(args.includes('--dangerously-skip-permissions'))
    assert.ok(args.includes('--allowedTools'))
    assert.ok(args.includes('Bash,Edit'))
    assert.ok(args.includes('--disallowedTools'))
    assert.ok(args.includes('WebFetch'))
  })

  it('lets Claude prepare edits inside its review workspace without bypassing permissions', () => {
    const claude = BUILTIN_PROFILES.find((profile) => profile.id === 'claude')!
    const args = buildArgs(claude, 'fix the bug', '/tmp/ws', undefined, {
      sandbox: 'workspace-write',
      approvals: 'on-request',
      network: false,
      allowedTools: [],
      deniedTools: [],
    })
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits')
    assert.equal(args.includes('--dangerously-skip-permissions'), false)
  })

  it('keeps Cursor full-access edits sandboxed when Network is disabled', () => {
    const cursor = BUILTIN_PROFILES.find((profile) => profile.id === 'cursor')!
    const args = buildArgs(cursor, 'fix the bug', '/tmp/ws', undefined, {
      sandbox: 'full-access',
      approvals: 'never',
      network: false,
      allowedTools: [],
      deniedTools: [],
    })
    assert.ok(args.includes('--force'))
    assert.equal(args[args.indexOf('--sandbox') + 1], 'enabled')
  })

  it('resumes a durable Claude session when one is available', async () => {
    const { buildArgs } = await import('../src/harness/cliAdapter.js')
    const claude = BUILTIN_PROFILES.find((profile) => profile.id === 'claude')!
    const args = buildArgs(claude, 'continue', '/tmp/ws', 'opus', undefined, 'session-123')
    assert.equal(args[args.indexOf('--resume') + 1], 'session-123')
  })

  it('forks a durable Claude session without mutating the source conversation', async () => {
    const { buildArgs } = await import('../src/harness/cliAdapter.js')
    const claude = BUILTIN_PROFILES.find((profile) => profile.id === 'claude')!
    const args = buildArgs(claude, 'branch the work', '/tmp/ws', 'opus', undefined, 'session-123', 'fork')
    assert.equal(args[args.indexOf('--resume') + 1], 'session-123')
    assert.ok(args.includes('--fork-session'))
  })

  it('does not duplicate Claude partial output when the final message repeats it', async () => {
    const { mergeCliText } = await import('../src/harness/cliAdapter.js')
    assert.deepEqual(mergeCliText('hello', 'hello'), { output: 'hello', delta: '' })
    assert.deepEqual(mergeCliText('hello', 'hello world'), { output: 'hello world', delta: ' world' })
  })

  it('biases Auto toward routes with better observed outcomes', () => {
    const cfg = testConfig({
      modelRoutes: {
        gpt: { baseUrl: 'http://127.0.0.1:9/v1', model: 'test' },
        sonnet: { baseUrl: 'http://127.0.0.1:9/v1', model: 'test-sonnet' },
      },
    })
    const telemetry = Array.from({ length: 4 }, (_, index) => ({
      id: `t-${index}`,
      projectId: 'project-1',
      modelKey: 'sonnet' as const,
      providerKey: 'codex' as const,
      harnessKey: 'coding' as const,
      runtimeKey: 'local' as const,
      succeeded: true,
      durationMs: 800,
      createdAt: index,
    }))
    const route = estimateRoute('Implement the requested repository change', cfg, { telemetry })
    assert.equal(route.modelKey, 'sonnet')
    assert.equal(route.providerKey, 'codex')
    assert.ok(route.reasons.some((reason) => /Auto learned/.test(reason)))
  })
})

describe('model response safety', () => {
  it('detects unsupported provider tool-call control tokens', () => {
    assert.equal(containsUnsupportedToolCall('<|tool_call>_call:research:list_files{}<tool_call|>'), true)
    assert.equal(containsUnsupportedToolCall('A normal research answer.'), false)
  })
})

describe('Codex app-server transcript merging', () => {
  it('selects native thread resume when a provider session is available', async () => {
    const { codexThreadOpenMethod } = await import('../src/harness/codexAppServer.js')
    assert.equal(codexThreadOpenMethod(), 'thread/start')
    assert.equal(codexThreadOpenMethod('thread_123'), 'thread/resume')
    assert.equal(codexThreadOpenMethod('thread_123', 'fork'), 'thread/fork')
    assert.deepEqual(codexForkCheckpoint('fork', 'turn_123'), { lastTurnId: 'turn_123' })
    assert.deepEqual(codexForkCheckpoint('resume', 'turn_123'), {})
  })

  it('adds a final agent message after an earlier streaming preamble', () => {
    const merged = mergeCodexMessage('I’ll inspect the file.', 'The package name is opensaddle-interface.')
    assert.equal(merged.output, 'I’ll inspect the file.\n\nThe package name is opensaddle-interface.')
    assert.equal(merged.delta, '\n\nThe package name is opensaddle-interface.')
  })

  it('does not duplicate a cumulative final snapshot', () => {
    const merged = mergeCodexMessage('Hello', 'Hello world')
    assert.equal(merged.output, 'Hello world')
    assert.equal(merged.delta, ' world')
  })

  it('maps native command approval requests and session decisions', () => {
    const request = codexInteractionRequest({
      id: 17,
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'npm test',
        cwd: '/tmp/project',
        reason: 'Run the verification suite',
      },
    })
    assert.deepEqual(request, {
      id: 'codex:17',
      kind: 'approval',
      method: 'item/commandExecution/requestApproval',
      prompt: 'Run the verification suite',
      detail: 'npm test\n/tmp/project',
      availableDecisions: ['accept', 'acceptForSession', 'decline'],
      metadata: { command: 'npm test', cwd: '/tmp/project' },
    })
    assert.deepEqual(
      codexInteractionResult(request!.method, { approved: true, scope: 'session' }),
      { decision: 'acceptForSession' },
    )
    assert.deepEqual(
      codexInteractionResult(request!.method, { approved: false }),
      { decision: 'decline' },
    )
  })

  it('translates task capabilities into supported Codex thread controls', () => {
    assert.deepEqual(codexThreadConfig({
      sandbox: 'workspace-write',
      approvals: 'on-request',
      network: false,
      allowedTools: [],
      deniedTools: [
        'mcp__browser__*',
        'mcp__chrome__*',
        'mcp__opensaddle__create_vm',
        'spawn_agent',
      ],
    }), {
      sandbox_workspace_write: { network_access: false },
      web_search: 'disabled',
      features: { multi_agent: false },
    })
    assert.equal(codexSandboxMode({
      sandbox: 'full-access',
      approvals: 'never',
      network: false,
      allowedTools: [],
      deniedTools: [],
    }), 'workspace-write')
    assert.equal(codexSandboxMode({
      sandbox: 'full-access',
      approvals: 'never',
      network: true,
      allowedTools: [],
      deniedTools: [],
    }), 'danger-full-access')
  })

  it('rejects Codex network permission escalation when Network is disabled', () => {
    const policy = {
      sandbox: 'workspace-write' as const,
      approvals: 'on-request' as const,
      network: false,
      allowedTools: [],
      deniedTools: [],
    }
    assert.equal(codexInteractionDeniedByPolicy({
      id: 18,
      method: 'item/permissions/requestApproval',
      params: { permissions: { network: { enabled: true } } },
    }, policy), 'Network is disabled for this task')
    assert.equal(codexInteractionDeniedByPolicy({
      id: 19,
      method: 'item/fileChange/requestApproval',
      params: { grantRoot: '/tmp/project' },
    }, policy), undefined)
  })

  it('maps native user questions and structured answers', () => {
    const params = {
      questions: [{
        id: 'release',
        header: 'Release channel',
        question: 'Where should I publish?',
        options: [{ label: 'Preview', description: 'Safe test deployment' }],
        isOther: true,
        isSecret: false,
      }],
    }
    const request = codexInteractionRequest({
      id: 'question-1',
      method: 'item/tool/requestUserInput',
      params,
    })
    assert.equal(request?.id, 'codex:question-1')
    assert.deepEqual(request?.questions, [{
      id: 'release',
      header: 'Release channel',
      prompt: 'Where should I publish?',
      options: [{ label: 'Preview', description: 'Safe test deployment' }],
      allowOther: true,
      secret: false,
    }])
    assert.deepEqual(
      codexInteractionResult(request!.method, { answers: { release: ['Preview'] } }, params),
      { answers: { release: { answers: ['Preview'] } } },
    )
  })
})

describe('CLI line normalizers', () => {
  it('extracts claude stream-json assistant text', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ text: 'Hello from Claude' }] },
    })
    assert.equal(normalizeCliLine('claude', line), 'Hello from Claude')
  })

  it('drops claude lifecycle metadata instead of leaking JSON into the transcript', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      cwd: '/tmp/workspace',
      tools: ['Read', 'Write'],
    })
    assert.equal(normalizeCliLine('claude', line), undefined)
  })

  it('passes through plain stdout', () => {
    assert.equal(normalizeCliLine('cursor', 'running tests...'), 'running tests...\n')
  })

  it('extracts Cursor stream-json assistant and result text', () => {
    assert.equal(normalizeCliLine('cursor', JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello from Cursor' }] },
    })), 'Hello from Cursor')
    assert.equal(normalizeCliLine('cursor', JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Cursor finished',
    })), 'Cursor finished')
  })

  it('preserves token deltas without inserting whitespace', () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { text: ' next' },
    })
    assert.equal(normalizeCliLine('claude', line), ' next')
  })
})

describe('builtin harness profiles', () => {
  it('includes the native opensaddle coding agent', () => {
    const native = BUILTIN_PROFILES.find((p) => p.id === 'opensaddle')
    assert.ok(native)
    assert.equal(native?.kind, 'native')
  })

  it('can resolve node on PATH via which()', () => {
    const path = which('node')
    assert.ok(path)
  })

  it('defines per-harness approval policies', () => {
    assert.equal(BUILTIN_PROFILES.find((profile) => profile.id === 'codex')?.approvalPolicy, 'none')
    assert.equal(BUILTIN_PROFILES.find((profile) => profile.id === 'claude')?.approvalPolicy, 'none')
    assert.equal(BUILTIN_PROFILES.find((profile) => profile.id === 'gemini')?.approvalPolicy, 'none')
  })

  it('configures Cursor for structured headless streaming and policy-aware resume', () => {
    const cursor = BUILTIN_PROFILES.find((profile) => profile.id === 'cursor')!
    const args = buildArgs(cursor, 'Fix the test', '/tmp/workspace', undefined, {
      sandbox: 'workspace-write',
      approvals: 'on-request',
      network: false,
      allowedTools: [],
      deniedTools: [],
    }, 'cursor-session-1')

    assert.deepEqual(args, [
      '--print', '--output-format', 'stream-json', '--stream-partial-output', '--trust',
      '--workspace', '/tmp/workspace',
      '--resume', 'cursor-session-1',
      'Fix the test',
      '--sandbox', 'enabled',
    ])
  })

  it('keeps stdin harness prompts out of argv', () => {
    const stdinProfile = {
      ...BUILTIN_PROFILES.find((profile) => profile.id === 'opencode')!,
      id: 'custom-stdin',
      promptMode: 'stdin' as const,
      baseArgs: ['run'],
    }
    assert.deepEqual(buildArgs(stdinProfile, 'Secret prompt body', '/tmp/workspace'), ['run'])
  })

  it('does not force Gemini YOLO mode when a local project requires approvals', () => {
    const gemini = BUILTIN_PROFILES.find((profile) => profile.id === 'gemini')!
    const guarded = buildArgs(gemini, 'Inspect the repository', '/tmp/workspace', undefined, {
      sandbox: 'workspace-write',
      approvals: 'on-request',
      network: false,
      allowedTools: ['read_file'],
      deniedTools: [],
    })
    const unrestricted = buildArgs(gemini, 'Implement the change', '/tmp/workspace', undefined, {
      sandbox: 'full-access',
      approvals: 'never',
      network: true,
      allowedTools: [],
      deniedTools: [],
    })

    assert.ok(guarded.includes('default'))
    assert.ok(!guarded.includes('yolo'))
    assert.ok(guarded.includes('read_file'))
    assert.ok(unrestricted.includes('yolo'))
  })

  it('maps Gemini native sessions, tools, warnings, and usage into durable activity', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const emit: HarnessEmit = async (type, payload) => {
      events.push({ type, payload })
    }
    const state = { toolNames: new Map<string, string>() }
    await emitStructuredCliEvent('gemini', JSON.stringify({
      type: 'init', session_id: 'gemini-session-1', model: 'gemini-2.5-pro',
    }), emit, state)
    await emitStructuredCliEvent('gemini', JSON.stringify({
      type: 'tool_use', tool_name: 'run_shell_command', tool_id: 'tool-1', parameters: { command: 'npm test' },
    }), emit, state)
    await emitStructuredCliEvent('gemini', JSON.stringify({
      type: 'tool_result', tool_id: 'tool-1', status: 'success', output: '57 passed',
    }), emit, state)
    await emitStructuredCliEvent('gemini', JSON.stringify({
      type: 'error', severity: 'warning', message: 'Context was compacted',
    }), emit, state)
    await emitStructuredCliEvent('gemini', JSON.stringify({
      type: 'result', status: 'success', stats: { input_tokens: 100, output_tokens: 20 },
    }), emit, state)

    assert.deepEqual(events.map((event) => event.type), [
      'tool.completed',
      'command.started',
      'command.completed',
      'warning',
      'usage.updated',
    ])
    assert.equal(events[0]?.payload.session_id, 'gemini-session-1')
    assert.equal(events[2]?.payload.tool, 'run_shell_command')
    assert.deepEqual(events[4]?.payload.stats, { input_tokens: 100, output_tokens: 20 })
  })

  it('correlates Claude tool results with their native command type', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const emit: HarnessEmit = async (type, payload) => {
      events.push({ type, payload })
    }
    const state = { toolNames: new Map<string, string>() }
    await emitStructuredCliEvent('claude', JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'tool-use-1',
          name: 'Bash',
          input: { command: 'npm test' },
        }],
      },
    }), emit, state)
    await emitStructuredCliEvent('claude', JSON.stringify({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-use-1',
          content: '72 tests passed',
        }],
      },
    }), emit, state)

    assert.deepEqual(events.map((event) => event.type), ['command.started', 'command.completed'])
    assert.equal(events[1]?.payload.tool, 'Bash')
    assert.equal(events[1]?.payload.tool_id, 'tool-use-1')
    assert.equal(state.toolNames.size, 0)
  })

  it('resumes the exact Gemini session recorded by its stream', () => {
    const gemini = BUILTIN_PROFILES.find((profile) => profile.id === 'gemini')!
    const args = buildArgs(gemini, 'Continue the task', '/tmp/workspace', undefined, {
      sandbox: 'workspace-write',
      approvals: 'on-request',
      network: false,
      allowedTools: [],
      deniedTools: [],
    }, 'gemini-session-1')

    assert.ok(args.includes('--resume'))
    assert.equal(args[args.indexOf('--resume') + 1], 'gemini-session-1')
  })

  it('reports the native harness available for configured provider-backed gateways', async () => {
    const { HarnessRegistry } = await import('../src/harness/index.js')
    const registry = new HarnessRegistry(testConfig({
      modelRoutes: {},
      modelProvider: 'openai-compatible',
    }), {} as never)
    assert.equal(registry.list().find((status) => status.id === 'opensaddle')?.availability, 'available')
  })
})
