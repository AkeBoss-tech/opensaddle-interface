import { join } from 'node:path'
import { createClaudePermissionBridge } from './claudePermissionBridge.js'
import { normalizeCliLine } from './normalizers.js'
import { resolveCliModel } from './modelMap.js'
import { runProcessSession } from './processSession.js'
import type { HarnessAdapter, HarnessProfile, HarnessRunInput, HarnessRunResult } from './types.js'

/**
 * Generic CLI harness adapter (KRAIL LocalCLIRunner shape).
 * Builds argv from a profile, runs an allowlisted binary, normalizes stdout.
 */
export class CliHarnessAdapter implements HarnessAdapter {
  readonly id: string

  constructor(private readonly profile: HarnessProfile) {
    this.id = profile.id
  }

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    if (!this.profile.command) {
      throw new Error(`CLI harness "${this.profile.id}" has no command configured`)
    }

    const modelId = input.route.nativeModelDefault
      ? undefined
      : resolveCliModel(this.profile, input.route.modelKey, input.route.modelId)
    const sessionRoot = join(input.workspacePath, '.opensaddle-harness', input.runId)
    const permissionBridge = this.profile.id === 'claude'
      ? await createClaudePermissionBridge(input, sessionRoot)
      : undefined
    const args = buildArgs(
      this.profile,
      input.task,
      input.workspacePath,
      modelId,
      input.executionPolicy,
      input.providerSessionId,
      input.providerSessionMode,
    )
    if (permissionBridge) {
      args.push(
        '--permission-prompt-tool', permissionBridge.permissionTool,
        '--mcp-config', permissionBridge.configPath,
      )
    }

    await input.emit('agent.started', {
      model: input.route.modelKey,
      cli_model: modelId,
      harness: input.route.harnessKey,
      provider: this.id,
      runtime: input.route.runtimeKey,
    })
    if (this.profile.id === 'claude' && input.providerSessionId) {
      await input.emit('tool.completed', {
        tool: input.providerSessionMode === 'fork' ? 'claude.session.fork' : 'claude.session.resume',
        session_id: input.providerSessionId,
        persistent: true,
      })
    }
    if (this.profile.id === 'cursor' && input.providerSessionId) {
      await input.emit('tool.completed', {
        tool: 'cursor.session.resume',
        session_id: input.providerSessionId,
        persistent: true,
      })
    }
    if (this.profile.id === 'gemini' && input.providerSessionId) {
      await input.emit('tool.completed', {
        tool: 'gemini.session.resume',
        session_id: input.providerSessionId,
        persistent: true,
      })
    }

    let streamedText = ''
    const structuredState: StructuredCliEventState = { toolNames: new Map() }
    const result = await runProcessSession({
      command: this.profile.command,
      args,
      cwd: input.workspacePath,
      signal: input.signal,
      sessionRoot,
      emit: input.emit,
      stdinText: this.profile.promptMode === 'stdin' ? input.task : undefined,
      onStdoutLine: async (line) => {
        await emitStructuredCliEvent(this.profile.id, line, input.emit, structuredState)
        const incoming = normalizeCliLine(this.profile.id, line)
        if (!incoming) return undefined
        const merged = mergeCliText(streamedText, incoming)
        streamedText = merged.output
        return merged.delta
      },
    }).finally(() => permissionBridge?.close())

    if (input.signal.aborted) throw new Error('Run cancelled')

    if (result.exitCode !== 0 && result.exitCode !== null) {
      const errTail = result.stderr.trim().slice(-1_500) || result.stdout.trim().slice(-1_500)
      throw new Error(
        `${this.profile.label} exited with code ${result.exitCode}`
        + (errTail ? `: ${errTail}` : ''),
      )
    }

    const summary = summarize(this.profile.id, result.stdout, result.stderr)
    if (summary && !streamedText.includes(summary)) {
      await input.emit('agent.output.delta', { text: streamedText && !streamedText.endsWith('\n') ? `\n\n${summary}` : summary })
    }

    return {
      summary: summary || `${this.profile.label} completed`,
      exitCode: result.exitCode ?? 0,
      providerId: this.id,
      outputAlreadyEmitted: true,
    }
  }
}

export function mergeCliText(current: string, incoming: string): { output: string; delta: string } {
  if (!incoming || current === incoming || current.endsWith(incoming)) return { output: current, delta: '' }
  if (incoming.startsWith(current)) return { output: incoming, delta: incoming.slice(current.length) }
  return { output: current + incoming, delta: incoming }
}

function buildArgs(
  profile: HarnessProfile,
  task: string,
  workspacePath: string,
  modelId?: string,
  executionPolicy?: import('../types.js').HarnessExecutionPolicy,
  providerSessionId?: string,
  providerSessionMode: 'resume' | 'fork' = 'resume',
): string[] {
  const args = [...(profile.baseArgs ?? []), ...(profile.streamArgs ?? [])]
  const policyArgs: string[] = []
  if (profile.id === 'claude' && executionPolicy) {
    const permissionMode = executionPolicy.sandbox === 'full-access' && executionPolicy.approvals === 'never'
      ? 'bypassPermissions'
      : executionPolicy.sandbox === 'read-only'
        ? 'plan'
        : executionPolicy.approvals === 'always'
          ? 'default'
          : 'acceptEdits'
    policyArgs.push('--permission-mode', permissionMode)
    if (permissionMode === 'bypassPermissions') policyArgs.push('--dangerously-skip-permissions')
    if (executionPolicy.allowedTools.length) policyArgs.push('--allowedTools', executionPolicy.allowedTools.join(','))
    if (executionPolicy.deniedTools.length) policyArgs.push('--disallowedTools', executionPolicy.deniedTools.join(','))
  }
  if (profile.id === 'cursor' && executionPolicy) {
    if (executionPolicy.sandbox === 'read-only') {
      policyArgs.push('--mode', 'plan', '--sandbox', 'enabled')
    } else if (executionPolicy.sandbox === 'full-access' && executionPolicy.approvals === 'never') {
      policyArgs.push('--force', '--sandbox', 'disabled')
    } else {
      policyArgs.push('--sandbox', 'enabled')
    }
  }
  if (profile.id === 'gemini' && executionPolicy) {
    const approvalMode = executionPolicy.sandbox === 'read-only'
      ? 'plan'
      : executionPolicy.approvals === 'never'
        ? 'yolo'
        : 'default'
    policyArgs.push('--approval-mode', approvalMode)
    if (executionPolicy.allowedTools.length) {
      policyArgs.push('--allowed-tools', executionPolicy.allowedTools.join(','))
    }
  }
  if (profile.modelFlag && modelId) {
    args.push(profile.modelFlag, modelId)
  }
  if (profile.cwdArgs?.length) {
    args.push(...profile.cwdArgs, workspacePath)
  }
  if (profile.id === 'claude' && providerSessionId) {
    args.push('--resume', providerSessionId)
    if (providerSessionMode === 'fork') args.push('--fork-session')
  }
  if (profile.id === 'cursor' && providerSessionId) {
    args.push('--resume', providerSessionId)
  }
  if (profile.id === 'gemini' && providerSessionId) {
    args.push('--resume', providerSessionId)
  }

  switch (profile.promptMode) {
    case 'final_arg':
      args.push(task)
      break
    case 'flag':
      args.push(profile.promptFlag ?? '--prompt', task)
      break
    case 'stdin':
      break
    case 'native':
      break
  }
  // Claude's tool flags are variadic. Keep them after the positional prompt
  // so the CLI parser cannot consume the prompt as another tool name.
  args.push(...policyArgs)
  return args
}

export interface StructuredCliEventState {
  toolNames: Map<string, string>
}

export async function emitStructuredCliEvent(
  providerId: string,
  line: string,
  emit: import('./types.js').HarnessEmit,
  state: StructuredCliEventState = { toolNames: new Map() },
): Promise<void> {
  if (!['claude', 'cursor', 'gemini'].includes(providerId) || !line.trim().startsWith('{')) return
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }
  const type = String(parsed.type ?? '')
  if (providerId === 'gemini') {
    if (type === 'init' && typeof parsed.session_id === 'string') {
      await emit('tool.completed', {
        tool: 'gemini.session',
        session_id: parsed.session_id,
        model: parsed.model,
        persistent: true,
      })
      return
    }
    if (type === 'tool_use') {
      const name = typeof parsed.tool_name === 'string' ? parsed.tool_name : 'Gemini tool'
      const toolId = typeof parsed.tool_id === 'string' ? parsed.tool_id : undefined
      if (toolId) state.toolNames.set(toolId, name)
      const payload = {
        tool: name,
        tool_id: toolId,
        args: parsed.parameters,
        item: parsed,
      }
      if (/shell|command/i.test(name)) await emit('command.started', payload)
      else if (/write|replace|edit|delete|move/i.test(name)) {
        await emit('file.change.updated', { ...payload, status: 'started' })
      } else {
        await emit('tool.requested', payload)
      }
      return
    }
    if (type === 'tool_result') {
      const toolId = typeof parsed.tool_id === 'string' ? parsed.tool_id : undefined
      const name = toolId ? state.toolNames.get(toolId) ?? 'Gemini tool' : 'Gemini tool'
      const failed = parsed.status === 'error'
      const payload = {
        tool: name,
        tool_id: toolId,
        status: failed ? 'failed' : 'completed',
        output: parsed.output,
        error: parsed.error,
        item: parsed,
      }
      if (/shell|command/i.test(name)) await emit('command.completed', payload)
      else if (/write|replace|edit|delete|move/i.test(name)) await emit('file.change.updated', payload)
      else await emit('tool.completed', payload)
      if (toolId) state.toolNames.delete(toolId)
      return
    }
    if (type === 'error') {
      await emit('warning', {
        provider: 'gemini',
        severity: parsed.severity,
        message: parsed.message,
      })
      return
    }
    if (type === 'result' && parsed.stats && typeof parsed.stats === 'object') {
      await emit('usage.updated', { provider: 'gemini', stats: parsed.stats })
    }
    return
  }
  if (providerId === 'cursor') {
    const subtype = String(parsed.subtype ?? '')
    if (type === 'tool_call') {
      const rawToolCall = parsed.tool_call
      const toolCall = rawToolCall && typeof rawToolCall === 'object' && !Array.isArray(rawToolCall)
        ? rawToolCall as Record<string, unknown>
        : {}
      const toolKey = Object.keys(toolCall)[0] ?? 'cursorToolCall'
      const payload = { item: parsed, tool: toolKey }
      if (subtype === 'started') {
        if (/shell|terminal|command/i.test(toolKey)) await emit('command.started', payload)
        else if (/write|edit|delete|move/i.test(toolKey)) await emit('file.change.updated', { ...payload, status: 'started' })
        else await emit('tool.requested', payload)
      } else if (subtype === 'completed') {
        if (/shell|terminal|command/i.test(toolKey)) await emit('command.completed', payload)
        else if (/write|edit|delete|move/i.test(toolKey)) await emit('file.change.updated', { ...payload, status: 'completed' })
        else await emit('tool.completed', payload)
      }
    }
    if ((type === 'system' || type === 'result') && typeof parsed.session_id === 'string') {
      await emit('tool.completed', {
        tool: 'cursor.session',
        session_id: parsed.session_id,
        persistent: true,
      })
    }
    return
  }

  const message = parsed.message
  const content = message && typeof message === 'object' && !Array.isArray(message)
    ? (message as Record<string, unknown>).content
    : undefined
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue
      const item = block as Record<string, unknown>
      const blockType = String(item.type ?? '')
      const name = typeof item.name === 'string' ? item.name : 'Claude tool'
      if (blockType === 'tool_use') {
        const toolId = typeof item.id === 'string' ? item.id : undefined
        if (toolId) state.toolNames.set(toolId, name)
        if (/^(Bash|Shell)$/i.test(name)) await emit('command.started', { tool: name, item })
        else if (/^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(name)) await emit('file.change.updated', { item, status: 'started' })
        else await emit('tool.requested', { tool: name, item })
      } else if (blockType === 'tool_result') {
        const toolId = typeof item.tool_use_id === 'string' ? item.tool_use_id : undefined
        const correlatedName = toolId ? state.toolNames.get(toolId) ?? name : name
        const payload = { tool: correlatedName, tool_id: toolId, item }
        if (/^(Bash|Shell)$/i.test(correlatedName)) await emit('command.completed', payload)
        else if (/^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(correlatedName)) {
          await emit('file.change.updated', { ...payload, status: 'completed' })
        } else {
          await emit('tool.completed', payload)
        }
        if (toolId) state.toolNames.delete(toolId)
      }
    }
  }
  if (type === 'result') {
    if (parsed.usage && typeof parsed.usage === 'object') await emit('usage.updated', { usage: parsed.usage })
    if (typeof parsed.session_id === 'string') await emit('tool.completed', { tool: 'claude.session', session_id: parsed.session_id, persistent: true })
  }
  if (type === 'system' && typeof parsed.session_id === 'string') {
    await emit('tool.completed', { tool: 'claude.session', session_id: parsed.session_id, persistent: true })
  }
}

function summarize(providerId: string, stdout: string, stderr: string): string {
  const raw = stdout.trim() || stderr.trim()
  let text = ''
  for (const line of raw.split(/\r?\n/)) {
    const incoming = normalizeCliLine(providerId, line)
    if (incoming) text = mergeCliText(text, incoming).output
  }
  text = text.trim()
  if (!text) return ''
  // Prefer last non-empty paragraph
  const parts = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const last = parts[parts.length - 1] ?? text
  return last.slice(-4_000)
}

/** Exported for unit tests. */
export { buildArgs }
