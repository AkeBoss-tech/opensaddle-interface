import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HarnessCapabilityRegistry } from '../src/harness/capabilityRegistry.js'
import type { HarnessProfile } from '../src/harness/types.js'

const profiles: HarnessProfile[] = [
  {
    id: 'codex', label: 'Codex', description: 'Codex CLI', kind: 'cli', command: 'codex',
    promptMode: 'final_arg', modelIds: { gpt: 'gpt-5.4', sonnet: 'gpt-5.3-codex' },
    codingAffinity: 1, supportsCancel: true, supportsStreaming: true,
  },
  {
    id: 'claude', label: 'Claude Code', description: 'Claude CLI', kind: 'cli', command: 'claude',
    promptMode: 'final_arg', modelIds: { claude: 'opus', sonnet: 'sonnet' },
    codingAffinity: 1, supportsCancel: true, supportsStreaming: true,
  },
  {
    id: 'cursor', label: 'Cursor', description: 'Cursor CLI', kind: 'cli', command: 'cursor-agent',
    promptMode: 'final_arg', codingAffinity: 1, supportsCancel: true, supportsStreaming: false,
  },
]

describe('HarnessCapabilityRegistry', () => {
  it('discovers installed harnesses without reading secret values', async () => {
    const commands: Array<{ command: string, args: readonly string[] }> = []
    const registry = new HarnessCapabilityRegistry({
      profiles,
      env: { OPENAI_API_KEY: 'not-exposed' },
      resolveCommand: (command) => command === 'codex' ? '/bin/codex' : undefined,
      runCommand: async (command, args) => {
        commands.push({ command, args })
        return { stdout: 'codex-cli 1.2.3\n' }
      },
      configuredModels: { codex: ['gpt-5.4', 'gpt-5.4-mini'] },
      now: () => new Date('2026-07-27T12:00:00.000Z'),
    })
    assert.equal(registry.current(), undefined)
    const result = await registry.discover()
    assert.equal(registry.current(), result)

    assert.deepEqual(commands, [{ command: '/bin/codex', args: ['--version'] }])
    assert.equal(result.generatedAt, '2026-07-27T12:00:00.000Z')
    assert.deepEqual(result.harnesses[0], {
      id: 'codex', label: 'Codex', description: 'Codex CLI', kind: 'cli',
      availability: 'available', readiness: 'ready', command: 'codex', resolvedPath: '/bin/codex',
      version: 'codex-cli 1.2.3', auth: { state: 'configured', detectedBy: 'environment' },
      models: [
        { id: 'gpt-5.4', configured: true },
        { id: 'gpt-5.3-codex', configured: false },
        { id: 'gpt-5.4-mini', configured: true },
      ],
      capabilities: {
        streaming: true, tools: true, mcp: true, skills: true, reasoningControls: true,
        contextMetadata: true, cancellation: true,
      },
    })
    assert.equal(result.harnesses[1]?.unavailableReason, 'Executable "claude" was not found on PATH')
  })

  it('separates a missing executable, a disabled provider, and uncertain CLI login state', async () => {
    const result = await new HarnessCapabilityRegistry({
      profiles,
      enabledProviderIds: ['claude', 'cursor'],
      resolveCommand: (command) => command === 'claude' ? '/bin/claude' : undefined,
      runCommand: async () => ({ stdout: 'Claude Code 2.0.0' }),
      now: () => new Date('2026-07-27T12:00:00.000Z'),
    }).discover()

    const [codex, claude, cursor] = result.harnesses
    assert.equal(codex?.availability, 'disabled')
    assert.equal(codex?.readiness, 'unavailable')
    assert.equal(claude?.availability, 'available')
    assert.equal(claude?.readiness, 'needs_auth')
    assert.equal(claude?.auth.state, 'not_detected')
    assert.equal(cursor?.availability, 'missing')
    assert.match(cursor?.unavailableReason ?? '', /cursor-agent/)
  })

  it('does not fail discovery when a safe version probe fails', async () => {
    const result = await new HarnessCapabilityRegistry({
      profiles: [profiles[0]!],
      resolveCommand: () => '/bin/codex',
      runCommand: async () => { throw new Error('version unsupported') },
    }).discover()

    assert.equal(result.harnesses[0]?.availability, 'available')
    assert.equal(result.harnesses[0]?.version, undefined)
    assert.equal(result.harnesses[0]?.readiness, 'needs_auth')
  })

  it('marks signed-in Cursor unusable when the account exposes no CLI models', async () => {
    const cursor = profiles.find((profile) => profile.id === 'cursor')!
    const result = await new HarnessCapabilityRegistry({
      profiles: [cursor],
      resolveCommand: () => '/bin/cursor-agent',
      runCommand: async (_command, args) => {
        if (args[0] === '--version') return { stdout: '2026.05.28', exitCode: 0 }
        if (args[0] === 'status') {
          return { stdout: JSON.stringify({ status: 'authenticated', isAuthenticated: true }), exitCode: 0 }
        }
        return { stdout: 'No models available for this account.', exitCode: 0 }
      },
    }).discover()

    assert.equal(result.harnesses[0]?.availability, 'available')
    assert.equal(result.harnesses[0]?.readiness, 'needs_auth')
    assert.match(result.harnesses[0]?.auth.message ?? '', /no CLI models/i)
    assert.equal(result.harnesses[0]?.auth.setupCommand, 'cursor-agent login')
  })

  it('reports an ineligible Gemini account and a missing native model endpoint as setup states', async () => {
    const gemini: HarnessProfile = {
      id: 'gemini', label: 'Gemini CLI', description: 'Gemini CLI', kind: 'cli', command: 'gemini',
      promptMode: 'flag', promptFlag: '--prompt', codingAffinity: 1, supportsCancel: true, supportsStreaming: true,
    }
    const native: HarnessProfile = {
      id: 'opensaddle', label: 'OpenSaddle', description: 'Native', kind: 'native', command: '',
      promptMode: 'native', codingAffinity: 1, supportsCancel: true, supportsStreaming: true,
    }
    const registry = new HarnessCapabilityRegistry({
      profiles: [native, gemini],
      nativeAvailable: false,
      resolveCommand: (command) => command === 'gemini' ? '/bin/gemini' : undefined,
      runCommand: async (_command, args) => args[0] === '--version'
        ? { stdout: '0.43.0', exitCode: 0 }
        : { stderr: 'IneligibleTierError: UNSUPPORTED_CLIENT no longer supported', exitCode: 1 },
      cacheTtlMs: 60_000,
    })
    const first = await registry.discover()
    const second = await registry.discover()

    assert.equal(first, second)
    assert.equal(first.harnesses[0]?.availability, 'disabled')
    assert.match(first.harnesses[0]?.unavailableReason ?? '', /model endpoint/i)
    assert.equal(first.harnesses[1]?.readiness, 'needs_auth')
    assert.match(first.harnesses[1]?.auth.message ?? '', /not eligible/i)
    assert.equal(first.harnesses[1]?.auth.setupCommand, 'gemini')
  })

  it('bypasses the readiness cache when the user refreshes after CLI setup', async () => {
    let signedIn = false
    let probeCount = 0
    const registry = new HarnessCapabilityRegistry({
      profiles: [profiles[0]!],
      resolveCommand: () => '/bin/codex',
      runCommand: async (_command, args) => {
        if (args[0] === '--version') return { stdout: 'codex-cli 1.0.0', exitCode: 0 }
        probeCount += 1
        return signedIn
          ? { stdout: 'Logged in using ChatGPT', exitCode: 0 }
          : { stderr: 'Not logged in', exitCode: 1 }
      },
      cacheTtlMs: 60_000,
    })

    const before = await registry.discover()
    signedIn = true
    const cached = await registry.discover()
    const refreshed = await registry.discover(true)

    assert.equal(before, cached)
    assert.equal(before.harnesses[0]?.readiness, 'needs_auth')
    assert.equal(refreshed.harnesses[0]?.readiness, 'ready')
    assert.equal(probeCount, 2)
  })

  it('probes a project-local ACP harness and exposes its configured models', async () => {
    const custom: HarnessProfile = {
      id: 'custom-acp',
      label: 'Team ACP',
      description: 'Project-local ACP harness',
      kind: 'cli',
      protocol: 'acp',
      command: '/opt/team-acp',
      promptMode: 'native',
      modelFlag: '--model',
      codingAffinity: 1,
      supportsCancel: true,
      supportsStreaming: true,
    }
    const result = await new HarnessCapabilityRegistry({
      profiles: [custom],
      configuredModels: { 'custom-acp': ['team-fast', 'team-deep'] },
      resolveCommand: () => '/opt/team-acp',
      runCommand: async () => ({ stdout: 'team-acp 2.4.0', exitCode: 0 }),
    }).discover()

    const capability = result.harnesses[0]!
    assert.equal(capability.availability, 'available')
    assert.equal(capability.readiness, 'ready')
    assert.equal(capability.auth.state, 'not_required')
    assert.match(capability.auth.message ?? '', /managed by this harness/i)
    assert.deepEqual(capability.models, [
      { id: 'team-fast', configured: true },
      { id: 'team-deep', configured: true },
    ])
    assert.equal(capability.capabilities.tools, true)
    assert.equal(capability.capabilities.mcp, true)
    assert.equal(capability.capabilities.streaming, true)
  })
})
