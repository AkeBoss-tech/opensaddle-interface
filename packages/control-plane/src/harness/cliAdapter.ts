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
    const args = buildArgs(this.profile, input.task, input.workspacePath, modelId)
    const sessionRoot = join(input.workspacePath, '.opensaddle-harness', input.runId)

    await input.emit('agent.started', {
      model: input.route.modelKey,
      cli_model: modelId,
      harness: input.route.harnessKey,
      provider: this.id,
      runtime: input.route.runtimeKey,
    })

    const result = await runProcessSession({
      command: this.profile.command,
      args,
      cwd: input.workspacePath,
      signal: input.signal,
      sessionRoot,
      emit: input.emit,
      onStdoutLine: (line) => normalizeCliLine(this.profile.id, line),
    })

    if (input.signal.aborted) throw new Error('Run cancelled')

    if (result.exitCode !== 0 && result.exitCode !== null) {
      const errTail = result.stderr.trim().slice(-1_500) || result.stdout.trim().slice(-1_500)
      throw new Error(
        `${this.profile.label} exited with code ${result.exitCode}`
        + (errTail ? `: ${errTail}` : ''),
      )
    }

    const summary = summarize(result.stdout, result.stderr)
    if (summary) await input.emit('agent.output.delta', { text: summary })

    return {
      summary: summary || `${this.profile.label} completed`,
      exitCode: result.exitCode ?? 0,
      providerId: this.id,
    }
  }
}

function buildArgs(
  profile: HarnessProfile,
  task: string,
  workspacePath: string,
  modelId?: string,
): string[] {
  const args = [...(profile.baseArgs ?? []), ...(profile.streamArgs ?? [])]
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
  return args
}

function summarize(stdout: string, stderr: string): string {
  const text = stdout.trim() || stderr.trim()
  if (!text) return ''
  // Prefer last non-empty paragraph
  const parts = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const last = parts[parts.length - 1] ?? text
  return last.slice(-4_000)
}

/** Exported for unit tests. */
export { buildArgs }
