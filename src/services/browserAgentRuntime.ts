import type { FileStore, PermissionClient, SandboxClient } from './contracts'
import { BROWSER_RUNTIME_TOOLS } from '../runtime/ui'

export type BrowserCapability =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'javascript.execute'
  | 'network.fetch'
  | 'artifact.create'

export interface BrowserToolCall {
  tool: 'filesystem.read' | 'filesystem.write' | 'javascript.execute' | 'http.fetch'
  args: Record<string, unknown>
  projectId: string
  agentId?: string
  userId: string
}

export interface BrowserRuntimeEvent {
  id: string
  invocationId: string
  type: 'tool.requested' | 'tool.output' | 'file.changed' | 'artifact.created' | 'tool.completed' | 'tool.failed'
  timestamp: string
  payload: Record<string, unknown>
}

export interface BrowserToolResult {
  ok: boolean
  data?: unknown
  error?: string
  events: BrowserRuntimeEvent[]
}

const MAX_TEXT = 100_000
const MAX_RESPONSE = 250_000
const DEFAULT_TIMEOUT = 3_000

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`
}

function normalizePath(path: string): string {
  const value = path.replaceAll('\\', '/').trim()
  const parts = value.split('/').filter(Boolean)
  const clean: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (!clean.length) throw new Error('Path escapes the project root')
      clean.pop()
    } else clean.push(part)
  }
  return clean.join('/')
}

function projectPath(projectId: string, path: string): string {
  const cleanProject = normalizePath(projectId)
  const cleanPath = normalizePath(path)
  if (!cleanProject || cleanProject.includes('/')) throw new Error('Invalid project id')
  return `projects/${cleanProject}/${cleanPath}`
}

function text(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  if (value.length > MAX_TEXT) throw new Error(`${key} exceeds ${MAX_TEXT} characters`)
  return value
}

/**
 * Browser-first agent tools. The model never receives raw browser handles or
 * direct access to application state; every operation crosses this policy
 * boundary and is emitted as an auditable event.
 */
export class BrowserAgentRuntime {
  private readonly listeners = new Set<(event: BrowserRuntimeEvent) => void>()
  private readonly files: FileStore
  private readonly sandbox: SandboxClient
  private readonly permissions: PermissionClient
  private readonly allowedNetworkOrigins: string[]

  constructor(
    files: FileStore,
    sandbox: SandboxClient,
    permissions: PermissionClient,
    allowedNetworkOrigins: string[] = [],
  ) {
    this.files = files
    this.sandbox = sandbox
    this.permissions = permissions
    this.allowedNetworkOrigins = allowedNetworkOrigins
  }

  subscribe(listener: (event: BrowserRuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  listTools() {
    return BROWSER_RUNTIME_TOOLS
  }

  async call(input: BrowserToolCall): Promise<BrowserToolResult> {
    const invocationId = uid('inv')
    const events: BrowserRuntimeEvent[] = []
    const emit = (type: BrowserRuntimeEvent['type'], payload: Record<string, unknown>) => {
      const event = { id: uid('evt'), invocationId, type, timestamp: new Date().toISOString(), payload }
      events.push(event)
      this.listeners.forEach((listener) => listener(event))
    }

    emit('tool.requested', { tool: input.tool })
    try {
      const result = await this.execute(input, emit)
      emit('tool.completed', { tool: input.tool })
      return { ok: true, data: result, events }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emit('tool.failed', { tool: input.tool, error: message })
      return { ok: false, error: message, events }
    }
  }

  private async authorize(input: BrowserToolCall, action: 'read' | 'write' | 'execute', path?: string): Promise<void> {
    const check = await this.permissions.check({
      userId: input.userId,
      agentId: input.agentId,
      resourceKind: 'project',
      resourceId: input.projectId,
      action,
      path,
    })
    if (!check.allowed) throw new Error(check.reason)
    if (check.approvalRequired) throw new Error(`Approval required for ${action}${path ? ` on ${path}` : ''}`)
  }

  private async execute(
    input: BrowserToolCall,
    emit: (type: BrowserRuntimeEvent['type'], payload: Record<string, unknown>) => void,
  ): Promise<unknown> {
    if (input.tool === 'filesystem.read') {
      const path = text(input.args.path, 'path')
      await this.authorize(input, 'read', path)
      const content = await this.files.read(projectPath(input.projectId, path))
      emit('tool.output', { chars: content.length })
      return { path, content: content.slice(0, MAX_TEXT) }
    }

    if (input.tool === 'filesystem.write') {
      const path = text(input.args.path, 'path')
      const content = text(input.args.content, 'content')
      await this.authorize(input, 'write', path)
      await this.files.write(projectPath(input.projectId, path), content)
      emit('file.changed', { path, bytes: content.length })
      return { path, bytes: content.length }
    }

    if (input.tool === 'javascript.execute') {
      const code = text(input.args.code, 'code')
      await this.authorize(input, 'execute')
      const result = await this.sandbox.run({ language: 'javascript', code, timeoutMs: Number(input.args.timeoutMs) || DEFAULT_TIMEOUT })
      emit('tool.output', { stdout: result.stdout.slice(0, MAX_TEXT), stderr: result.stderr.slice(0, MAX_TEXT) })
      if (result.artifacts?.length) emit('artifact.created', { artifacts: result.artifacts })
      return result
    }

    if (input.tool === 'http.fetch') {
      await this.authorize(input, 'execute')
      const url = new URL(text(input.args.url, 'url'))
      if (url.protocol !== 'https:') throw new Error('Only HTTPS network requests are allowed')
      if (!this.allowedNetworkOrigins.includes(url.origin)) {
        throw new Error(`Network origin is not allowlisted: ${url.origin}`)
      }
      const response = await fetch(url, { method: input.args.method === 'POST' ? 'POST' : 'GET' })
      const body = (await response.text()).slice(0, MAX_RESPONSE)
      emit('tool.output', { status: response.status, bytes: body.length, origin: url.origin })
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body }
    }

    throw new Error(`Unknown browser tool: ${input.tool}`)
  }
}
