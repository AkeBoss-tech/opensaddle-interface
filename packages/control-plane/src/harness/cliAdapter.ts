import { join } from 'node:path'
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
    const args = buildArgs(this.profile, input.task, input.workspacePath, modelId, input.executionPolicy)
    const sessionRoot = join(input.workspacePath, '.opensaddle-harness', input.runId)

    await input.emit('agent.started', {
      model: input.route.modelKey,
      cli_model: modelId,
      harness: input.route.harnessKey,
      provider: this.id,
      runtime: input.route.runtimeKey,
    })

    let streamedText = ''
    const result = await runProcessSession({
      command: this.profile.command,
      args,
      cwd: input.workspacePath,
      signal: input.signal,
      sessionRoot,
      emit: input.emit,
      onStdoutLine: async (line) => {
        await emitStructuredCliEvent(this.profile.id, line, input.emit)
        const incoming = normalizeCliLine(this.profile.id, line)
        if (!incoming) return undefined
        const merged = mergeCliText(streamedText, incoming)
        streamedText = merged.output
        return merged.delta
      },
    })

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
): string[] {
  const args = [...(profile.baseArgs ?? []), ...(profile.streamArgs ?? [])]
  const policyArgs: string[] = []
  if (profile.id === 'claude' && executionPolicy) {
    const permissionMode = executionPolicy.sandbox === 'full-access' && executionPolicy.approvals === 'never'
      ? 'bypassPermissions'
      : executionPolicy.sandbox === 'read-only'
        ? 'plan'
        : 'acceptEdits'
    policyArgs.push('--permission-mode', permissionMode)
    if (permissionMode === 'bypassPermissions') policyArgs.push('--dangerously-skip-permissions')
    if (executionPolicy.allowedTools.length) policyArgs.push('--allowedTools', executionPolicy.allowedTools.join(','))
    if (executionPolicy.deniedTools.length) policyArgs.push('--disallowedTools', executionPolicy.deniedTools.join(','))
  }
  if (profile.modelFlag && modelId) {
    args.push(profile.modelFlag, modelId)
  }
  if (profile.cwdArgs?.length) {
    args.push(...profile.cwdArgs, workspacePath)
  }

  switch (profile.promptMode) {
    case 'final_arg':
      args.push(task)
      break
    case 'flag':
      args.push(profile.promptFlag ?? '--prompt', task)
      break
    case 'stdin':
      // stdin mode not yet wired; fall back to final arg
      args.push(task)
      break
    case 'native':
      break
  }
  // Claude's tool flags are variadic. Keep them after the positional prompt
  // so the CLI parser cannot consume the prompt as another tool name.
  args.push(...policyArgs)
  return args
}

async function emitStructuredCliEvent(
  providerId: string,
  line: string,
  emit: import('./types.js').HarnessEmit,
): Promise<void> {
  if (providerId !== 'claude' || !line.trim().startsWith('{')) return
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }
  const type = String(parsed.type ?? '')
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
        if (/^(Bash|Shell)$/i.test(name)) await emit('command.started', { item })
        else if (/^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(name)) await emit('file.change.updated', { item, status: 'started' })
        else await emit('tool.requested', { tool: name, item })
      } else if (blockType === 'tool_result') {
        await emit('tool.completed', { tool: name, item })
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
