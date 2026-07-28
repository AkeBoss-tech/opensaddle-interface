import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough, Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
} from '@agentclientprotocol/sdk'
import { resolveCliModel } from './modelMap.js'
import type {
  HarnessAdapter,
  HarnessEmit,
  HarnessProfile,
  HarnessRunInput,
  HarnessRunResult,
  HarnessInteractionResponse,
} from './types.js'

interface GeminiAcpState {
  output: string
  tools: Map<string, { name: string; kind?: string }>
}

export class AcpHarnessAdapter implements HarnessAdapter {
  readonly id: string

  constructor(private readonly profile: HarnessProfile) {
    this.id = profile.id
  }

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const sessionRoot = join(input.workspacePath, '.opensaddle-harness', input.runId)
    const runnerDir = join(sessionRoot, '.runner')
    mkdirSync(runnerDir, { recursive: true, mode: 0o700 })
    const stdoutLog = createWriteStream(join(runnerDir, 'stdout.log'), { flags: 'a' })
    const stderrLog = createWriteStream(join(runnerDir, 'stderr.log'), { flags: 'a' })
    const args = [...(this.profile.baseArgs ?? [])]
    const modelId = input.route.nativeModelDefault
      ? undefined
      : resolveCliModel(this.profile, input.route.modelKey, input.route.modelId)
    if (modelId && this.profile.modelFlag) args.push(this.profile.modelFlag, modelId)
    writeFileSync(join(runnerDir, 'command.json'), JSON.stringify({
      command: this.profile.command,
      args,
      cwd: input.workspacePath,
      protocol: 'acp',
      startedAt: new Date().toISOString(),
    }, null, 2))

    await input.emit('agent.started', {
      model: input.route.modelKey,
      cli_model: modelId,
      harness: input.route.harnessKey,
      provider: this.id,
      runtime: input.route.runtimeKey,
      protocol: 'acp',
    })
    await input.emit('tool.requested', {
      tool: `${this.id}.acp.spawn`,
      command: this.profile.command,
      args,
    })

    const child = spawn(this.profile.command, args, {
      cwd: input.workspacePath,
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const acpOutput = new PassThrough()
    child.stdout.pipe(acpOutput)
    child.stdout.pipe(stdoutLog)
    child.stderr.pipe(stderrLog)
    let stderrTail = ''
    let spawnFailure: Error | undefined
    child.on('error', (error) => { spawnFailure = error })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4_000)
    })

    const state: GeminiAcpState = { output: '', tools: new Map() }
    let sessionId: string | undefined
    const client: acp.Client = {
      requestPermission: async (params) => await resolveAcpPermission(input, params),
      sessionUpdate: async (params) => await emitAcpUpdate(params, input.emit, state, this.id),
    }
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(acpOutput) as unknown as ReadableStream<Uint8Array>,
    )
    const connection = new acp.ClientSideConnection(() => client, stream)
    const onAbort = () => {
      if (sessionId) void connection.cancel({ sessionId }).catch(() => undefined)
      setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM')
      }, 250).unref()
    }
    if (input.signal.aborted) onAbort()
    else input.signal.addEventListener('abort', onAbort, { once: true })

    try {
      const initialized = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { plan: {} },
        clientInfo: { name: 'OpenSaddle', version: '0.1.0' },
      })
      await input.emit('tool.completed', {
        tool: `${this.id}.acp.initialize`,
        protocol_version: initialized.protocolVersion,
        agent: initialized.agentInfo,
      })

      let session
      if (input.providerSessionId && initialized.agentCapabilities?.loadSession) {
        sessionId = input.providerSessionId
        session = await connection.loadSession({
          sessionId,
          cwd: input.workspacePath,
          mcpServers: [],
        })
        await input.emit('tool.completed', {
          tool: `${this.id}.session.resume`,
          session_id: sessionId,
          persistent: true,
          protocol: 'acp',
        })
      } else {
        session = await connection.newSession({
          cwd: input.workspacePath,
          mcpServers: [],
        })
        sessionId = session.sessionId
        await input.emit('tool.completed', {
          tool: `${this.id}.session`,
          session_id: sessionId,
          persistent: true,
          protocol: 'acp',
        })
      }

      const targetMode = acpMode(input)
      const modes = session.modes
      if (modes && modes.currentModeId !== targetMode && modes.availableModes.some((mode) => mode.id === targetMode)) {
        await connection.setSessionMode({ sessionId, modeId: targetMode })
        await input.emit('tool.completed', {
          tool: `${this.id}.mode`,
          mode: targetMode,
          session_id: sessionId,
        })
      }

      const response = await connection.prompt({
        sessionId,
        prompt: [{ type: 'text', text: input.task }],
      })
      if (input.signal.aborted) throw new Error('Run cancelled')
      await input.emit('tool.completed', {
        tool: `${this.id}.prompt`,
        stop_reason: response.stopReason,
        session_id: sessionId,
      })
      return {
        summary: state.output.trim() || `Gemini completed (${response.stopReason})`,
        exitCode: 0,
        providerId: this.id,
        outputAlreadyEmitted: Boolean(state.output.trim()),
      }
    } catch (error) {
      if (input.signal.aborted) throw new Error('Run cancelled')
      const message = error instanceof Error ? error.message : String(error)
      const cause = spawnFailure?.message ?? message
      throw new Error(`${this.profile.label} ACP failed: ${cause}${stderrTail.trim() ? `: ${stderrTail.trim()}` : ''}`)
    } finally {
      input.signal.removeEventListener('abort', onAbort)
      await stopAcpChild(child, connection.closed)
      stdoutLog.end()
      stderrLog.end()
    }
  }
}

async function stopAcpChild(child: ChildProcess, connectionClosed: Promise<void>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    once(child, 'exit').then(() => undefined),
    connectionClosed.catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 750)),
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

function acpMode(input: HarnessRunInput): string {
  if (input.executionPolicy?.sandbox === 'read-only') return 'plan'
  if (input.executionPolicy?.approvals === 'never') return 'yolo'
  return 'default'
}

export async function resolveAcpPermission(
  input: HarnessRunInput,
  params: RequestPermissionRequest,
): Promise<RequestPermissionResponse> {
  if (input.signal.aborted) return { outcome: { outcome: 'cancelled' } }
  const policy = input.executionPolicy
  const tool = params.toolCall
  const forceReject = policy?.sandbox === 'read-only' && ['edit', 'delete', 'move', 'execute'].includes(tool.kind ?? '')
    || policy?.network === false && ['fetch', 'search'].includes(tool.kind ?? '')
    || matchesPolicyTool(policy?.deniedTools ?? [], tool)
  if (forceReject) {
    const option = permissionOption(params.options, false, 'session')
    return option
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } }
  }
  if (matchesPolicyTool(policy?.allowedTools ?? [], tool)) {
    const option = permissionOption(params.options, true, 'session')
    return option
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } }
  }
  if (policy?.approvals === 'never') {
    const option = permissionOption(params.options, true, 'session')
    return option
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } }
  }
  if (!input.requestInteraction) {
    const option = permissionOption(params.options, false, 'once')
    return option
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } }
  }

  const response = await input.requestInteraction({
    id: `gemini-acp:${tool.toolCallId}`,
    kind: 'approval',
    method: 'session/request_permission',
    prompt: tool.title ?? tool.name ?? 'Gemini requests permission',
    detail: tool.rawInput === undefined ? undefined : safeJson(tool.rawInput),
    availableDecisions: params.options.map((option) => option.optionId),
    metadata: {
      provider: input.providerId,
      protocol: 'acp',
      session_id: params.sessionId,
      tool_call: tool,
      options: params.options,
    },
  })
  const option = permissionOption(params.options, response.approved === true, response.scope ?? 'once')
  return option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } }
}

function matchesPolicyTool(
  configured: string[],
  tool: RequestPermissionRequest['toolCall'],
): boolean {
  const candidates = [tool.name, tool.title]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase())
  return configured.some((entry) => {
    const normalized = entry.trim().toLowerCase()
    if (normalized === '*') return true
    const escaped = normalized
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
    const matcher = new RegExp(`^${escaped}$`, 'i')
    return candidates.some((candidate) => matcher.test(candidate))
  })
}

function permissionOption(
  options: PermissionOption[],
  approved: boolean,
  scope: NonNullable<HarnessInteractionResponse['scope']>,
): PermissionOption | undefined {
  const preferred = approved
    ? scope === 'session' ? ['allow_always', 'allow_once'] : ['allow_once', 'allow_always']
    : scope === 'session' ? ['reject_always', 'reject_once'] : ['reject_once', 'reject_always']
  return preferred
    .map((kind) => options.find((option) => option.kind === kind))
    .find((option): option is PermissionOption => Boolean(option))
}

export async function emitAcpUpdate(
  notification: SessionNotification,
  emit: HarnessEmit,
  state: GeminiAcpState = { output: '', tools: new Map() },
  provider = 'gemini',
): Promise<void> {
  const update = notification.update
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      if (update.content.type === 'text' && update.content.text) {
        state.output += update.content.text
        await emit('agent.output.delta', {
          text: update.content.text,
          message_id: update.messageId,
          provider,
        })
      }
      return
    case 'agent_thought_chunk':
      if (update.content.type === 'text' && update.content.text.trim()) {
        await emit('plan.updated', {
          provider,
          thought: update.content.text,
          message_id: update.messageId,
        })
      }
      return
    case 'tool_call': {
      const name = update.name ?? update.title
      state.tools.set(update.toolCallId, { name, kind: update.kind })
      await emitGeminiToolActivity(emit, name, update.kind, update.toolCallId, update.status, update)
      return
    }
    case 'tool_call_update': {
      const known = state.tools.get(update.toolCallId)
      const name = update.name ?? update.title ?? known?.name ?? 'Gemini tool'
      const kind = update.kind ?? known?.kind
      state.tools.set(update.toolCallId, { name, kind })
      await emitGeminiToolActivity(emit, name, kind, update.toolCallId, update.status, update)
      if (update.status === 'completed' || update.status === 'failed') state.tools.delete(update.toolCallId)
      return
    }
    case 'plan':
    case 'plan_update':
    case 'plan_removed':
      await emit('plan.updated', { provider, session_id: notification.sessionId, plan: update })
      return
    case 'usage_update':
      await emit('usage.updated', {
        provider,
        used: update.used,
        size: update.size,
        cost: update.cost,
      })
      return
    case 'current_mode_update':
      await emit('tool.completed', {
        tool: `${provider}.mode`,
        mode: update.currentModeId,
        session_id: notification.sessionId,
      })
      return
    default:
      return
  }
}

// Compatibility exports for existing integrations while the adapter becomes provider-neutral.
export { AcpHarnessAdapter as GeminiAcpAdapter }
export const resolveGeminiPermission = resolveAcpPermission
export const emitGeminiAcpUpdate = emitAcpUpdate

async function emitGeminiToolActivity(
  emit: HarnessEmit,
  name: string,
  kind: string | null | undefined,
  toolCallId: string,
  status: string | null | undefined,
  item: SessionUpdate,
): Promise<void> {
  const payload = {
    tool: name,
    tool_id: toolCallId,
    kind,
    status,
    item,
  }
  const finished = status === 'completed' || status === 'failed'
  if (kind === 'execute') {
    await emit(finished ? 'command.completed' : 'command.started', payload)
  } else if (['edit', 'delete', 'move'].includes(kind ?? '')) {
    await emit('file.change.updated', payload)
  } else {
    await emit(finished ? 'tool.completed' : 'tool.requested', payload)
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 20_000)
  } catch {
    return String(value).slice(0, 20_000)
  }
}
