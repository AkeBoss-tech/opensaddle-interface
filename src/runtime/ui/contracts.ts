/**
 * Browser-agent runtime contracts.
 *
 * These types deliberately do not depend on React or the existing chat
 * service contracts. They are the stable boundary between an orchestrator,
 * capability-aware executors, and a UI that renders traces and artifacts.
 */

export type RuntimeExecutionKind = 'javascript' | 'wasm' | 'python' | 'webcontainer' | 'remote'

export type RuntimeEventType =
  | 'session.created'
  | 'session.checkpointed'
  | 'process.started'
  | 'process.stdout'
  | 'process.stderr'
  | 'process.exited'
  | 'tool.call.started'
  | 'tool.call.output'
  | 'tool.call.completed'
  | 'tool.call.failed'
  | 'permission.requested'
  | 'permission.granted'
  | 'permission.denied'
  | 'filesystem.changed'
  | 'artifact.created'
  | 'approval.requested'
  | 'approval.resolved'
  | 'runtime.paused'
  | 'runtime.resumed'
  | 'runtime.failed'
  | 'session.closed'

export interface RuntimeEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string
  sessionId: string
  sequence: number
  timestamp: string
  type: RuntimeEventType
  payload: TPayload
}

export interface JsonSchema {
  $schema?: string
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  title?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: Array<string | number | boolean | null>
  additionalProperties?: boolean | JsonSchema
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
}

export type CapabilityType =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'filesystem.search'
  | 'network.fetch'
  | 'model.invoke'
  | 'worker.spawn'
  | 'artifact.export'
  | 'secret.use'

export interface CapabilityRequest {
  type: CapabilityType
  pathPrefix?: string
  origins?: string[]
  methods?: string[]
  approval?: 'never' | 'once' | 'always'
}

export interface InvocationLimits {
  timeoutMs: number
  maxOutputBytes: number
  maxArtifactBytes?: number
  maxMemoryMb?: number
}

export interface ToolManifest<TInput = unknown, TOutput = unknown> {
  name: string
  version: string
  description: string
  runtime: RuntimeExecutionKind
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  capabilities: CapabilityRequest[]
  limits: InvocationLimits
  /** Type-only association for callers; schemas remain the runtime validator. */
  input?: TInput
  output?: TOutput
}

export interface InvocationContext {
  sessionId: string
  projectId: string
  agentId?: string
  userId: string
  signal: AbortSignal
}

export interface ToolInvocation<TArgs = unknown> {
  invocationId: string
  tool: string
  args: TArgs
  context: InvocationContext
  requestedAt: string
}

export interface RuntimeArtifact {
  artifactId: string
  kind: 'file' | 'diff' | 'report' | 'table' | 'preview' | 'blob'
  name: string
  mimeType?: string
  path?: string
  size?: number
  content?: string
  uri?: string
  metadata?: Record<string, unknown>
}

export interface ToolOutputChunk {
  stream: 'stdout' | 'stderr' | 'log' | 'progress'
  text?: string
  data?: unknown
}

export interface ToolResult<TOutput = unknown> {
  ok: boolean
  output?: TOutput
  chunks?: ToolOutputChunk[]
  artifacts?: RuntimeArtifact[]
  error?: { code: string; message: string; details?: unknown }
  durationMs: number
}

export interface PermissionDecision {
  allowed: boolean
  approvalRequired: boolean
  reason: string
  capabilityToken?: string
}

export interface ToolRuntimeAdapter {
  listTools(): Promise<Array<ToolManifest>>
  call<TArgs = unknown, TOutput = unknown>(
    invocation: ToolInvocation<TArgs>,
  ): AsyncIterable<RuntimeEvent | ToolResult<TOutput>>
  cancel(invocationId: string, reason?: string): Promise<void>
}

export interface RuntimeContract {
  tools: ToolRuntimeAdapter
  checkCapability(request: CapabilityRequest, context: InvocationContext): Promise<PermissionDecision>
  subscribe(listener: (event: RuntimeEvent) => void): () => void
}

export interface FilesystemReadArgs { path: string; encoding?: 'utf8' | 'base64' }
export interface FilesystemWriteArgs { path: string; content: string; encoding?: 'utf8' | 'base64' }
export interface JavascriptExecuteArgs { code: string; files?: Record<string, string> }
export interface HttpFetchArgs {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string
}

export const BROWSER_RUNTIME_TOOLS: ReadonlyArray<ToolManifest> = [
  {
    name: 'filesystem.read',
    version: '1.0.0',
    description: 'Read a project-scoped file through the virtual filesystem.',
    runtime: 'javascript',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, encoding: { type: 'string', enum: ['utf8', 'base64'] } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' }, encoding: { type: 'string' } }, additionalProperties: false },
    capabilities: [{ type: 'filesystem.read', pathPrefix: '/project', approval: 'never' }],
    limits: { timeoutMs: 5_000, maxOutputBytes: 1_000_000 },
  },
  {
    name: 'filesystem.write',
    version: '1.0.0',
    description: 'Write a file into a transactional project overlay.',
    runtime: 'javascript',
    inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' }, encoding: { type: 'string', enum: ['utf8', 'base64'] } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['path', 'size'], properties: { path: { type: 'string' }, size: { type: 'integer' } }, additionalProperties: false },
    capabilities: [{ type: 'filesystem.write', pathPrefix: '/project', approval: 'once' }],
    limits: { timeoutMs: 10_000, maxOutputBytes: 10_000, maxArtifactBytes: 10_000_000 },
  },
  {
    name: 'javascript.execute',
    version: '1.0.0',
    description: 'Execute a curated JavaScript tool in a dedicated Worker.',
    runtime: 'javascript',
    inputSchema: { type: 'object', required: ['code'], properties: { code: { type: 'string', maxLength: 100_000 }, files: { type: 'object' } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['stdout', 'stderr'], properties: { stdout: { type: 'string' }, stderr: { type: 'string' }, artifacts: { type: 'array' } }, additionalProperties: false },
    capabilities: [{ type: 'worker.spawn', approval: 'never' }],
    limits: { timeoutMs: 3_000, maxOutputBytes: 100_000, maxArtifactBytes: 10_000_000, maxMemoryMb: 128 },
  },
  {
    name: 'http.fetch',
    version: '1.0.0',
    description: 'Fetch an allowlisted origin through the network broker.',
    runtime: 'javascript',
    inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string', maxLength: 2_000 }, method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }, headers: { type: 'object' }, body: { type: 'string', maxLength: 1_000_000 } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['status', 'body'], properties: { status: { type: 'integer' }, headers: { type: 'object' }, body: { type: 'string' } }, additionalProperties: false },
    capabilities: [{ type: 'network.fetch', origins: [], methods: ['GET'], approval: 'once' }],
    limits: { timeoutMs: 15_000, maxOutputBytes: 1_000_000 },
  },
]
