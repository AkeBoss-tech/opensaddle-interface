import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import type {
  HarnessAdapter,
  HarnessInteractionRequest,
  HarnessInteractionResponse,
  HarnessRunInput,
  HarnessRunResult,
} from './types.js'
import type { HarnessExecutionPolicy } from '../types.js'

type RpcMessage = {
  id?: string | number
  method?: string
  result?: Record<string, unknown>
  error?: { message?: string }
  params?: Record<string, unknown>
}

type ActiveCodexRun = {
  send: (message: Record<string, unknown>) => void
  threadId?: string
  turnId?: string
  nextRequestId: number
  pending: Map<number, {
    resolve: (accepted: boolean) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>
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

export function codexThreadOpenMethod(
  providerSessionId?: string,
  providerSessionMode: 'resume' | 'fork' = 'resume',
): 'thread/start' | 'thread/resume' | 'thread/fork' {
  if (!providerSessionId) return 'thread/start'
  return providerSessionMode === 'fork' ? 'thread/fork' : 'thread/resume'
}

export function codexForkCheckpoint(
  providerSessionMode?: 'resume' | 'fork',
  providerTurnId?: string,
): { lastTurnId?: string } {
  return providerSessionMode === 'fork' && providerTurnId
    ? { lastTurnId: providerTurnId }
    : {}
}

export function codexThreadConfig(policy?: HarnessExecutionPolicy): Record<string, unknown> | undefined {
  if (!policy) return undefined
  const denied = new Set(policy.deniedTools.map((entry) => entry.trim().toLowerCase()))
  const subagentsDisabled = [...denied].some((entry) =>
    entry === 'task'
    || entry === 'agent'
    || entry === 'delegate'
    || entry === 'spawn_agent',
  )
  return {
    sandbox_workspace_write: { network_access: policy.network },
    ...(!policy.network ? { web_search: 'disabled' } : {}),
    features: { multi_agent: !subagentsDisabled },
  }
}

export function codexSandboxMode(policy?: HarnessExecutionPolicy): 'read-only' | 'workspace-write' | 'danger-full-access' {
  if (policy?.sandbox === 'read-only') return 'read-only'
  // Codex's danger-full-access sandbox includes outbound network. When a user
  // disables Network, prefer the narrower workspace sandbox so the toggle is
  // an enforceable boundary rather than a visual-only preference.
  if (policy?.sandbox === 'full-access' && policy.network) return 'danger-full-access'
  return 'workspace-write'
}

function globMatches(pattern: string, candidate: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i').test(candidate)
}

export function codexInteractionDeniedByPolicy(
  message: RpcMessage,
  policy?: HarnessExecutionPolicy,
): string | undefined {
  if (!policy || !message.method) return undefined
  const params = message.params ?? {}
  const permissions = params.permissions && typeof params.permissions === 'object' && !Array.isArray(params.permissions)
    ? params.permissions as Record<string, unknown>
    : undefined
  if (!policy.network && (
    params.networkApprovalContext != null
    || permissions?.network != null
  )) {
    return 'Network is disabled for this task'
  }

  const toolName = typeof params.toolName === 'string' ? params.toolName : undefined
  const serverName = typeof params.serverName === 'string' ? params.serverName : undefined
  const candidates = [
    toolName,
    serverName,
    serverName && toolName ? `mcp__${serverName}__${toolName}` : undefined,
  ].filter((value): value is string => Boolean(value))
  const deniedTool = policy.deniedTools.find((pattern) =>
    candidates.some((candidate) => globMatches(pattern, candidate)),
  )
  return deniedTool ? `Tool ${candidates[0]} is disabled for this task` : undefined
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.flatMap((item) => typeof item === 'string' ? [item] : [])
  return items.length ? items : undefined
}

export function codexInteractionRequest(message: RpcMessage): HarnessInteractionRequest | undefined {
  if (message.id === undefined || !message.method) return undefined
  const params = message.params ?? {}
  const id = `codex:${String(message.id)}`
  const reason = typeof params.reason === 'string' ? params.reason : undefined
  const command = typeof params.command === 'string' ? params.command : undefined
  const cwd = typeof params.cwd === 'string' ? params.cwd : undefined
  const grantRoot = typeof params.grantRoot === 'string' ? params.grantRoot : undefined

  if (message.method === 'item/commandExecution/requestApproval' || message.method === 'execCommandApproval') {
    return {
      id,
      kind: 'approval',
      method: message.method,
      prompt: reason ?? (command ? `Allow this command?\n${command}` : 'Allow Codex to run this command?'),
      detail: [command, cwd].filter(Boolean).join('\n'),
      availableDecisions: strings(params.availableDecisions) ?? ['accept', 'acceptForSession', 'decline'],
      metadata: { command, cwd },
    }
  }
  if (message.method === 'item/fileChange/requestApproval' || message.method === 'applyPatchApproval') {
    return {
      id,
      kind: 'approval',
      method: message.method,
      prompt: reason ?? (grantRoot ? `Allow Codex to modify files under ${grantRoot}?` : 'Allow Codex to apply these file changes?'),
      detail: grantRoot,
      availableDecisions: ['accept', 'acceptForSession', 'decline'],
      metadata: { grantRoot },
    }
  }
  if (message.method === 'item/permissions/requestApproval') {
    return {
      id,
      kind: 'approval',
      method: message.method,
      prompt: reason ?? 'Allow the additional permissions requested by Codex?',
      detail: cwd,
      availableDecisions: ['accept', 'acceptForSession', 'decline'],
      metadata: { cwd, permissions: params.permissions },
    }
  }
  if (message.method === 'item/tool/requestUserInput') {
    const questions = Array.isArray(params.questions) ? params.questions.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const question = candidate as Record<string, unknown>
      if (typeof question.id !== 'string' || typeof question.question !== 'string') return []
      const options = Array.isArray(question.options) ? question.options.flatMap((option) => {
        if (!option || typeof option !== 'object' || Array.isArray(option)) return []
        const row = option as Record<string, unknown>
        return typeof row.label === 'string'
          ? [{ label: row.label, description: typeof row.description === 'string' ? row.description : undefined }]
          : []
      }) : undefined
      return [{
        id: question.id,
        header: typeof question.header === 'string' ? question.header : undefined,
        prompt: question.question,
        options,
        allowOther: question.isOther === true,
        secret: question.isSecret === true,
      }]
    }) : []
    return {
      id,
      kind: 'input',
      method: message.method,
      prompt: questions[0]?.prompt ?? 'Codex needs more information to continue.',
      questions,
    }
  }
  if (message.method === 'mcpServer/elicitation/request') {
    const prompt = typeof params.message === 'string' ? params.message : 'A connected tool needs information to continue.'
    return {
      id,
      kind: 'input',
      method: message.method,
      prompt,
      detail: typeof params.serverName === 'string' ? params.serverName : undefined,
      questions: [{ id: 'response', prompt, allowOther: true }],
      metadata: { mode: params.mode, serverName: params.serverName },
    }
  }
  return undefined
}

export function codexInteractionResult(
  method: string,
  response: HarnessInteractionResponse,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  const approved = response.approved === true
  const session = response.scope === 'session'
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    return { decision: approved ? session ? 'acceptForSession' : 'accept' : 'decline' }
  }
  if (method === 'execCommandApproval' || method === 'applyPatchApproval') {
    return { decision: approved ? session ? 'approved_for_session' : 'approved' : 'denied' }
  }
  if (method === 'item/permissions/requestApproval') {
    const requested = params.permissions && typeof params.permissions === 'object' && !Array.isArray(params.permissions)
      ? params.permissions as Record<string, unknown>
      : {}
    return {
      permissions: approved
        ? Object.fromEntries(Object.entries(requested).filter(([, value]) => value != null))
        : {},
      scope: session ? 'session' : 'turn',
    }
  }
  if (method === 'item/tool/requestUserInput') {
    const questions = Array.isArray(params.questions) ? params.questions : []
    const firstId = questions.find((question) =>
      question && typeof question === 'object' && !Array.isArray(question) && typeof (question as Record<string, unknown>).id === 'string',
    )
    const fallbackId = firstId && typeof firstId === 'object' && !Array.isArray(firstId)
      ? String((firstId as Record<string, unknown>).id)
      : 'response'
    const answers = response.answers ?? (response.text ? { [fallbackId]: [response.text] } : {})
    return { answers: Object.fromEntries(Object.entries(answers).map(([id, values]) => [id, { answers: values }])) }
  }
  if (method === 'mcpServer/elicitation/request') {
    return {
      action: response.approved === false ? 'decline' : 'accept',
      content: response.form ?? response.answers ?? (response.text ? { response: response.text } : {}),
      _meta: null,
    }
  }
  return {}
}

/**
 * Codex's documented rich-client transport. The app-server speaks newline-
 * delimited JSON-RPC over stdio and owns the model/account/session lifecycle.
 */
export class CodexAppServerAdapter implements HarnessAdapter {
  readonly id = 'codex'
  private readonly activeRuns = new Map<string, ActiveCodexRun>()

  async steer(runId: string, text: string): Promise<boolean> {
    const active = this.activeRuns.get(runId)
    const guidance = text.trim()
    if (!active?.threadId || !active.turnId || !guidance) return false
    const id = active.nextRequestId++
    return await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        active.pending.delete(id)
        reject(new Error('Codex did not acknowledge steering in time'))
      }, 10_000)
      active.pending.set(id, { resolve, reject, timer })
      active.send({
        method: 'turn/steer',
        id,
        params: {
          threadId: active.threadId,
          expectedTurnId: active.turnId,
          input: [{ type: 'text', text: guidance }],
        },
      })
    })
  }

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
    const active: ActiveCodexRun = {
      send,
      nextRequestId: 100,
      pending: new Map(),
    }
    this.activeRuns.set(input.runId, active)
    let result: { summary: string }
    try {
      result = await new Promise<{ summary: string }>((resolve, reject) => {
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

        if (message.id !== undefined && !message.method && typeof message.id === 'number') {
          const pending = active.pending.get(message.id)
          if (pending) {
            active.pending.delete(message.id)
            clearTimeout(pending.timer)
            if (message.error) pending.reject(new Error(message.error.message ?? 'Codex rejected steering'))
            else pending.resolve(true)
            return
          }
        }

        if (message.method && message.id !== undefined) {
          const interaction = codexInteractionRequest(message)
          const policyDenial = codexInteractionDeniedByPolicy(message, input.executionPolicy)
          if (interaction && policyDenial) {
            void input.emit('warning', {
              title: 'Blocked disabled capability',
              message: policyDenial,
              method: message.method,
            })
            send({
              id: message.id,
              result: codexInteractionResult(message.method, { approved: false }, message.params),
            })
          } else if (interaction && input.requestInteraction) {
            void input.requestInteraction(interaction)
              .then((response) => send({
                id: message.id,
                result: codexInteractionResult(message.method!, response, message.params),
              }))
              .catch(() => send({
                id: message.id,
                result: codexInteractionResult(message.method!, { approved: false }, message.params),
              }))
          } else {
            send({
              id: message.id,
              error: { code: -32601, message: `OpenSaddle does not handle ${message.method}` },
            })
          }
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
            sandbox: codexSandboxMode(policy),
            approvalPolicy: policy?.approvals === 'always'
              ? 'untrusted'
              : policy?.approvals === 'on-request'
                ? 'on-request'
                : 'never',
            // Keep provider-native history so a later OpenSaddle session bridge
            // can resume or fork the exact Codex thread.
            ephemeral: false,
          }
          const config = codexThreadConfig(policy)
          if (config) params.config = config
          // Auto/native routes deliberately omit model so Codex chooses the
          // model supported by the user's configured account/router.
          if (!input.route.nativeModelDefault && input.route.modelId) params.model = input.route.modelId
          if (input.providerSessionId) params.threadId = input.providerSessionId
          Object.assign(params, codexForkCheckpoint(input.providerSessionMode, input.providerTurnId))
          send({
            method: codexThreadOpenMethod(input.providerSessionId, input.providerSessionMode),
            id: 1,
            params,
          })
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
          active.threadId = threadId
          const openMethod = codexThreadOpenMethod(input.providerSessionId, input.providerSessionMode)
          void input.emit('tool.completed', {
            tool: `codex.${openMethod.replace('/', '.')}`,
            thread_id: threadId,
            persistent: true,
            source_thread_id: input.providerSessionMode === 'fork' ? input.providerSessionId : undefined,
          })
          send({
            method: 'turn/start',
            id: 2,
            params: { threadId, input: [{ type: 'text', text: input.task }] },
          })
          return
        }

        const params = message.params ?? {}
        if (message.id === 2) {
          const turn = message.result?.turn
          if (turn && typeof turn === 'object' && 'id' in turn && typeof turn.id === 'string') {
            active.turnId = turn.id
          }
        }
        if (message.method === 'turn/started') {
          const turn = params.turn
          if (turn && typeof turn === 'object' && 'id' in turn && typeof turn.id === 'string') {
            active.turnId = turn.id
          }
        } else if (message.method === 'item/agentMessage/delta') {
          const delta = typeof params.delta === 'string' ? params.delta : ''
          if (delta) {
            output += delta
            void input.emit('agent.output.delta', { text: delta })
          }
        } else if (message.method === 'turn/completed') {
          const turn = params.turn
          const status = turn && typeof turn === 'object' && 'status' in turn ? turn.status : undefined
          const completedTurnId = turn && typeof turn === 'object' && 'id' in turn && typeof turn.id === 'string'
            ? turn.id
            : active.turnId
          if (completedTurnId) {
            active.turnId = completedTurnId
            void input.emit('tool.completed', {
              tool: 'codex.turn.completed',
              thread_id: active.threadId,
              turn_id: completedTurnId,
              persistent: true,
            })
          }
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
    } finally {
      this.activeRuns.delete(input.runId)
      for (const pending of active.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Codex turn ended before steering completed'))
      }
      active.pending.clear()
      rl.close()
      child.kill('SIGTERM')
    }
    return { summary: result.summary, providerId: this.id, outputAlreadyEmitted: true }
  }
}
