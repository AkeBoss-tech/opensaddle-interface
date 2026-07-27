import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { it } from 'node:test'
import { createClaudePermissionBridge } from '../src/harness/claudePermissionBridge.js'
import type { HarnessInteractionRequest, HarnessRunInput } from '../src/harness/types.js'

function responseLine(lines: ReturnType<typeof createInterface>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    lines.once('line', (line) => resolve(JSON.parse(line) as Record<string, unknown>))
  })
}

it('relays Claude MCP permission calls through the durable interaction callback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opensaddle-claude-bridge-'))
  let requested: HarnessInteractionRequest | undefined
  const input = {
    runId: 'run-claude',
    sessionId: 'session-claude',
    task: 'test',
    projectId: 'project-1',
    route: {
      modelKey: 'claude',
      harnessKey: 'coding',
      providerKey: 'claude',
      runtimeKey: 'local',
      reasons: [],
      cost: '$0',
      alternatives: [],
    },
    workspacePath: root,
    providerId: 'claude',
    executionPolicy: {
      sandbox: 'workspace-write',
      approvals: 'on-request',
      network: false,
      allowedTools: [],
      deniedTools: [],
    },
    signal: new AbortController().signal,
    emit: async () => undefined,
    requestInteraction: async (request: HarnessInteractionRequest) => {
      requested = request
      return { approved: false, scope: 'once' as const }
    },
  } satisfies HarnessRunInput
  const bridge = await createClaudePermissionBridge(input, join(root, '.session'))
  assert.ok(bridge)
  const config = JSON.parse(await readFile(bridge.configPath, 'utf8')) as {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>
  }
  const server = config.mcpServers.opensaddle_permission
  assert.ok(server)
  const child = spawn(server.command, server.args, {
    env: { ...process.env, ...server.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines = createInterface({ input: child.stdout })

  try {
    const initialized = responseLine(lines)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    })}\n`)
    assert.equal((await initialized).id, 1)

    const listed = responseLine(lines)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
    const listResult = (await listed).result as { tools: Array<{ name: string }> }
    assert.equal(listResult.tools[0]?.name, 'approve')

    const called = responseLine(lines)
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'approve',
        arguments: { tool_name: 'Bash', input: { command: 'npm test' } },
      },
    })}\n`)
    const callResult = (await called).result as { content: Array<{ text: string }> }
    assert.deepEqual(JSON.parse(callResult.content[0]!.text), {
      behavior: 'deny',
      message: 'Denied in OpenSaddle',
    })
    assert.equal(requested?.kind, 'approval')
    assert.equal(requested?.method, 'claude/permissionPrompt')
    assert.equal(requested?.prompt, 'Allow Claude Code to use Bash?')
    assert.equal(requested?.detail, 'npm test')
  } finally {
    child.kill('SIGTERM')
    lines.close()
    await bridge.close()
    await rm(root, { recursive: true, force: true })
  }
})
