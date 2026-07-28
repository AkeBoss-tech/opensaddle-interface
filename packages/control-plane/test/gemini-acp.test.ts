import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { AcpHarnessAdapter, resolveGeminiPermission } from '../src/harness/geminiAcp.js'
import type {
  HarnessEmit,
  HarnessProfile,
  HarnessRunInput,
  HarnessInteractionRequest,
} from '../src/harness/types.js'

const profile: HarnessProfile = {
  id: 'gemini',
  label: 'Gemini CLI',
  description: 'Gemini ACP test agent',
  kind: 'cli',
  protocol: 'acp',
  command: 'gemini',
  promptMode: 'native',
  codingAffinity: 1,
  supportsCancel: true,
  supportsStreaming: true,
}

function runInput(
  workspacePath: string,
  overrides: Partial<HarnessRunInput> = {},
): HarnessRunInput {
  return {
    runId: 'run-gemini-acp',
    sessionId: 'opensaddle-session',
    task: 'Implement the requested change',
    projectId: 'project-1',
    route: {
      modelKey: 'gemini',
      harnessKey: 'coding',
      providerKey: 'gemini',
      nativeModelDefault: true,
      runtimeKey: 'local',
      reasons: [],
      alternatives: [],
      cost: 'CLI provider metering',
    },
    workspacePath,
    providerId: 'gemini',
    executionPolicy: {
      sandbox: 'workspace-write',
      approvals: 'on-request',
      network: false,
      allowedTools: [],
      deniedTools: [],
    },
    signal: new AbortController().signal,
    emit: async () => undefined,
    ...overrides,
  }
}

describe('Gemini ACP harness', () => {
  it('maps an OpenSaddle session decision to the matching native ACP option', async () => {
    let interaction: HarnessInteractionRequest | undefined
    const input = runInput('/tmp', {
      requestInteraction: async (request) => {
        interaction = request
        return { approved: true, scope: 'session' }
      },
    })
    const response = await resolveGeminiPermission(input, {
      sessionId: 'gemini-session',
      toolCall: {
        toolCallId: 'tool-1',
        title: 'Edit package.json',
        kind: 'edit',
        rawInput: { path: 'package.json' },
      },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow-session', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    })

    assert.equal(interaction?.id, 'gemini-acp:tool-1')
    assert.equal(interaction?.kind, 'approval')
    assert.equal(interaction?.metadata?.protocol, 'acp')
    assert.deepEqual(response, {
      outcome: { outcome: 'selected', optionId: 'allow-session' },
    })
  })

  it('makes explicit local tool denial win over unrestricted Gemini mode', async () => {
    let prompted = false
    const input = runInput('/tmp', {
      executionPolicy: {
        sandbox: 'full-access',
        approvals: 'never',
        network: true,
        allowedTools: [],
        deniedTools: ['run_shell_command'],
      },
      requestInteraction: async () => {
        prompted = true
        return { approved: true, scope: 'session' }
      },
    })
    const response = await resolveGeminiPermission(input, {
      sessionId: 'gemini-session',
      toolCall: {
        toolCallId: 'tool-shell',
        title: 'Run command',
        name: 'run_shell_command',
        kind: 'execute',
      },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_always' },
      ],
    })

    assert.equal(prompted, false)
    assert.deepEqual(response, {
      outcome: { outcome: 'selected', optionId: 'reject' },
    })
  })

  it('matches wildcard policy denials against native ACP tool names', async () => {
    const response = await resolveGeminiPermission(runInput('/tmp', {
      executionPolicy: {
        sandbox: 'workspace-write',
        approvals: 'on-request',
        network: true,
        allowedTools: [],
        deniedTools: ['mcp__browser__*'],
      },
    }), {
      sessionId: 'session-1',
      toolCall: {
        toolCallId: 'tool-2',
        name: 'mcp__browser__open',
        title: 'Open browser page',
      },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    })
    assert.deepEqual(response, { outcome: { outcome: 'selected', optionId: 'deny' } })
  })

  it('runs an ACP subprocess through output, tool permission, usage, and completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opensaddle-gemini-acp-'))
    const executable = join(root, 'fake-gemini.mjs')
    const acpUrl = import.meta.resolve('@agentclientprotocol/sdk')
    await writeFile(executable, fakeAgentSource(acpUrl), { mode: 0o700 })
    await chmod(executable, 0o700)
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const emit: HarnessEmit = async (type, payload) => {
      events.push({ type, payload })
    }
    const requests: HarnessInteractionRequest[] = []
    const adapter = new AcpHarnessAdapter({
      ...profile,
      id: 'custom-acp',
      label: 'Custom ACP',
      command: executable,
      baseArgs: ['--acp'],
    })
    const customInput = (overrides: Partial<HarnessRunInput> = {}) => {
      const input = runInput(root, overrides)
      return {
        ...input,
        providerId: 'custom-acp',
        route: { ...input.route, providerKey: 'custom' as const },
      }
    }

    try {
      const result = await adapter.run(customInput({
        emit,
        requestInteraction: async (request) => {
          requests.push(request)
          return { approved: true, scope: 'once' }
        },
      }))

      assert.equal(result.providerId, 'custom-acp')
      assert.match(result.summary, /ACP_OK/)
      assert.equal(requests.length, 1)
      assert.equal(requests[0]?.prompt, 'Write fixture')
      assert.ok(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.tool === 'custom-acp.acp.initialize'))
      assert.ok(events.some((event) =>
        event.type === 'tool.completed'
        && event.payload.tool === 'custom-acp.session'
        && event.payload.session_id === 'fake-session'))
      assert.ok(events.some((event) =>
        event.type === 'file.change.updated'
        && event.payload.status === 'completed'))
      assert.ok(events.some((event) =>
        event.type === 'usage.updated'
        && event.payload.used === 42))
      assert.equal(
        events.filter((event) => event.type === 'agent.output.delta')
          .map((event) => String(event.payload.text))
          .join(''),
        'ACP_OK',
      )

      const resumedEvents: Array<{ type: string; payload: Record<string, unknown> }> = []
      const resumed = await adapter.run(customInput({
        providerSessionId: 'fake-session',
        emit: async (type, payload) => { resumedEvents.push({ type, payload }) },
        requestInteraction: async () => ({ approved: true, scope: 'once' }),
      }))
      assert.match(resumed.summary, /ACP_OK/)
      assert.ok(resumedEvents.some((event) =>
        event.type === 'tool.completed'
        && event.payload.tool === 'custom-acp.session.resume'
        && event.payload.session_id === 'fake-session'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function fakeAgentSource(acpUrl: string): string {
  return `#!/usr/bin/env node
import * as acp from ${JSON.stringify(acpUrl)}
import { Readable, Writable } from 'node:stream'

const sessions = new Set()
const app = acp.agent({ name: 'fake-gemini' })
  .onRequest('initialize', ({ params }) => ({
    protocolVersion: params.protocolVersion,
    agentCapabilities: { loadSession: true },
    agentInfo: { name: 'Fake Gemini', version: '1.0.0' },
  }))
  .onRequest('session/new', () => {
    sessions.add('fake-session')
    return {
      sessionId: 'fake-session',
      modes: {
        currentModeId: 'default',
        availableModes: [
          { id: 'default', name: 'Default' },
          { id: 'yolo', name: 'YOLO' },
          { id: 'plan', name: 'Plan' },
        ],
      },
    }
  })
  .onRequest('session/load', ({ params }) => {
    sessions.add(params.sessionId)
    return {
      modes: {
        currentModeId: 'default',
        availableModes: [
          { id: 'default', name: 'Default' },
          { id: 'yolo', name: 'YOLO' },
          { id: 'plan', name: 'Plan' },
        ],
      },
    }
  })
  .onRequest('session/set_mode', () => ({}))
  .onRequest('session/prompt', async ({ params, client }) => {
    if (!sessions.has(params.sessionId)) throw new Error('unknown session')
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'ACP_' },
      },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'write-1',
        title: 'Write fixture',
        kind: 'edit',
        status: 'pending',
        rawInput: { path: 'fixture.txt' },
      },
    })
    const decision = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: 'write-1',
        title: 'Write fixture',
        kind: 'edit',
        rawInput: { path: 'fixture.txt' },
      },
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    })
    if (decision.outcome.outcome !== 'selected' || decision.outcome.optionId !== 'allow') {
      throw new Error('permission rejected')
    }
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'write-1',
        status: 'completed',
        rawOutput: { ok: true },
      },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'usage_update', used: 42, size: 1000 },
    })
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'OK' },
      },
    })
    return { stopReason: 'end_turn' }
  })
  .onNotification('session/cancel', () => undefined)

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
)
await app.connect(stream)
`
}
