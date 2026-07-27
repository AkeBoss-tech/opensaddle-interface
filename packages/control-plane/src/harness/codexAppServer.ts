import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import type { HarnessAdapter, HarnessRunInput, HarnessRunResult } from './types.js'

type RpcMessage = {
  id?: number
  method?: string
  result?: Record<string, unknown>
  error?: { message?: string }
  params?: Record<string, unknown>
}

export function mergeCodexMessage(current: string, incoming: string): { output: string; delta: string } {
  if (!incoming || current === incoming || current.endsWith(incoming)) return { output: current, delta: '' }
  if (incoming.startsWith(current)) return { output: incoming, delta: incoming.slice(current.length) }
  if (current.includes(incoming)) return { output: current, delta: '' }
  const limit = Math.min(current.length, incoming.length)
  for (let size = limit; size > 0; size--) {
    if (current.slice(-size) === incoming.slice(0, size)) {
      const delta = incoming.slice(size)
      return { output: current + delta, delta }
    }
  }
  const separator = current && !/\s$/.test(current) && !/^\s/.test(incoming) ? '\n\n' : ''
  return { output: current + separator + incoming, delta: separator + incoming }
}

/**
 * Codex's documented rich-client transport. The app-server speaks newline-
 * delimited JSON-RPC over stdio and owns the model/account/session lifecycle.
 */
export class CodexAppServerAdapter implements HarnessAdapter {
  readonly id = 'codex'

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const child = spawn('codex', ['app-server'], {
      cwd: input.workspacePath,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
    const rl = createInterface({ input: child.stdout })
    let threadId: string | undefined
    let output = ''
    let settled = false

    const send = (message: Record<string, unknown>) => {
      if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`)
    }
    const result = await new Promise<{ summary: string }>((resolve, reject) => {
      const finish = (summary: string) => {
        if (settled) return
        settled = true
        resolve({ summary: summary || 'Codex completed' })
      }
      const onAbort = () => {
        child.kill('SIGTERM')
        reject(new Error('Run cancelled'))
      }
      input.signal.addEventListener('abort', onAbort, { once: true })

      rl.on('line', (line) => {
        if (!line.trim()) return
        let message: RpcMessage
        try {
          message = JSON.parse(line) as RpcMessage
        } catch {
          return
        }

        if (message.error) {
          const reason = message.error.message ?? 'Codex app-server request failed'
          if (message.id === 1 || message.id === 2) reject(new Error(reason))
          else void input.emit('agent.output.delta', { text: `\nCodex: ${reason}` })
          return
        }

        if (message.id === 0) {
          send({ method: 'initialized', params: {} })
          const policy = input.executionPolicy
          const params: Record<string, unknown> = {
            cwd: input.workspacePath,
            sandbox: policy?.sandbox === 'full-access'
              ? 'danger-full-access'
              : policy?.sandbox ?? 'workspace-write',
            approvalPolicy: policy?.approvals === 'always'
              ? 'untrusted'
              : policy?.approvals === 'on-request'
                ? 'on-request'
                : 'never',
            // Keep provider-native history so a later OpenSaddle session bridge
            // can resume or fork the exact Codex thread.
            ephemeral: false,
          }
          // Auto/native routes deliberately omit model so Codex chooses the
          // model supported by the user's configured account/router.
          if (!input.route.nativeModelDefault && input.route.modelId) params.model = input.route.modelId
          send({ method: 'thread/start', id: 1, params })
          return
        }

        if (message.id === 1) {
          const thread = message.result?.thread
          threadId = thread && typeof thread === 'object' && 'id' in thread && typeof thread.id === 'string'
            ? thread.id
            : undefined
          if (!threadId) {
            reject(new Error('Codex app-server did not return a thread id'))
            return
          }
          void input.emit('tool.completed', {
            tool: 'codex.thread.start',
            thread_id: threadId,
            persistent: true,
          })
          send({
            method: 'turn/start',
            id: 2,
            params: { threadId, input: [{ type: 'text', text: input.task }] },
          })
          return
        }

        const params = message.params ?? {}
        if (message.method === 'item/agentMessage/delta') {
          const delta = typeof params.delta === 'string' ? params.delta : ''
          if (delta) {
            output += delta
            void input.emit('agent.output.delta', { text: delta })
          }
        } else if (message.method === 'turn/completed') {
          const turn = params.turn
          const status = turn && typeof turn === 'object' && 'status' in turn ? turn.status : undefined
          if (status && status !== 'completed') {
            reject(new Error(`Codex turn ${String(status)}`))
          } else {
            finish(output)
          }
        } else if (message.method === 'item/completed') {
          const item = params.item
          if (item && typeof item === 'object' && 'type' in item && item.type === 'agentMessage' && 'text' in item && typeof item.text === 'string') {
            const merged = mergeCodexMessage(output, item.text)
            output = merged.output
            if (merged.delta) void input.emit('agent.output.delta', { text: merged.delta })
          } else if (item && typeof item === 'object') {
            const type = 'type' in item ? String(item.type) : 'item'
            if (/command/i.test(type)) void input.emit('command.completed', { item })
            else if (/fileChange/i.test(type)) void input.emit('file.change.updated', { item, status: 'completed' })
            else void input.emit('tool.completed', { tool: type, item, status: 'completed' })
          }
        } else if (message.method === 'item/started') {
          const item = params.item
          const type = item && typeof item === 'object' && 'type' in item ? String(item.type) : 'item'
          if (/command/i.test(type)) void input.emit('command.started', { item })
          else void input.emit('tool.requested', { tool: type, item })
        } else if (/command.*(delta|output)/i.test(message.method ?? '')) {
          void input.emit('command.output.delta', params)
        } else if (/file.*(delta|change|patch)/i.test(message.method ?? '')) {
          void input.emit('file.change.updated', params)
        } else if (/plan/i.test(message.method ?? '')) {
          void input.emit('plan.updated', params)
        } else if (/tokenUsage|usage/i.test(message.method ?? '')) {
          void input.emit('usage.updated', params)
        } else if (/warning/i.test(message.method ?? '')) {
          void input.emit('warning', params)
        } else if (message.method?.includes('tool') || message.method?.includes('mcp')) {
          void input.emit('tool.completed', { tool: message.method, ...params })
        }
      })

      child.once('error', (error) => reject(error))
      child.once('exit', (code) => {
        if (!settled && code !== 0) reject(new Error(`Codex app-server exited with code ${code ?? 'unknown'}`))
        else if (!settled) finish(output)
      })

      send({
        method: 'initialize',
        id: 0,
        params: {
          clientInfo: { name: 'opensaddle-interface', title: 'OpenSaddle', version: '0.1.0' },
          experimentalApi: true,
        },
      })
    })

    rl.close()
    child.kill('SIGTERM')
    return { summary: result.summary, providerId: this.id }
  }
}
