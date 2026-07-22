import type { RuntimeEventBus } from './events'
import type { RuntimeProcess, RuntimeProcessStatus } from './types'

export interface ProcessContext {
  signal: AbortSignal
  stdout(text: string): void
  stderr(text: string): void
}

export interface ProcessSpec {
  label: string
  run(context: ProcessContext): Promise<number | void>
}

interface InternalProcess extends RuntimeProcess {
  controller: AbortController
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

export class RuntimeProcessManager {
  private readonly processes = new Map<string, InternalProcess>()
  private readonly events: RuntimeEventBus

  constructor(events: RuntimeEventBus) {
    this.events = events
  }

  async start(spec: ProcessSpec): Promise<RuntimeProcess> {
    const processId = id('proc')
    const controller = new AbortController()
    const process: InternalProcess = {
      id: processId,
      label: spec.label,
      status: 'starting',
      startedAt: Date.now(),
      stdout: '',
      stderr: '',
      controller,
      kill: async (reason = 'killed') => {
        if (process.status === 'running' || process.status === 'starting') {
          process.status = 'cancelled'
          process.error = reason
          controller.abort(reason)
          this.events.emit('process.cancelled', { reason }, { processId })
        }
      },
    }
    this.processes.set(processId, process)
    process.status = 'running'
    this.events.emit('process.started', { label: spec.label }, { processId })

    void spec.run({
      signal: controller.signal,
      stdout: (text) => { process.stdout += text; this.events.emit('process.stdout', { text }, { processId }) },
      stderr: (text) => { process.stderr += text; this.events.emit('process.stderr', { text }, { processId }) },
    }).then((exitCode) => {
      if (process.status !== 'running') return
      process.status = 'stopped'
      process.exitCode = exitCode ?? 0
      process.finishedAt = Date.now()
      this.events.emit('process.completed', { exitCode: process.exitCode }, { processId })
    }).catch((error: unknown) => {
      if (process.status === 'cancelled') return
      process.status = 'failed'
      process.error = error instanceof Error ? error.message : String(error)
      process.finishedAt = Date.now()
      this.events.emit('process.failed', { error: process.error }, { processId })
    })
    return process
  }

  get(processId: string): RuntimeProcess | undefined {
    return this.processes.get(processId)
  }

  list(status?: RuntimeProcessStatus): RuntimeProcess[] {
    return [...this.processes.values()].filter((process) => !status || process.status === status)
  }
}
