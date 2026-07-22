import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import type { ModelGateway } from '../modelGateway.js'
import type { HarnessAdapter, HarnessRunInput, HarnessRunResult } from './types.js'

const MAX_STEPS = 12
const MAX_SHELL_OUTPUT = 32_000
const MAX_FILE_CHARS = 40_000

type ToolName = 'list_dir' | 'read_file' | 'write_file' | 'run_shell' | 'finish'

interface ToolCall {
  name: ToolName
  args: Record<string, string>
}

/**
 * Native OpenSaddle coding agent.
 *
 * Unlike CLI adapters that wrap Codex/Claude/etc., this harness owns the
 * agent loop: model gateway + bounded workspace tools inside the provisioned
 * runtime. Approvals for shell/write can be layered later via the control
 * plane approval API.
 */
export class OpenSaddleCodingHarness implements HarnessAdapter {
  readonly id = 'opensaddle'

  constructor(private readonly models: ModelGateway) {}

  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const sessionRoot = join(input.workspacePath, '.opensaddle-harness', input.runId)
    await mkdir(sessionRoot, { recursive: true, mode: 0o700 })

    const transcript: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: [
          'You are the OpenSaddle coding agent harness.',
          `Workspace root: ${input.workspacePath}`,
          `Project: ${input.projectId}`,
          'You may only touch files under the workspace root.',
          'Reply with EXACTLY one tool call per turn using this format:',
          'TOOL <name>',
          'ARG <key>=<value>',
          '...',
          'END',
          'Available tools:',
          '- list_dir path=. ',
          '- read_file path=relative/path',
          '- write_file path=relative/path content=... (use \\n for newlines)',
          '- run_shell command=... (cwd is workspace; no shell metacharacters chaining)',
          '- finish summary=... (required when done)',
          'Prefer small, verifiable steps. Do not invent file contents you have not read.',
        ].join('\n'),
      },
      { role: 'user', content: input.task },
    ]

    let summary = 'Completed without an explicit finish summary.'
    for (let step = 0; step < MAX_STEPS; step++) {
      if (input.signal.aborted) throw new Error('Run cancelled')

      const reply = await this.models.completeMessages({
        route: input.route,
        messages: transcript,
        signal: input.signal,
      })
      await input.emit('agent.output.delta', { text: reply })
      transcript.push({ role: 'assistant', content: reply })

      const call = parseToolCall(reply)
      if (!call) {
        transcript.push({
          role: 'user',
          content: 'Invalid format. Reply with TOOL/ARG/END only.',
        })
        continue
      }

      await input.emit('tool.requested', { tool: call.name, args: call.args, step })
      if (call.name === 'finish') {
        summary = call.args.summary ?? summary
        await input.emit('tool.completed', { tool: 'finish', summary })
        break
      }

      const result = await this.executeTool(input.workspacePath, call, input.signal)
      await input.emit('tool.completed', { tool: call.name, ok: result.ok, preview: result.output.slice(0, 500) })
      transcript.push({
        role: 'user',
        content: `TOOL_RESULT ${call.name}\n${result.output}`,
      })

      if (step === MAX_STEPS - 1) {
        summary = 'Stopped after max tool steps.'
      }
    }

    await writeFile(join(sessionRoot, 'session_result.json'), JSON.stringify({
      status: 'completed',
      summary,
      provider: this.id,
      finishedAt: new Date().toISOString(),
    }, null, 2))

    return { summary, providerId: this.id }
  }

  private async executeTool(
    workspacePath: string,
    call: ToolCall,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; output: string }> {
    try {
      switch (call.name) {
        case 'list_dir': {
          const target = safeResolve(workspacePath, call.args.path ?? '.')
          const entries = await readdir(target, { withFileTypes: true })
          const lines = entries.slice(0, 200).map((e) => `${e.isDirectory() ? 'dir' : 'file'}\t${e.name}`)
          return { ok: true, output: lines.join('\n') || '(empty)' }
        }
        case 'read_file': {
          const target = safeResolve(workspacePath, required(call.args, 'path'))
          const raw = await readFile(target, 'utf8')
          return { ok: true, output: raw.slice(0, MAX_FILE_CHARS) }
        }
        case 'write_file': {
          const target = safeResolve(workspacePath, required(call.args, 'path'))
          const content = (call.args.content ?? '').replace(/\\n/g, '\n')
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, content, 'utf8')
          return { ok: true, output: `wrote ${relative(workspacePath, target)} (${content.length} chars)` }
        }
        case 'run_shell': {
          const command = required(call.args, 'command')
          assertSafeShell(command)
          const output = await runShell(command, workspacePath, signal)
          return { ok: true, output: output.slice(0, MAX_SHELL_OUTPUT) }
        }
        default:
          return { ok: false, output: `Unknown tool ${String((call as ToolCall).name)}` }
      }
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) }
    }
  }
}

function required(args: Record<string, string>, key: string): string {
  const value = args[key]
  if (!value?.trim()) throw new Error(`Missing ARG ${key}`)
  return value
}

function safeResolve(workspacePath: string, rel: string): string {
  const root = resolve(workspacePath)
  const target = resolve(root, rel)
  const relToRoot = relative(root, target)
  if (relToRoot.startsWith('..') || relToRoot.includes(`..${sep}`)) {
    throw new Error(`Path escapes workspace: ${rel}`)
  }
  return target
}

function assertSafeShell(command: string): void {
  if (/[;&|`$<>]/.test(command) || command.includes('\n')) {
    throw new Error('Shell command contains disallowed metacharacters')
  }
  if (command.length > 500) throw new Error('Shell command too long')
}

function runShell(command: string, cwd: string, signal: AbortSignal): Promise<string> {
  const parts = command.trim().split(/\s+/).filter(Boolean)
  const program = parts[0]
  if (!program) throw new Error('Empty shell command')
  const args = parts.slice(1)

  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      cwd,
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    const onAbort = () => {
      try { child.kill('SIGTERM') } catch { /* ignore */ }
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8') })
    child.stderr.on('data', (c: Buffer) => { out += c.toString('utf8') })
    child.on('error', reject)
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      resolvePromise(`exit=${code}\n${out}`)
    })
  })
}

function parseToolCall(text: string): ToolCall | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const start = lines.findIndex((l) => l.startsWith('TOOL '))
  if (start < 0) return undefined
  const name = lines[start]!.slice(5).trim() as ToolName
  if (!['list_dir', 'read_file', 'write_file', 'run_shell', 'finish'].includes(name)) return undefined
  const args: Record<string, string> = {}
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line === 'END') break
    if (!line.startsWith('ARG ')) continue
    const body = line.slice(4)
    const eq = body.indexOf('=')
    if (eq < 0) continue
    args[body.slice(0, eq).trim()] = body.slice(eq + 1)
  }
  return { name, args }
}

export async function workspaceExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
