import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { HarnessRunInput } from './types.js'

type PermissionRequest = {
  toolName?: string
  input?: Record<string, unknown>
}

export interface ClaudePermissionBridge {
  configPath: string
  permissionTool: string
  close: () => Promise<void>
}

const MCP_SERVER_NAME = 'opensaddle_permission'
const MCP_TOOL_NAME = 'approve'

/**
 * The helper is materialized inside the run directory so it works in source,
 * packaged Electron, and an arbitrary Node installation without another
 * runtime dependency. It only speaks MCP stdio and a private Unix socket.
 */
export const CLAUDE_PERMISSION_MCP_SOURCE = String.raw`
import { createInterface } from 'node:readline';
import { connect } from 'node:net';

const socketPath = process.env.OPENSADDLE_CLAUDE_PERMISSION_SOCKET;
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');

function requestPermission(payload) {
  return new Promise((resolve, reject) => {
    if (!socketPath) {
      resolve({ behavior: 'deny', message: 'OpenSaddle permission bridge is unavailable' });
      return;
    }
    const socket = connect(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(JSON.stringify(payload) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });
    socket.on('error', reject);
  });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'notifications/initialized' || message.id == null) return;
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'OpenSaddle permission bridge', version: '1.0.0' },
      },
    });
    return;
  }
  if (message.method === 'ping') {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
    return;
  }
  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [{
          name: 'approve',
          description: 'Ask the OpenSaddle user to approve or deny a Claude Code tool call.',
          inputSchema: {
            type: 'object',
            properties: {
              tool_name: { type: 'string' },
              input: { type: 'object', additionalProperties: true },
            },
            required: ['tool_name', 'input'],
            additionalProperties: false,
          },
        }],
      },
    });
    return;
  }
  if (message.method === 'tools/call' && message.params?.name === 'approve') {
    try {
      const decision = await requestPermission(message.params.arguments ?? {});
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: JSON.stringify(decision) }] },
      });
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          isError: true,
          content: [{ type: 'text', text: String(error?.message ?? error) }],
        },
      });
    }
    return;
  }
  send({
    jsonrpc: '2.0',
    id: message.id,
    error: { code: -32601, message: 'Method not found' },
  });
});
`

function permissionDetail(toolName: string, input: Record<string, unknown>): string {
  if (/^(Bash|Shell)$/i.test(toolName)) {
    const command = input.command ?? input.cmd
    if (typeof command === 'string') return command
  }
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(toolName)) {
    const path = input.file_path ?? input.path ?? input.notebook_path
    if (typeof path === 'string') return path
  }
  try {
    return JSON.stringify(input, null, 2).slice(0, 8_000)
  } catch {
    return 'Claude Code tool input'
  }
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(socketPath, () => {
      server.off('error', onError)
      resolve()
    })
  })
}

export async function createClaudePermissionBridge(
  input: HarnessRunInput,
  sessionRoot: string,
): Promise<ClaudePermissionBridge | undefined> {
  if (!input.requestInteraction || input.executionPolicy?.approvals === 'never') return undefined
  await mkdir(sessionRoot, { recursive: true, mode: 0o700 })
  const bridgeId = randomUUID().slice(0, 12)
  const socketPath = join(tmpdir(), `opensaddle-claude-${bridgeId}.sock`)
  const helperPath = join(sessionRoot, 'permission-mcp.mjs')
  const configPath = join(sessionRoot, 'permission-mcp.json')
  await writeFile(helperPath, CLAUDE_PERMISSION_MCP_SOURCE, { mode: 0o700 })
  await writeFile(configPath, JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'stdio',
        command: process.execPath,
        args: [helperPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          OPENSADDLE_CLAUDE_PERMISSION_SOCKET: socketPath,
        },
      },
    },
  }, null, 2), { mode: 0o600 })

  const server = createServer((socket) => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      let request: PermissionRequest
      try {
        request = JSON.parse(buffer.slice(0, newline)) as PermissionRequest
      } catch {
        socket.end(`${JSON.stringify({ behavior: 'deny', message: 'Invalid permission request' })}\n`)
        return
      }
      const toolName = typeof request.toolName === 'string'
        ? request.toolName
        : typeof (request as Record<string, unknown>).tool_name === 'string'
          ? String((request as Record<string, unknown>).tool_name)
          : 'Claude tool'
      const toolInput = request.input && typeof request.input === 'object' && !Array.isArray(request.input)
        ? request.input
        : {}
      const requestId = `claude:${bridgeId}:${randomUUID().slice(0, 8)}`
      void input.requestInteraction!({
        id: requestId,
        kind: 'approval',
        method: 'claude/permissionPrompt',
        prompt: `Allow Claude Code to use ${toolName}?`,
        detail: permissionDetail(toolName, toolInput),
        availableDecisions: ['accept', 'decline'],
        metadata: { toolName, input: toolInput },
      }).then((response) => {
        const decision = response.approved === true
          ? { behavior: 'allow', updatedInput: toolInput }
          : { behavior: 'deny', message: 'Denied in OpenSaddle' }
        socket.end(`${JSON.stringify(decision)}\n`)
      }).catch(() => {
        socket.end(`${JSON.stringify({ behavior: 'deny', message: 'OpenSaddle run ended' })}\n`)
      })
    })
  })
  await rm(socketPath, { force: true }).catch(() => undefined)
  await listen(server, socketPath)

  return {
    configPath,
    permissionTool: `mcp__${MCP_SERVER_NAME}__${MCP_TOOL_NAME}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(socketPath, { force: true }).catch(() => undefined)
    },
  }
}
