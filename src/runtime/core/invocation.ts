import type { CapabilityPolicy } from './capabilities'
import type { RuntimeEventBus } from './events'
import type { RuntimeLimits } from './types'

export interface ToolInvocationRequest<TArgs = unknown> {
  invocationId: string
  tool: string
  args: TArgs
  capability: string
  pathPrefix?: string
  origins?: string[]
  limits?: RuntimeLimits
}

export interface ToolInvocationResult<TResult = unknown> {
  ok: boolean
  result?: TResult
  error?: string
  durationMs: number
}

export type ToolExecutor<TArgs, TResult> = (args: TArgs, context: { signal: AbortSignal; emit: (payload: Record<string, unknown>) => void }) => Promise<TResult>

function bytes(value: unknown): number {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength
}

export async function invokeTool<TArgs, TResult>(
  request: ToolInvocationRequest<TArgs>,
  policy: CapabilityPolicy,
  events: RuntimeEventBus,
  execute: ToolExecutor<TArgs, TResult>,
): Promise<ToolInvocationResult<TResult>> {
  const permission = policy.evaluate({ capability: request.capability, pathPrefix: request.pathPrefix, origins: request.origins })
  if (!permission.allowed || permission.approvalRequired) {
    const reason = !permission.allowed ? permission.reason : 'Human approval required'
    events.emit('capability.denied', { capability: request.capability, reason }, { invocationId: request.invocationId })
    return { ok: false, error: reason, durationMs: 0 }
  }

  const started = performance.now()
  const controller = new AbortController()
  const timeout = request.limits?.timeoutMs ? globalThis.setTimeout(() => controller.abort('timeout'), request.limits.timeoutMs) : undefined
  events.emit('tool.started', { tool: request.tool }, { invocationId: request.invocationId })
  try {
    const result = await execute(request.args, {
      signal: controller.signal,
      emit: (payload) => {
        if (request.limits?.maxOutputBytes !== undefined && bytes(payload) > request.limits.maxOutputBytes) throw new Error('Tool output exceeds limit')
        events.emit('tool.output', payload, { invocationId: request.invocationId })
      },
    })
    if (request.limits?.maxOutputBytes !== undefined && bytes(result) > request.limits.maxOutputBytes) throw new Error('Tool result exceeds output limit')
    const durationMs = Math.round(performance.now() - started)
    events.emit('tool.completed', { tool: request.tool, durationMs }, { invocationId: request.invocationId })
    return { ok: true, result, durationMs }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const durationMs = Math.round(performance.now() - started)
    events.emit('tool.failed', { tool: request.tool, error: message, durationMs }, { invocationId: request.invocationId })
    return { ok: false, error: message, durationMs }
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout)
  }
}
