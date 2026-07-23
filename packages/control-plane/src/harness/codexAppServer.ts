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
          const params: Record<string, unknown> = { cwd: input.workspacePath }
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
          if (item && typeof item === 'object' && 'type' in item && item.type === 'agentMessage' && 'text' in item && typeof item.text === 'string' && !output) {
            output = item.text
            void input.emit('agent.output.delta', { text: item.text })
          }
        } else if (message.method?.includes('command') || message.method?.includes('tool')) {
          void input.emit('tool.completed', { tool: message.method, status: 'completed' })
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
        },
      })
    })

    rl.close()
    child.kill('SIGTERM')
    return { summary: result.summary, providerId: this.id }
  }
}
