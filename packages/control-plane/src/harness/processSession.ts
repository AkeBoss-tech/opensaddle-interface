import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HarnessEmit } from './types.js'

export interface ProcessSessionInput {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  signal: AbortSignal
  sessionRoot: string
  emit: HarnessEmit
  /** Optional line parser — return text to stream as agent.output.delta. */
  onStdoutLine?: (line: string) => Promise<string | undefined> | string | undefined
  maxOutputBytes?: number
}

export interface ProcessSessionResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024

/**
 * Allowlisted CLI process session.
 * Inspired by T3 ProcessRunner (limits, no shell) and KRAIL LocalCLIRunner
 * (durable .runner logs under the session root).
 */
export async function runProcessSession(input: ProcessSessionInput): Promise<ProcessSessionResult> {
  const maxBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT
  const runnerDir = join(input.sessionRoot, '.runner')
  mkdirSync(runnerDir, { recursive: true, mode: 0o700 })

  const stdoutPath = join(runnerDir, 'stdout.log')
  const stderrPath = join(runnerDir, 'stderr.log')
  const commandPath = join(runnerDir, 'command.json')
  writeFileSync(commandPath, JSON.stringify({
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    startedAt: new Date().toISOString(),
  }, null, 2))

  await input.emit('tool.requested', {
    tool: 'cli.spawn',
    command: input.command,
    args: input.args,
  })

  return await new Promise<ProcessSessionResult>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }

    writeFileSync(join(runnerDir, 'pid.txt'), String(child.pid ?? ''))
    const stdoutStream = createWriteStream(stdoutPath, { flags: 'a' })
    const stderrStream = createWriteStream(stderrPath, { flags: 'a' })

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let lineBuf = ''

    const onAbort = () => {
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
      }, 2_000).unref()
    }
    if (input.signal.aborted) onAbort()
    else input.signal.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes <= maxBytes) {
        const text = chunk.toString('utf8')
        stdout += text
        stdoutStream.write(chunk)
        lineBuf += text
        const lines = lineBuf.split(/\r?\n/)
        lineBuf = lines.pop() ?? ''
        for (const line of lines) {
          void Promise.resolve(input.onStdoutLine?.(line)).then((delta) => {
            if (delta?.trim()) return input.emit('agent.output.delta', { text: delta })
            return undefined
          }).catch(() => undefined)
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes <= maxBytes) {
        stderr += chunk.toString('utf8')
        stderrStream.write(chunk)
      }
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      input.signal.removeEventListener('abort', onAbort)
      stdoutStream.end()
      stderrStream.end()
      reject(error)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      input.signal.removeEventListener('abort', onAbort)
      if (lineBuf.trim()) {
        void Promise.resolve(input.onStdoutLine?.(lineBuf)).then((delta) => {
          if (delta?.trim()) return input.emit('agent.output.delta', { text: delta })
          return undefined
        }).catch(() => undefined)
      }
      stdoutStream.end()
      stderrStream.end()
      writeFileSync(join(runnerDir, 'exit_code.txt'), String(code ?? ''))
      void input.emit('tool.completed', {
        tool: 'cli.spawn',
        exit_code: code,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
      })
      resolve({
        exitCode: code,
        stdout,
        stderr,
        timedOut: false,
      })
    })
  })
}
