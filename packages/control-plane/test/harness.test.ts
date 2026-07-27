import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeCliLine } from '../src/harness/normalizers.js'
import { BUILTIN_PROFILES } from '../src/harness/profiles.js'
import { which } from '../src/harness/index.js'
import { estimateRoute } from '../src/router.js'
import { containsUnsupportedToolCall } from '../src/modelGateway.js'
import { mergeCodexMessage } from '../src/harness/codexAppServer.js'
import type { ControlPlaneConfig } from '../src/config.js'

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
    assert.equal(BUILTIN_PROFILES.find((profile) => profile.id === 'claude')?.approvalPolicy, 'shell')
  })
})
