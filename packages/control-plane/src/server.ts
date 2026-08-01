import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import { authenticate, redactUrl } from './auth.js'
import { loadConfig } from './config.js'
import {
  applyTaskCapabilities,
  policyForExecutionMode,
  unsupportedTaskCapabilities,
  type HarnessPolicyControls,
  type RunExecutionMode,
  type TaskCapabilityId,
} from './executionModes.js'
import { GitWorkspaceError, GitWorkspaceService } from './gitWorkspace.js'
import { HarnessCapabilityRegistry } from './harness/capabilityRegistry.js'
import { HarnessRegistry } from './harness/index.js'
import { mergeProfiles } from './harness/profiles.js'
import type { HarnessProfile } from './harness/types.js'
import { LocalSessionDiscovery, type LocalSessionProvider } from './localSessions.js'
import { ModelGateway } from './modelGateway.js'
import { canDelegateToAgent, evaluatePermissions, requireAdmin } from './permissions.js'
import { ProjectFilesystemError, ProjectFilesystemService } from './projectFilesystem.js'
import { RuntimeProvisioner } from './provisioner.js'
import { estimateRoute, selectReadyCodingProvider } from './router.js'
import { RunManager } from './runManager.js'
import { StateStore } from './store.js'
import type {
  ApprovalRecord,
  AuthPrincipal,
  CodingProvider,
  Harness,
  HarnessExecutionPolicy,
  ModelKey,
  PermissionGrant,
  PrincipalKind,
  ResourceKind,
  RuntimeKind,
  ThreadMessageRecord,
  ThreadRecord,
} from './types.js'

declare module 'fastify' {
  interface FastifyRequest {
    principal: AuthPrincipal
  }
}

const config = loadConfig()
const store = new StateStore(config)
await store.init()
const models = new ModelGateway(config)
const provisioner = new RuntimeProvisioner(config, store)
const harnesses = new HarnessRegistry(config, models)
const runs = new RunManager(config, store, models, provisioner, harnesses)
await runs.recoverInterruptedRuns()
const localSessions = new LocalSessionDiscovery()
const harnessCapabilities = new HarnessCapabilityRegistry({
  profiles: mergeProfiles(config.harnessProfiles),
  enabledProviderIds: config.codingProviders,
  nativeAvailable: harnesses.list().some((status) => status.id === 'opensaddle' && status.availability === 'available'),
  nativeUnavailableReason: 'Configure a local model endpoint in Settings before using the OpenSaddle harness',
})
const git = new GitWorkspaceService([...config.allowedRepoRoots, config.workspaceDir], () => {
  if (config.mode !== 'local') return []
  const projects = store.workspace()?.projects
  if (!Array.isArray(projects)) return []
  return projects.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const local = (candidate as Record<string, unknown>).local
    if (!local || typeof local !== 'object' || Array.isArray(local)) return []
    const rootPath = (local as Record<string, unknown>).rootPath
    return typeof rootPath === 'string' ? [rootPath] : []
  })
})
const app = Fastify({
  logger: {
    level: process.env.OPENSADDLE_LOG_LEVEL ?? 'info',
    redact: ['req.headers.authorization', 'headers.authorization'],
  },
  bodyLimit: 5_242_880,
  requestTimeout: 30_000,
})

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) callback(null, true)
    else callback(new Error('Origin not allowed'), false)
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-OpenSaddle-User', 'If-Unmodified-Since'],
})

app.addHook('preHandler', async (request, reply) => {
  if (request.url === '/api/health' || request.url.startsWith('/api/public/sites/')) return
  const principal = authenticate(request, config)
  if (!principal) {
    await reply.code(401).send({ error: 'authentication_required' })
    return reply
  }
  request.principal = principal
})

function objectBody(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new Error('JSON object body required')
  }
  return request.body as Record<string, unknown>
}

function requiredString(body: Record<string, unknown>, key: string, max = 20_000): string {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  if (value.length > max) throw new Error(`${key} exceeds ${max} characters`)
  return value.trim()
}

function optionalString(body: Record<string, unknown>, key: string, max = 2_000): string | undefined {
  const value = body[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  if (value.length > max) throw new Error(`${key} exceeds ${max} characters`)
  return value.trim()
}

function threadContinuation(value: unknown): ThreadRecord['continuation'] {
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('continuation must be an object')
  }
  const input = value as Record<string, unknown>
  const provider = enumValue(input, 'provider', ['codex', 'claude', 'cursor', 'gemini'] as const)
  const authority = enumValue(input, 'authority', ['source_managed', 'opensaddle_managed', 'hybrid'] as const)
  const mode = enumValue(input, 'mode', ['resume', 'fork'] as const)
  const checkpointId = optionalString(input, 'checkpointId', 300)
  const sessionId = requiredString(input, 'sessionId', 300)
  const sourcePath = requiredString(input, 'sourcePath', 2_000)
  if (!provider || !authority) throw new Error('continuation provider and authority are required')
  return { provider, sessionId, sourcePath, authority, mode, checkpointId }
}

function threadRunConfig(value: unknown): ThreadRecord['runConfig'] {
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('run_config must be an object')
  }
  const input = value as Record<string, unknown>
  const auto = optionalBoolean(input, 'auto')
  const executionMode = enumValue(input, 'executionMode', ['plan', 'project', 'review', 'full-access'] as const)
  const tools = stringArray(input, 'tools', 50, 100) ?? []
  if (auto === undefined || !executionMode) throw new Error('run_config auto and executionMode are required')
  return {
    auto,
    providerKey: requiredString(input, 'providerKey', 100),
    modelKey: requiredString(input, 'modelKey', 200),
    harnessKey: requiredString(input, 'harnessKey', 100),
    runtimeKey: requiredString(input, 'runtimeKey', 100),
    executionMode,
    tools,
    openRouterModelId: optionalString(input, 'openRouterModelId', 300),
    reasoningEffort: optionalString(input, 'reasoningEffort', 20),
  }
}

function enumValue<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = body[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${key} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function permissionDenied(reply: FastifyReply, reason: string) {
  return reply.code(403).send({ error: 'permission_denied', reason })
}

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
  return value
}

function stringArray(body: Record<string, unknown>, key: string, maxItems = 200, maxItemLength = 200): string[] | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > maxItemLength)) {
    throw new Error(`${key} must be an array of strings`)
  }
  return [...new Set(value.map((item) => item.trim()))].slice(0, maxItems)
}

function boundedNumber(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isInteger(parsed) || (parsed as number) < 1 || (parsed as number) > max) {
    throw new Error(`limit must be an integer between 1 and ${max}`)
  }
  return parsed as number
}

function encodeCursor(cursor: { pinned?: boolean; updatedAt?: number; createdAt?: number; id: string }): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeCursor(value: unknown, kind: 'thread' | 'message'): {
  pinned?: boolean
  updatedAt?: number
  createdAt?: number
  id: string
} | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 500) throw new Error('cursor is invalid')
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    const timestamp = kind === 'thread' ? cursor.updatedAt : cursor.createdAt
    if (!Number.isInteger(timestamp) || typeof cursor.id !== 'string' || !cursor.id) throw new Error('invalid cursor')
    if (kind === 'thread' && typeof cursor.pinned !== 'boolean') throw new Error('invalid cursor')
    return kind === 'thread'
      ? { pinned: cursor.pinned as boolean, updatedAt: timestamp as number, id: cursor.id }
      : { createdAt: timestamp as number, id: cursor.id }
  } catch {
    throw new Error('cursor is invalid')
  }
}

function apiThread(thread: ThreadRecord) {
  return {
    id: thread.id,
    owner_id: thread.ownerId,
    project_id: thread.projectId,
    title: thread.title,
    visibility: thread.visibility,
    shared_with: thread.sharedWith,
    agent_id: thread.agentId,
    run_config: thread.runConfig,
    continuation: thread.continuation,
    branched_from_id: thread.branchedFromId,
    pinned: thread.pinned,
    archived_at: thread.archivedAt,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
  }
}

function apiMessage(message: ThreadMessageRecord) {
  return {
    id: message.id,
    thread_id: message.threadId,
    role: message.role,
    text: message.text,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
    payload: message.payload,
  }
}

function threadPermission(request: FastifyRequest, thread: ThreadRecord, action: 'read' | 'write') {
  const direct = evaluatePermissions(store.grants(), {
    userId: request.principal.userId,
    resourceKind: 'thread',
    resourceId: thread.id,
    action,
  })
  if (direct.allowed || direct.reason.startsWith('Denied')) return direct
  if (thread.ownerId === request.principal.userId || request.principal.roles.includes('admin')) {
    return { allowed: true, reason: 'Allowed as thread owner', matchedGrantIds: [], approvalRequired: false }
  }
  if (action === 'read' && thread.sharedWith.includes(request.principal.userId)) {
    return { allowed: true, reason: 'Allowed through thread sharing', matchedGrantIds: [], approvalRequired: false }
  }
  if (thread.visibility === 'project') {
    return evaluatePermissions(store.grants(), {
      userId: request.principal.userId,
      resourceKind: 'project',
      resourceId: thread.projectId,
      action,
    })
  }
  return direct
}

function projectRoutingDefaults(projectId: string): {
  modelKey?: ModelKey
  providerKey?: CodingProvider
  runtimeKey?: RuntimeKind
  reviewProviderKey?: CodingProvider
} {
  const projects = store.workspace()?.projects
  if (!Array.isArray(projects)) return {}
  const project = projects.find((candidate) =>
    candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>).id === projectId,
  ) as Record<string, unknown> | undefined
  const defaults = project?.routingDefaults
  return defaults && typeof defaults === 'object' && !Array.isArray(defaults)
    ? defaults as {
      modelKey?: ModelKey
      providerKey?: CodingProvider
      runtimeKey?: RuntimeKind
      reviewProviderKey?: CodingProvider
    }
    : {}
}

function workspaceDocument(collection: string, id: string): Record<string, unknown> | undefined {
  const items = store.workspace()?.[collection]
  if (!Array.isArray(items)) return undefined
  return items.find((candidate): candidate is Record<string, unknown> =>
    Boolean(candidate)
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
    && (candidate as Record<string, unknown>).id === id)
}

function localProjectRoot(projectId: string): string {
  if (config.mode !== 'local') throw new Error('Local project files are only available in local mode')
  const project = workspaceDocument('projects', projectId)
  const local = project?.local
  if (!local || typeof local !== 'object' || Array.isArray(local)) {
    throw new Error('project_id must identify a configured local project')
  }
  const rootPath = (local as Record<string, unknown>).rootPath
  if (typeof rootPath !== 'string' || !rootPath.trim()) {
    throw new Error('project_id must identify a configured local project')
  }
  return rootPath
}

function projectReadPermission(request: FastifyRequest, reply: FastifyReply, projectId: string) {
  const permission = evaluatePermissions(store.grants(), {
    userId: request.principal.userId,
    resourceKind: 'project',
    resourceId: projectId,
    action: 'read',
  })
  return permission.allowed ? null : permissionDenied(reply, permission.reason)
}

function projectWritePermission(request: FastifyRequest, reply: FastifyReply, projectId: string) {
  const permission = evaluatePermissions(store.grants(), {
    userId: request.principal.userId,
    resourceKind: 'project',
    resourceId: projectId,
    action: 'write',
  })
  return permission.allowed ? null : permissionDenied(reply, permission.reason)
}

function projectFilesystem(projectId: string): { root: string; service: ProjectFilesystemService } {
  const root = localProjectRoot(projectId)
  return {
    root,
    // The project root comes from the authenticated workspace document rather
    // than request input. The service still canonicalizes it and enforces
    // containment for every target and symlink.
    service: new ProjectFilesystemService([...config.allowedRepoRoots, root]),
  }
}

const BUILTIN_PROVIDER_IDS = new Set(['opensaddle', 'codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity'])

function configuredHarnessProfile(candidate: unknown): {
  profile: HarnessProfile
  models: string[]
} | undefined {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
  const configured = candidate as Record<string, unknown>
  if (typeof configured.id !== 'string'
    || typeof configured.label !== 'string'
    || typeof configured.command !== 'string') return undefined
  const protocol = configured.protocol === 'acp' ? 'acp' : 'cli'
  const promptMode = configured.promptMode
  return {
    profile: {
      id: configured.id,
      label: configured.label,
      command: configured.command,
      description: typeof configured.description === 'string' ? configured.description : 'Project-local harness',
      kind: 'cli',
      protocol,
      promptMode: protocol === 'acp'
        ? 'native'
        : promptMode === 'flag' || promptMode === 'stdin'
          ? promptMode
          : 'final_arg',
      promptFlag: typeof configured.promptFlag === 'string' ? configured.promptFlag : undefined,
      baseArgs: Array.isArray(configured.args)
        ? configured.args.filter((value): value is string => typeof value === 'string').slice(0, 100)
        : [],
      modelFlag: typeof configured.modelFlag === 'string' ? configured.modelFlag : undefined,
      codingAffinity: 1,
      supportsCancel: true,
      supportsStreaming: configured.supportsStreaming !== false,
    },
    models: Array.isArray(configured.models)
      ? configured.models.filter((value): value is string => typeof value === 'string').slice(0, 100)
      : [],
  }
}

function configuredCustomHarnesses(): Array<{ profile: HarnessProfile; models: string[] }> {
  if (config.mode !== 'local') return []
  const projects = store.workspace()?.projects
  if (!Array.isArray(projects)) return []
  const byId = new Map<string, { profile: HarnessProfile; models: string[] }>()
  for (const candidate of projects) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const local = (candidate as Record<string, unknown>).local
    if (!local || typeof local !== 'object' || Array.isArray(local)) continue
    const harnesses = (local as Record<string, unknown>).harnesses
    if (!Array.isArray(harnesses)) continue
    for (const harness of harnesses) {
      const parsed = configuredHarnessProfile(harness)
      if (parsed) byId.set(parsed.profile.id, parsed)
    }
  }
  return [...byId.values()]
}

let customHarnessCapabilityCache: {
  signature: string
  registry: HarnessCapabilityRegistry
} | undefined

function customHarnessCapabilityRegistry(
  definitions = configuredCustomHarnesses(),
): HarnessCapabilityRegistry | undefined {
  if (!definitions.length) return undefined
  const signature = JSON.stringify(definitions)
  if (customHarnessCapabilityCache?.signature === signature) return customHarnessCapabilityCache.registry
  const configuredModels = Object.fromEntries(definitions.map(({ profile, models }) => [profile.id, models]))
  const registry = new HarnessCapabilityRegistry({
    profiles: definitions.map(({ profile }) => profile),
    configuredModels,
  })
  customHarnessCapabilityCache = { signature, registry }
  return registry
}

async function discoverHarnessCapabilities(forceRefresh = false) {
  const builtin = await harnessCapabilities.discover(forceRefresh)
  const customRegistry = customHarnessCapabilityRegistry()
  if (!customRegistry) return builtin
  const custom = await customRegistry.discover(forceRefresh)
  return {
    generatedAt: new Date().toISOString(),
    harnesses: [...builtin.harnesses, ...custom.harnesses],
  }
}

function localRunSettings(projectId: string, agentId?: string): {
  repo?: string
  harnessId?: string
  profile?: HarnessProfile
  policy?: HarnessExecutionPolicy
} {
  if (config.mode !== 'local') return {}
  const project = workspaceDocument('projects', projectId)
  const local = project?.local
  if (!local || typeof local !== 'object' || Array.isArray(local)) return {}
  const localRecord = local as Record<string, unknown>
  const agent = agentId ? workspaceDocument('agents', agentId) : undefined
  const harnessId = typeof agent?.harnessId === 'string'
    ? agent.harnessId
    : typeof localRecord.defaultHarnessId === 'string'
      ? localRecord.defaultHarnessId
      : undefined
  const configuredHarnesses = Array.isArray(localRecord.harnesses) ? localRecord.harnesses : []
  const configured = configuredHarnesses.find((candidate) =>
    candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    && (candidate as Record<string, unknown>).id === harnessId) as Record<string, unknown> | undefined
  const profile = configuredHarnessProfile(configured)?.profile
  const preset = localRecord.permissionPreset
  const agentPolicy = agent?.permissionPolicy
  const candidatePolicy = agentPolicy && typeof agentPolicy === 'object' && !Array.isArray(agentPolicy)
    ? agentPolicy as Record<string, unknown>
    : {}
  const sandbox = candidatePolicy.sandbox === 'read-only'
    || candidatePolicy.sandbox === 'workspace-write'
    || candidatePolicy.sandbox === 'full-access'
    ? candidatePolicy.sandbox
    : preset === 'read-only' || preset === 'full-access' ? preset : 'workspace-write'
  const approvals = candidatePolicy.approvals === 'always'
    || candidatePolicy.approvals === 'on-request'
    || candidatePolicy.approvals === 'never'
    ? candidatePolicy.approvals
    : sandbox === 'full-access' ? 'never' : sandbox === 'read-only' ? 'always' : 'on-request'
  return {
    repo: typeof localRecord.rootPath === 'string' ? localRecord.rootPath : undefined,
    harnessId,
    profile,
    policy: {
      sandbox,
      approvals,
      network: typeof candidatePolicy.network === 'boolean' ? candidatePolicy.network : sandbox === 'full-access',
      allowedTools: Array.isArray(candidatePolicy.allowedTools)
        ? candidatePolicy.allowedTools.filter((value): value is string => typeof value === 'string').slice(0, 100)
        : [],
      deniedTools: Array.isArray(candidatePolicy.deniedTools)
        ? candidatePolicy.deniedTools.filter((value): value is string => typeof value === 'string').slice(0, 100)
        : [],
    },
  }
}

function requestedModelId(body: Record<string, unknown>): string | undefined {
  const modelId = optionalString(body, 'model_id', 300)
  if (!modelId) return undefined
  const providerKey = optionalString(body, 'provider_key', 100)
  if (providerKey && !['auto', 'opensaddle'].includes(providerKey)) return modelId
  if (config.modelProvider !== 'openrouter') throw new Error('model_id is only available with OpenRouter')
  if (!modelId.endsWith(':free')) throw new Error('model_id must be a free OpenRouter model')
  return modelId
}

app.setErrorHandler(async (error, request, reply) => {
  request.log.warn({ err: error }, 'request failed')
  if (error instanceof GitWorkspaceError) {
    await reply.code(error.statusCode).send({
      error: error.code,
      message: error.message,
      detail: error.detail,
    })
    return
  }
  if (error instanceof ProjectFilesystemError) {
    await reply.code(error.statusCode).send({
      error: error.code,
      message: error.message,
    })
    return
  }
  const message = error instanceof Error ? error.message : 'Unknown server error'
  const status = message.includes('required')
    || message.includes('must be')
    || message.includes('exceeds')
    ? 400
    : 500
  await reply.code(status).send({
    error: status === 400 ? 'invalid_request' : 'internal_error',
    message: status === 400 ? message : 'The control plane could not complete the request',
  })
})

app.get('/api/health', async () => {
  const latestCapabilities = harnessCapabilities.current()
  return {
    ok: true,
    service: 'opensaddle-control-plane',
    mode: config.mode,
    runtime_provider: config.runtimeProvider,
    configured_models: models.configuredKeys(),
    model_provider: config.modelProvider,
    default_model: config.defaultModel,
    storage: {
      engine: store.storageInfo().engine,
      workspace_documents: store.workspaceInfo()?.documents ?? 0,
    },
    harness_status_scope: latestCapabilities ? 'discovered' : 'installation_only',
    harnesses: harnesses.list().map((harness) => {
      const capability = latestCapabilities?.harnesses.find((item) => item.id === harness.id)
      const availability = capability?.availability ?? harness.availability
      return {
        id: harness.id,
        availability,
        installed: capability?.kind === 'native' || availability === 'available',
        readiness: capability?.readiness ?? 'unknown',
        auth_state: capability?.auth.state ?? 'unknown',
        status_message: capability?.auth.message ?? capability?.unavailableReason,
        setup_command: capability?.auth.setupCommand,
        version: capability?.version,
      }
    }),
  }
})

app.get('/api/public/sites/:slug', async (request, reply) => {
  const { slug } = request.params as { slug: string }
  const workspace = store.workspace()
  const sites = workspace?.sites
  if (!Array.isArray(sites)) return await reply.code(404).send({ error: 'site_not_found' })

  const site = sites.find((candidate): candidate is Record<string, unknown> =>
    typeof candidate === 'object'
    && candidate !== null
    && candidate.slug === slug
    && typeof candidate.publishedVersionId === 'string')
  if (!site || !Array.isArray(site.versions)) {
    return await reply.code(404).send({ error: 'site_not_found' })
  }

  const version = site.versions.find((candidate): candidate is Record<string, unknown> =>
    typeof candidate === 'object'
    && candidate !== null
    && candidate.id === site.publishedVersionId
    && candidate.status === 'published')
  if (!version) return await reply.code(404).send({ error: 'site_not_found' })

  // Deliberately expose only public presentation data, never the workspace,
  // permission grants, project sources, or private agent configuration.
  return {
    site: {
      id: site.id,
      name: site.name,
      slug: site.slug,
      accent: site.accent,
    },
    version: {
      id: version.id,
      label: version.label,
      snapshot: version.snapshot,
    },
  }
})

app.get('/api/capabilities', async (request) => ({
  mode: config.mode,
  user_id: request.principal.userId,
  model_routes: Object.entries(config.modelRoutes).map(([key, route]) => ({
    key,
    model: route.model,
    endpoint: redactUrl(route.baseUrl),
  })),
  harnesses: harnesses.list(),
  default_coding_provider: config.defaultCodingProvider,
  runtime_provider: config.runtimeProvider,
  max_concurrent_runs: config.maxConcurrentRuns,
  storage: {
    ...store.storageInfo(),
    workspace: store.workspaceInfo() ?? null,
  },
}))

app.get('/api/harness-capabilities', async () => await discoverHarnessCapabilities())
app.post('/api/harness-capabilities/refresh', async () => await discoverHarnessCapabilities(true))

app.get('/api/local-sessions', async (request, reply) => {
  if (config.mode !== 'local') {
    return reply.code(404).send({ error: 'local_sessions_unavailable' })
  }
  const query = request.query as Record<string, unknown>
  const provider = enumValue<LocalSessionProvider>(query, 'provider', ['codex', 'claude'])
  const limit = boundedNumber(query.limit, 40, 100)
  return {
    sessions: await localSessions.list(provider, limit),
  }
})

app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/files', async (request, reply) => {
  const denied = projectReadPermission(request, reply, request.params.projectId)
  if (denied) return denied
  const query = request.query as Record<string, unknown>
  const { root, service } = projectFilesystem(request.params.projectId)
  return await service.list(root, {
    path: optionalString(query, 'path', 2_000),
    limit: boundedNumber(query.limit, 200, 500),
  })
})

app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/file', async (request, reply) => {
  const denied = projectReadPermission(request, reply, request.params.projectId)
  if (denied) return denied
  const query = request.query as Record<string, unknown>
  const { root, service } = projectFilesystem(request.params.projectId)
  return await service.read(root, requiredString(query, 'path', 2_000))
})

app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/file/stat', async (request, reply) => {
  const denied = projectReadPermission(request, reply, request.params.projectId)
  if (denied) return denied
  const query = request.query as Record<string, unknown>
  const { root, service } = projectFilesystem(request.params.projectId)
  return await service.stat(root, requiredString(query, 'path', 2_000))
})

app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/managed-artifact', async (request, reply) => {
  const denied = projectWritePermission(request, reply, request.params.projectId)
  if (denied) return denied
  const body = objectBody(request)
  const { root, service } = projectFilesystem(request.params.projectId)
  const written = await service.writeManagedArtifact(
    root,
    requiredString(body, 'path', 2_000),
    requiredString(body, 'content', 100_000),
  )
  return reply.code(201).send(written)
})

app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/managed-artifact/archive', async (request, reply) => {
  const denied = projectWritePermission(request, reply, request.params.projectId)
  if (denied) return denied
  const body = objectBody(request)
  const { root, service } = projectFilesystem(request.params.projectId)
  return await service.archiveManagedArtifact(root, requiredString(body, 'path', 2_000))
})

app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/managed-artifact/archive', async (request, reply) => {
  const denied = projectReadPermission(request, reply, request.params.projectId)
  if (denied) return denied
  const { root, service } = projectFilesystem(request.params.projectId)
  return { archives: await service.listManagedArchives(root) }
})

app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/managed-artifact/restore', async (request, reply) => {
  const denied = projectWritePermission(request, reply, request.params.projectId)
  if (denied) return denied
  const body = objectBody(request)
  const { root, service } = projectFilesystem(request.params.projectId)
  return await service.restoreManagedArtifact(root, requiredString(body, 'archived_path', 2_000))
})

app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/search', async (request, reply) => {
  const denied = projectReadPermission(request, reply, request.params.projectId)
  if (denied) return denied
  const query = request.query as Record<string, unknown>
  const { root, service } = projectFilesystem(request.params.projectId)
  return await service.search(root, requiredString(query, 'q', 500), {
    limit: boundedNumber(query.limit, 100, 200),
  })
})

app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/rescan', async (request, reply) => {
  const denied = projectReadPermission(request, reply, request.params.projectId)
  if (denied) return denied
  const { root, service } = projectFilesystem(request.params.projectId)
  return await service.rescan(root)
})

app.get('/api/workspace', async (_request, reply) => {
  const workspace = store.workspace()
  if (!workspace) return reply.code(404).send({ error: 'workspace_not_found' })
  return {
    workspace,
    storage: store.storageInfo().engine,
    ...store.workspaceInfo(),
  }
})

app.get<{ Querystring: { project_id?: string } }>('/api/surfaces', async (request) => {
  const projects = store.workspace()?.projects
  if (!Array.isArray(projects)) return { surfaces: [] }
  const requestedProjectId = request.query.project_id
  const surfaces = projects.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const project = candidate as Record<string, unknown>
    const projectId = typeof project.id === 'string' ? project.id : undefined
    if (!projectId || (requestedProjectId && projectId !== requestedProjectId)) return []
    const permission = evaluatePermissions(store.grants(), {
      userId: request.principal.userId,
      resourceKind: 'project',
      resourceId: projectId,
      action: 'read',
    })
    if (!permission.allowed) return []
    return [{ id: 'work', project_id: projectId, title: 'Work' }]
  })
  return { surfaces }
})

/**
 * Granular, durable conversation API. The legacy /api/workspace snapshot is
 * intentionally retained while clients transition; StateStore imports legacy
 * chats/messages as new durable records whenever a snapshot is saved.
 */
app.get('/api/threads', async (request) => {
  const query = request.query as Record<string, unknown>
  const projectId = optionalString(query, 'project_id', 200)
  const includeArchived = query.include_archived === true || query.include_archived === 'true'
  const limit = boundedNumber(query.limit, 50, 100)
  const cursor = decodeCursor(query.cursor, 'thread') as { pinned: boolean; updatedAt: number; id: string } | undefined
  const candidates = store.threads({ projectId, includeArchived, limit: 100, cursor })
  const visible = candidates.filter((thread) => threadPermission(request, thread, 'read').allowed)
  const page = visible.slice(0, limit)
  // If permission filtering hides a full storage page, continue from the
  // last scanned record so a caller can still reach later permitted threads.
  const next = page.length === limit
    ? page.at(-1)
    : candidates.length === 100
      ? candidates.at(-1)
      : undefined
  return {
    threads: page.map(apiThread),
    next_cursor: next ? encodeCursor({ pinned: next.pinned, updatedAt: next.updatedAt, id: next.id }) : null,
  }
})

app.post('/api/threads', async (request, reply) => {
  const body = objectBody(request)
  const projectId = requiredString(body, 'project_id', 200)
  const permission = evaluatePermissions(store.grants(), {
    userId: request.principal.userId,
    resourceKind: 'project',
    resourceId: projectId,
    action: 'write',
  })
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  const now = Date.now()
  const id = optionalString(body, 'id', 200) ?? `thread_${randomUUID().slice(0, 12)}`
  if (store.thread(id)) return reply.code(409).send({ error: 'thread_already_exists' })
  const visibility = enumValue(body, 'visibility', ['private', 'shared', 'project'] as const) ?? 'private'
  const thread: ThreadRecord = {
    id,
    ownerId: request.principal.userId,
    projectId,
    title: optionalString(body, 'title', 500) ?? 'Untitled thread',
    visibility,
    sharedWith: stringArray(body, 'shared_with') ?? [],
    agentId: optionalString(body, 'agent_id', 200),
    runConfig: threadRunConfig(body.run_config),
    continuation: threadContinuation(body.continuation),
    branchedFromId: optionalString(body, 'branched_from_id', 200),
    pinned: optionalBoolean(body, 'pinned') ?? false,
    archivedAt: optionalBoolean(body, 'archived') === true ? now : undefined,
    createdAt: now,
    updatedAt: now,
  }
  await store.saveThread(thread)
  return reply.code(201).send({ thread: apiThread(thread) })
})

app.get<{ Params: { threadId: string } }>('/api/threads/:threadId', async (request, reply) => {
  const thread = store.thread(request.params.threadId)
  if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
  const permission = threadPermission(request, thread, 'read')
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  return { thread: apiThread(thread) }
})

app.patch<{ Params: { threadId: string } }>('/api/threads/:threadId', async (request, reply) => {
  const thread = store.thread(request.params.threadId)
  if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
  const permission = threadPermission(request, thread, 'write')
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  const body = objectBody(request)
  const title = optionalString(body, 'title', 500)
  const pinned = optionalBoolean(body, 'pinned')
  const archived = optionalBoolean(body, 'archived')
  const visibility = enumValue(body, 'visibility', ['private', 'shared', 'project'] as const)
  const sharedWith = stringArray(body, 'shared_with')
  const agentId = optionalString(body, 'agent_id', 200)
  const hasAgentId = Object.hasOwn(body, 'agent_id')
  const hasContinuation = Object.hasOwn(body, 'continuation')
  const hasRunConfig = Object.hasOwn(body, 'run_config')
  const continuation = hasContinuation ? threadContinuation(body.continuation) : undefined
  const runConfig = hasRunConfig ? threadRunConfig(body.run_config) : undefined
  const updated: ThreadRecord = {
    ...thread,
    ...(title ? { title } : {}),
    ...(pinned === undefined ? {} : { pinned }),
    ...(archived === undefined ? {} : { archivedAt: archived ? Date.now() : undefined }),
    ...(visibility ? { visibility } : {}),
    ...(sharedWith ? { sharedWith } : {}),
    ...(hasAgentId ? { agentId } : {}),
    ...(hasContinuation ? { continuation } : {}),
    ...(hasRunConfig ? { runConfig } : {}),
    updatedAt: Date.now(),
  }
  if (title === undefined && pinned === undefined && archived === undefined && !visibility && !sharedWith && !hasAgentId && !hasContinuation && !hasRunConfig) {
    return reply.code(400).send({ error: 'thread_update_required' })
  }
  await store.saveThread(updated)
  return { thread: apiThread(updated) }
})

app.delete<{ Params: { threadId: string } }>('/api/threads/:threadId', async (request, reply) => {
  const thread = store.thread(request.params.threadId)
  if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
  const permission = threadPermission(request, thread, 'write')
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  await store.removeThread(thread.id)
  return { ok: true }
})

app.get<{ Params: { threadId: string } }>('/api/threads/:threadId/messages', async (request, reply) => {
  const thread = store.thread(request.params.threadId)
  if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
  const permission = threadPermission(request, thread, 'read')
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  const query = request.query as Record<string, unknown>
  const limit = boundedNumber(query.limit, 100, 250)
  const cursor = decodeCursor(query.cursor, 'message') as { createdAt: number; id: string } | undefined
  const items = store.messages(thread.id, { limit: limit + 1, cursor })
  const page = items.slice(0, limit)
  const next = items.length > limit ? page.at(-1) : undefined
  return {
    messages: page.map(apiMessage),
    next_cursor: next ? encodeCursor({ createdAt: next.createdAt, id: next.id }) : null,
  }
})

app.post<{ Params: { threadId: string } }>('/api/threads/:threadId/messages', async (request, reply) => {
  const thread = store.thread(request.params.threadId)
  if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
  const permission = threadPermission(request, thread, 'write')
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  const body = objectBody(request)
  const text = body.text
  if (typeof text !== 'string' || text.length > 200_000) throw new Error('text must be a string up to 200000 characters')
  const role = enumValue(body, 'role', ['user', 'assistant', 'system'] as const)
  if (!role) throw new Error('role is required')
  const payload = body.payload
  if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) {
    throw new Error('payload must be an object')
  }
  const now = Date.now()
  const message: ThreadMessageRecord = {
    id: optionalString(body, 'id', 200) ?? `message_${randomUUID().slice(0, 12)}`,
    threadId: thread.id,
    role,
    text,
    createdAt: now,
    updatedAt: now,
    payload: payload as Record<string, unknown> | undefined,
  }
  if (store.message(message.id)) return reply.code(409).send({ error: 'message_already_exists' })
  await store.appendMessage(message)
  thread.updatedAt = now
  await store.saveThread(thread)
  return reply.code(201).send({ message: apiMessage(message) })
})

app.patch<{ Params: { threadId: string; messageId: string } }>(
  '/api/threads/:threadId/messages/:messageId',
  async (request, reply) => {
    const thread = store.thread(request.params.threadId)
    if (!thread) return reply.code(404).send({ error: 'thread_not_found' })
    const permission = threadPermission(request, thread, 'write')
    if (!permission.allowed) return permissionDenied(reply, permission.reason)
    const message = store.message(request.params.messageId)
    if (!message || message.threadId !== thread.id) {
      return reply.code(404).send({ error: 'message_not_found' })
    }
    const body = objectBody(request)
    const hasText = Object.hasOwn(body, 'text')
    const hasPayload = Object.hasOwn(body, 'payload')
    if (!hasText && !hasPayload) return reply.code(400).send({ error: 'message_update_required' })
    if (hasText && (typeof body.text !== 'string' || body.text.length > 200_000)) {
      throw new Error('text must be a string up to 200000 characters')
    }
    if (hasPayload && (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload))) {
      throw new Error('payload must be an object')
    }
    const updated: ThreadMessageRecord = {
      ...message,
      ...(hasText ? { text: body.text as string } : {}),
      ...(hasPayload ? { payload: body.payload as Record<string, unknown> } : {}),
      updatedAt: Date.now(),
    }
    await store.saveMessage(updated)
    thread.updatedAt = updated.updatedAt
    await store.saveThread(thread)
    return { message: apiMessage(updated) }
  },
)

app.get('/api/threads/search', async (request) => {
  const query = request.query as Record<string, unknown>
  const q = requiredString(query, 'q', 500)
  const projectId = optionalString(query, 'project_id', 200)
  const limit = boundedNumber(query.limit, 50, 100)
  const results = store.searchThreads(q, { projectId, limit: 100 })
    .filter((result) => threadPermission(request, result.thread, 'read').allowed)
    .slice(0, limit)
  return {
    results: results.map((result) => ({
      thread: apiThread(result.thread),
      message_id: result.messageId,
      snippet: result.snippet,
      matched_in: result.matchedIn,
    })),
  }
})

app.get('/api/threads/available', async (request, reply) => {
  const callerAgentId = optionalString(request.query as Record<string, unknown>, 'agent_id', 200)
  if (!callerAgentId) return await reply.code(400).send({ error: 'agent_id is required' })
  const workspace = store.workspace()
  const chats = Array.isArray(workspace?.chats) ? workspace.chats : []
  const agents = Array.isArray(workspace?.agents) ? workspace.agents : []
  const available = chats.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const thread = candidate as Record<string, unknown>
    const id = typeof thread.id === 'string' ? thread.id : undefined
    const targetAgentId = typeof thread.agentId === 'string' ? thread.agentId : undefined
    if (!id || !targetAgentId || !agents.some((agent) => agent && typeof agent === 'object' && (agent as Record<string, unknown>).id === targetAgentId)) return []
    const threadRead = evaluatePermissions(store.grants(), { userId: request.principal.userId, agentId: callerAgentId, resourceKind: 'thread', resourceId: id, action: 'read' })
    const delegation = canDelegateToAgent(store.grants(), callerAgentId, targetAgentId)
    if (!threadRead.allowed || !delegation.allowed) return []
    return [{ id, title: typeof thread.title === 'string' ? thread.title : 'Untitled thread', project_id: thread.projectId, agent_id: targetAgentId }]
  })
  return { threads: available }
})

app.put('/api/workspace', async (request, reply) => {
  const body = objectBody(request)
  const workspace = body.workspace
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
    return reply.code(400).send({ error: 'workspace_must_be_an_object' })
  }
  const record = workspace as Record<string, unknown>
  if (typeof record.version !== 'number') {
    return reply.code(400).send({ error: 'workspace_version_required' })
  }
  for (const collection of ['projects', 'chats', 'messages']) {
    if (!Array.isArray(record[collection])) {
      return reply.code(400).send({ error: `workspace_${collection}_must_be_an_array` })
    }
  }
  const expectedRevision = request.headers['if-unmodified-since']
  const currentRevision = store.workspaceInfo()?.updatedAt
  // Local mode is deliberately a single-user desktop convenience surface. A
  // second local window may legitimately persist the same workspace while a
  // first window is open, so use last-writer-wins there. Company mode retains
  // strict optimistic concurrency and makes the caller resolve the conflict.
  if (config.mode !== 'local' && expectedRevision && currentRevision && Number(expectedRevision) !== currentRevision) {
    return reply.code(409).send({
      error: 'workspace_conflict',
      message: 'The remote workspace changed since it was loaded. Reload it before saving.',
      updatedAt: currentRevision,
    })
  }
  await store.saveWorkspace(record, request.principal.userId)
  return {
    ok: true,
    storage: store.storageInfo().engine,
    ...store.workspaceInfo(),
  }
})

app.get('/api/harnesses', async () => ({
  default_coding_provider: config.defaultCodingProvider,
  harnesses: harnesses.list(),
}))

let openRouterCatalogCache: { expiresAt: number; models: Array<{ id: string; name: string; contextLength?: number }> } | undefined
app.get('/api/models/openrouter/free', async () => {
  if (openRouterCatalogCache && openRouterCatalogCache.expiresAt > Date.now()) {
    return { models: openRouterCatalogCache.models, cached: true }
  }
  const response = await fetch('https://openrouter.ai/api/v1/models')
  if (!response.ok) throw new Error(`OpenRouter catalog returned ${response.status}`)
  const payload = await response.json() as { data?: unknown[] }
  const models = (payload.data ?? []).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const row = candidate as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : ''
    if (!id.endsWith(':free')) return []
    return [{
      id,
      name: typeof row.name === 'string' ? row.name : id,
      contextLength: typeof row.context_length === 'number' ? row.context_length : undefined,
    }]
  }).sort((left, right) => left.name.localeCompare(right.name))
  openRouterCatalogCache = { expiresAt: Date.now() + 600_000, models }
  return { models, cached: false }
})

app.get('/api/routes/telemetry', async (request) => {
  const projectId = typeof (request.query as Record<string, unknown>).project_id === 'string'
    ? (request.query as Record<string, string>).project_id
    : undefined
  return { routes: store.routeTelemetry(projectId) }
})

app.post('/api/sites/generate', async (request, reply) => {
  const body = objectBody(request)
  const projectId = requiredString(body, 'project_id', 200)
  const permission = evaluatePermissions(store.grants(), {
    userId: request.principal.userId,
    resourceKind: 'project',
    resourceId: projectId,
    action: 'write',
  })
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  const prompt = requiredString(body, 'prompt', 8_000)
  const route = estimateRoute(`Design a website: ${prompt}`, config, {
    harnessKey: 'chat',
    telemetry: store.routeTelemetry(projectId),
  })
  const text = await models.completeMessages({
    route,
    signal: request.raw.aborted ? AbortSignal.abort() : new AbortController().signal,
    messages: [
      {
        role: 'system',
        content: 'Return only valid JSON for a custom site draft with keys name, description, slug, accent, and pages. pages must be an array of 1-5 objects with title, body, eyebrow, ctaLabel, ctaUrl, agentRail, and sections. Each section must have title and body. Do not use markdown fences.',
      },
      { role: 'user', content: prompt },
    ],
  })
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const candidate = JSON.parse(json) as Record<string, unknown>
  const pages = Array.isArray(candidate.pages) ? candidate.pages.slice(0, 5).map((page, index) => {
    const row = page && typeof page === 'object' && !Array.isArray(page) ? page as Record<string, unknown> : {}
    return {
      id: `page-${index + 1}`,
      title: typeof row.title === 'string' ? row.title.slice(0, 100) : `Page ${index + 1}`,
      body: typeof row.body === 'string' ? row.body.slice(0, 2_000) : '',
      eyebrow: typeof row.eyebrow === 'string' ? row.eyebrow.slice(0, 100) : undefined,
      ctaLabel: typeof row.ctaLabel === 'string' ? row.ctaLabel.slice(0, 100) : undefined,
      ctaUrl: typeof row.ctaUrl === 'string' ? row.ctaUrl.slice(0, 500) : undefined,
      agentRail: row.agentRail === true,
      sections: Array.isArray(row.sections) ? row.sections.slice(0, 8).flatMap((item, sectionIndex) => {
        if (typeof item === 'string') return [{ id: `section-${index + 1}-${sectionIndex + 1}`, title: item.slice(0, 120), body: '' }]
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const section = item as Record<string, unknown>
        return [{
          id: `section-${index + 1}-${sectionIndex + 1}`,
          title: typeof section.title === 'string' ? section.title.slice(0, 120) : `Section ${sectionIndex + 1}`,
          body: typeof section.body === 'string' ? section.body.slice(0, 2_000) : '',
        }]
      }) : [],
    }
  }) : []
  return {
    draft: {
      name: typeof candidate.name === 'string' ? candidate.name.slice(0, 100) : 'Generated site',
      description: typeof candidate.description === 'string' ? candidate.description.slice(0, 500) : prompt.slice(0, 200),
      slug: typeof candidate.slug === 'string' ? candidate.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80) : `site-${Date.now()}`,
      accent: typeof candidate.accent === 'string' && /^#[0-9a-f]{6}$/i.test(candidate.accent) ? candidate.accent : '#80a9ff',
      pages: pages.length ? pages : [{ id: 'page-1', title: 'Home', body: prompt, agentRail: true, sections: [] }],
    },
    route,
  }
})

app.post('/api/routes/estimate', async (request) => {
  const body = objectBody(request)
  const projectId = optionalString(body, 'project_id', 200)
  const defaults = projectId ? projectRoutingDefaults(projectId) : {}
  const task = requiredString(body, 'task')
  const requestedProvider = enumValue(body, 'provider_key', ['auto', 'opensaddle', 'codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity', 'custom'] as const)
  const routeInput = {
    routingPref: optionalString(body, 'routing_pref', 50),
    modelKey: enumValue(body, 'model_key', ['auto', 'gpt', 'claude', 'sonnet', 'gemini', 'llama'] as const) ?? defaults.modelKey,
    modelId: requestedModelId(body),
    harnessKey: enumValue(body, 'harness_key', ['chat', 'research', 'coding', 'browser', 'vm'] as const),
    providerKey: requestedProvider ?? defaults.providerKey,
    runtimeKey: enumValue(body, 'runtime_key', ['local', 'browser', 'sandbox', 'vm', 'gpu', 'restricted'] as const) ?? defaults.runtimeKey,
    telemetry: store.routeTelemetry(projectId),
  }
  let route = estimateRoute(task, config, routeInput)
  const explicitlyPinned = requestedProvider !== undefined && requestedProvider !== 'auto'
  if (route.harnessKey === 'coding' && !explicitlyPinned && route.providerKey !== 'custom') {
    const snapshot = await discoverHarnessCapabilities()
    const readyProvider = selectReadyCodingProvider(
      route.providerKey,
      config.codingProviders,
      snapshot.harnesses,
    )
    if (readyProvider && readyProvider !== route.providerKey) {
      const preferred = route.providerKey
      route = estimateRoute(task, config, { ...routeInput, providerKey: readyProvider })
      route.reasons.push(`Selected ${readyProvider} because ${preferred} is not ready`)
    }
  }
  return {
    model_key: route.modelKey,
    model_id: route.modelId,
    native_model_default: route.nativeModelDefault,
    harness_key: route.harnessKey,
    provider_key: route.providerKey,
    runtime_key: route.runtimeKey,
    reasons: route.reasons,
    cost: route.cost,
    alternatives: route.alternatives.map((item) => ({
      model_key: item.modelKey,
      harness_key: item.harnessKey,
      score: item.score,
    })),
  }
})

function gitPermission(request: FastifyRequest, projectId: string, action: 'read' | 'write' | 'push', repo: string) {
  return evaluatePermissions(store.grants(), {
    userId: request.principal.userId,
    resourceKind: 'project',
    resourceId: projectId,
    action,
    path: repo,
  })
}

app.get('/api/git/status', async (request, reply) => {
  const query = request.query as Record<string, unknown>
  const projectId = requiredString(query, 'project_id', 200)
  const repo = requiredString(query, 'repo', 2_000)
  const repository = await git.resolveRepository(repo)
  const permission = gitPermission(request, projectId, 'read', repository)
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  return await git.status(repository)
})

app.get('/api/git/compare', async (request, reply) => {
  const query = request.query as Record<string, unknown>
  const projectId = requiredString(query, 'project_id', 200)
  const repo = requiredString(query, 'repo', 2_000)
  const repository = await git.resolveRepository(repo)
  const permission = gitPermission(request, projectId, 'read', repository)
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  return await git.compare(
    repository,
    requiredString(query, 'base', 200),
    optionalString(query, 'head', 200),
  )
})

app.post('/api/git/branch', async (request, reply) => {
  const body = objectBody(request)
  const projectId = requiredString(body, 'project_id', 200)
  const repo = requiredString(body, 'repo', 2_000)
  const repository = await git.resolveRepository(repo)
  const permission = gitPermission(request, projectId, 'write', repository)
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  let approval: ApprovalRecord | undefined
  if (permission.approvalRequired) {
    const approvalId = optionalString(body, 'approval_id', 200)
    approval = approvalId ? store.approval(approvalId) : undefined
    const validApproval = approval
      && approval.status === 'approved'
      && approval.requestedBy === request.principal.userId
      && approval.projectId === projectId
      && approval.agentId === undefined
      && approval.action === 'write'
    if (!validApproval) {
      return reply.code(409).send({
        error: 'approval_required',
        reason: permission.reason,
        action: 'write',
        matched_grant_ids: permission.matchedGrantIds,
      })
    }
  }
  const result = await git.createBranch(
    repository,
    requiredString(body, 'branch', 200),
    optionalString(body, 'start_point', 200),
  )
  if (approval) {
    approval.status = 'consumed'
    await store.saveApproval(approval)
  }
  return result
})

app.post('/api/git/commit', async (request, reply) => {
  const body = objectBody(request)
  const projectId = requiredString(body, 'project_id', 200)
  const repo = requiredString(body, 'repo', 2_000)
  const repository = await git.resolveRepository(repo)
  const permission = gitPermission(request, projectId, 'write', repository)
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  let approval: ApprovalRecord | undefined
  if (permission.approvalRequired) {
    const approvalId = optionalString(body, 'approval_id', 200)
    approval = approvalId ? store.approval(approvalId) : undefined
    const validApproval = approval
      && approval.status === 'approved'
      && approval.requestedBy === request.principal.userId
      && approval.projectId === projectId
      && approval.agentId === undefined
      && approval.action === 'write'
    if (!validApproval) {
      return reply.code(409).send({
        error: 'approval_required',
        reason: permission.reason,
        action: 'write',
        matched_grant_ids: permission.matchedGrantIds,
      })
    }
  }
  const rawPaths = body.paths
  if (rawPaths !== undefined && (!Array.isArray(rawPaths) || rawPaths.some((path) => typeof path !== 'string'))) {
    return reply.code(400).send({ error: 'paths_must_be_string_array' })
  }
  if (body.include_all !== undefined && typeof body.include_all !== 'boolean') {
    return reply.code(400).send({ error: 'include_all_must_be_boolean' })
  }
  const result = await git.commit(repository, requiredString(body, 'message', 10_000), {
    paths: rawPaths as string[] | undefined,
    includeAll: body.include_all === true,
  })
  if (approval) {
    approval.status = 'consumed'
    await store.saveApproval(approval)
  }
  return result
})

app.post('/api/git/push', async (request, reply) => {
  const body = objectBody(request)
  const projectId = requiredString(body, 'project_id', 200)
  const repo = requiredString(body, 'repo', 2_000)
  const repository = await git.resolveRepository(repo)
  const permission = gitPermission(request, projectId, 'push', repository)
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  const approvalId = optionalString(body, 'approval_id', 200)
  const approval = approvalId ? store.approval(approvalId) : undefined
  const validApproval = approval
    && approval.status === 'approved'
    && approval.requestedBy === request.principal.userId
    && approval.projectId === projectId
    && approval.agentId === undefined
    && approval.action === 'push'
  if (!validApproval) {
    return reply.code(409).send({
      error: 'approval_required',
      reason: 'Pushing repository changes requires explicit approval',
      action: 'push',
      matched_grant_ids: permission.matchedGrantIds,
    })
  }
  const result = await git.push(
    repository,
    optionalString(body, 'remote', 100),
    optionalString(body, 'branch', 200),
  )
  approval.status = 'consumed'
  await store.saveApproval(approval)
  return result
})

app.post('/api/git/pull-request', async (request, reply) => {
  const body = objectBody(request)
  const projectId = requiredString(body, 'project_id', 200)
  const repo = requiredString(body, 'repo', 2_000)
  const repository = await git.resolveRepository(repo)
  const permission = gitPermission(request, projectId, 'push', repository)
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  const approvalId = optionalString(body, 'approval_id', 200)
  const approval = approvalId ? store.approval(approvalId) : undefined
  const validApproval = approval
    && approval.status === 'approved'
    && approval.requestedBy === request.principal.userId
    && approval.projectId === projectId
    && approval.agentId === undefined
    && approval.action === 'push'
  if (!validApproval) {
    return reply.code(409).send({
      error: 'approval_required',
      reason: 'Creating a pull request requires explicit approval',
      action: 'push',
      matched_grant_ids: permission.matchedGrantIds,
    })
  }
  if (body.draft !== undefined && typeof body.draft !== 'boolean') {
    return reply.code(400).send({ error: 'draft_must_be_boolean' })
  }
  const result = await git.createPullRequest(repository, {
    title: requiredString(body, 'title', 500),
    body: optionalString(body, 'body', 50_000) ?? '',
    base: requiredString(body, 'base', 200),
    head: optionalString(body, 'head', 200),
    draft: body.draft === true,
  })
  approval.status = 'consumed'
  await store.saveApproval(approval)
  return result
})

app.get('/api/runs', async (request) => runs.list(request.principal).map((run) => ({
  run_id: run.id,
  session_id: run.sessionId,
  project_id: run.projectId,
  task: run.task,
  agent_id: run.agentId,
  parent_run_id: run.parentRunId,
  queued_after_run_id: run.queuedAfterRunId,
  source_ids: run.sourceIds,
  status: run.status,
  route: run.route,
  provider_session_id: run.providerSessionId,
  provider_session_mode: run.providerSessionMode,
  provider_turn_id: run.providerTurnId,
  execution_mode: run.executionMode,
  execution_policy: run.executionPolicy,
  created_at: run.createdAt,
  updated_at: run.updatedAt,
  error: run.error,
  last_event_type: run.events.at(-1)?.type,
})))

app.post('/api/runs', async (request, reply) => {
  const body = objectBody(request)
  const projectId = requiredString(body, 'project_id', 200)
  const agentId = optionalString(body, 'agent_id', 200)
  const localSettings = localRunSettings(projectId, agentId)
  const parentRunId = optionalString(body, 'parent_run_id', 200)
  const defaults = projectRoutingDefaults(projectId)
  const task = requiredString(body, 'task')
  const providerSessionId = optionalString(body, 'provider_session_id', 300)
  const providerSessionMode = enumValue(body, 'provider_session_mode', ['resume', 'fork'] as const)
  const providerTurnId = optionalString(body, 'provider_turn_id', 300)
  if (providerSessionMode && !providerSessionId) {
    return reply.code(400).send({
      error: 'provider_session_mode_requires_session',
      reason: 'A native session mode requires provider_session_id.',
    })
  }
  if (providerTurnId && (!providerSessionId || providerSessionMode !== 'fork')) {
    return reply.code(400).send({
      error: 'provider_turn_requires_fork',
      reason: 'A provider turn checkpoint can be used only with a provider-native fork.',
    })
  }
  const executionMode = enumValue<RunExecutionMode>(
    body,
    'execution_mode',
    ['plan', 'review', 'project', 'full-access'],
  ) ?? 'project'
  const requestedProvider = enumValue<CodingProvider>(body, 'provider_key', ['auto', 'opensaddle', 'codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity', 'custom'])
  const localProvider = localSettings.harnessId
    ? BUILTIN_PROVIDER_IDS.has(localSettings.harnessId)
      ? localSettings.harnessId as CodingProvider
      : 'custom'
    : undefined
  const routeInput = {
    modelKey: enumValue<ModelKey>(body, 'model_key', ['auto', 'gpt', 'claude', 'sonnet', 'gemini', 'llama']) ?? defaults.modelKey,
    modelId: requestedModelId(body),
    harnessKey: enumValue<Harness>(body, 'harness_key', ['chat', 'research', 'coding', 'browser', 'vm']),
    providerKey: requestedProvider ?? localProvider ?? defaults.providerKey,
    runtimeKey: enumValue<RuntimeKind>(body, 'runtime_key', ['local', 'browser', 'sandbox', 'vm', 'gpu', 'restricted']) ?? defaults.runtimeKey,
    routingPref: optionalString(body, 'routing_pref', 50),
    telemetry: store.routeTelemetry(projectId),
  }
  let route = estimateRoute(task, config, routeInput)
  let selectedHarnessCapability: Awaited<ReturnType<typeof discoverHarnessCapabilities>>['harnesses'][number] | undefined
  if (providerSessionId) {
    if (config.mode !== 'local') {
      return reply.code(400).send({
        error: 'provider_session_local_only',
        reason: 'Provider-native session continuation is available only in local mode.',
      })
    }
    if (route.harnessKey !== 'coding'
      || !['codex', 'claude', 'cursor', 'gemini', 'custom'].includes(route.providerKey)) {
      return reply.code(400).send({
        error: 'provider_session_harness_mismatch',
        reason: 'The selected provider does not support native session continuation.',
      })
    }
  }
  if (route.harnessKey === 'coding') {
    const snapshot = await discoverHarnessCapabilities()
    const capabilityId = route.providerKey === 'custom' ? localSettings.profile?.id : route.providerKey
    if (!capabilityId) {
      return reply.code(409).send({
        error: 'harness_not_ready',
        reason: 'The selected project-local harness is no longer configured.',
        provider_key: route.providerKey,
      })
    }
    selectedHarnessCapability = snapshot.harnesses.find((capability) => capability.id === capabilityId)
    if (!selectedHarnessCapability
      || selectedHarnessCapability.availability !== 'available'
      || selectedHarnessCapability.readiness !== 'ready') {
      const explicitlyPinned = requestedProvider !== undefined && requestedProvider !== 'auto'
      if (explicitlyPinned || route.providerKey === 'custom') {
        const setup = selectedHarnessCapability?.auth.setupCommand
          ? ` Run ${selectedHarnessCapability.auth.setupCommand}.`
          : ''
        return reply.code(409).send({
          error: 'harness_not_ready',
          reason: `${selectedHarnessCapability?.unavailableReason ?? selectedHarnessCapability?.auth.message ?? `${capabilityId} is not ready.`}${setup}`,
          provider_key: route.providerKey,
          setup_command: selectedHarnessCapability?.auth.setupCommand,
        })
      }
      const fallback = snapshot.harnesses.find((capability) =>
        capability.availability === 'available'
        && capability.readiness === 'ready'
        && config.codingProviders.includes(capability.id),
      )
      if (!fallback) {
        return reply.code(409).send({
          error: 'no_ready_coding_harness',
          reason: 'No authenticated local coding harness or configured OpenSaddle model endpoint is ready.',
        })
      }
      route = estimateRoute(task, config, {
        ...routeInput,
        providerKey: fallback.id as CodingProvider,
      })
      selectedHarnessCapability = fallback
      route.reasons.push(`Selected ${fallback.label} because the requested harness is not ready`)
    }
  }
  const permission = evaluatePermissions(store.grants(), {
    userId: request.principal.userId,
    agentId,
    resourceKind: 'project',
    resourceId: projectId,
    action: 'execute',
  })
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  if (executionMode === 'full-access') {
    if (config.mode !== 'local' || !localSettings.repo) {
      return reply.code(400).send({
        error: 'full_access_local_only',
        reason: 'Full access is available only for configured local projects.',
      })
    }
    const administer = evaluatePermissions(store.grants(), {
      userId: request.principal.userId,
      resourceKind: 'project',
      resourceId: projectId,
      action: 'administer',
    })
    if (!administer.allowed) return permissionDenied(reply, administer.reason)
  }
  const rawCapabilityIds = stringArray(body, 'capability_ids', 20, 100)
  const knownCapabilityIds = rawCapabilityIds?.filter((capability): capability is TaskCapabilityId =>
    ['Browser', 'Network', 'Secure VM', 'Subagents'].includes(capability))
  if (rawCapabilityIds && knownCapabilityIds?.length !== rawCapabilityIds.length) {
    return reply.code(400).send({ error: 'unknown_task_capability' })
  }
  if (knownCapabilityIds && route.harnessKey === 'coding') {
    const controls = (selectedHarnessCapability?.capabilities.policyControls
      ?? 'provider-defined') as HarnessPolicyControls
    const unsupported = unsupportedTaskCapabilities(knownCapabilityIds, controls)
    if (unsupported.length) {
      const label = selectedHarnessCapability?.label ?? route.providerKey
      return reply.code(409).send({
        error: 'harness_capability_policy_unsupported',
        provider_key: route.providerKey,
        policy_controls: controls,
        unsupported_capabilities: unsupported,
        reason: controls === 'sandbox-only'
          ? `${label} can enforce Network through its sandbox, but cannot enforce per-tool ${unsupported.join(', ')} restrictions. Enable those capabilities or choose a native-policy harness.`
          : `${label} owns its capability policy and cannot accept OpenSaddle per-capability restrictions. Enable all capabilities or choose a native-policy harness.`,
      })
    }
  }
  const executionPolicy = applyTaskCapabilities(
    policyForExecutionMode(executionMode, localSettings.policy),
    knownCapabilityIds,
  )
  if (parentRunId) {
    const parent = runs.get(parentRunId)
    if (!parent) return reply.code(404).send({ error: 'parent_run_not_found' })
    if (parent.projectId !== projectId) return reply.code(400).send({ error: 'parent_run_project_mismatch' })
    if (parent.ownerId !== request.principal.userId && !request.principal.roles.includes('admin')) {
      return permissionDenied(reply, 'Parent run belongs to another user')
    }
    if (parent.agentId && agentId && parent.agentId !== agentId) {
      const delegation = canDelegateToAgent(store.grants(), parent.agentId, agentId)
      if (!delegation.allowed) return permissionDenied(reply, delegation.reason)
    }
  }
  const rawSourceIds = body.source_ids
  if (rawSourceIds !== undefined && (!Array.isArray(rawSourceIds) || rawSourceIds.some((id) => typeof id !== 'string'))) {
    return reply.code(400).send({ error: 'source_ids_must_be_string_array' })
  }
  const harnessApprovalAction = route.harnessKey === 'coding'
    && executionPolicy.approvals !== 'never'
    ? harnesses.approvalAction(route.providerKey)
    : undefined
  const approvalAction = permission.approvalRequired ? 'execute' : harnessApprovalAction
  if (approvalAction) {
    const approvalId = optionalString(body, 'approval_id', 200)
    const approval = approvalId ? store.approval(approvalId) : undefined
    const validApproval = approval
      && approval.status === 'approved'
      && approval.requestedBy === request.principal.userId
      && approval.projectId === projectId
      && approval.agentId === agentId
      && approval.action === approvalAction
    if (!validApproval) {
      return reply.code(409).send({
        error: 'approval_required',
        reason: harnessApprovalAction
          ? 'Claude Code requires approval before shell-capable execution'
          : permission.reason,
        action: approvalAction,
        matched_grant_ids: permission.matchedGrantIds,
      })
    }
    approval.status = 'consumed'
    await store.saveApproval(approval)
  }

  const run = await runs.start({
    projectId,
    task,
    agentId,
    parentRunId,
    sourceIds: (rawSourceIds as string[] | undefined)?.slice(0, 100),
    route,
    reviewProviderKey: enumValue<CodingProvider>(body, 'review_provider_key', ['auto', 'opensaddle', 'codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity', 'custom']) ?? defaults.reviewProviderKey,
    repo: optionalString(body, 'repo', 2_000) ?? localSettings.repo,
    harnessProfile: route.providerKey === 'custom' ? localSettings.profile : undefined,
    providerSessionId,
    providerSessionMode,
    providerTurnId,
    executionMode,
    executionPolicy,
    principal: request.principal,
  })
  return reply.code(202).send({
    run_id: run.id,
    session_id: run.sessionId,
    mode: config.mode,
    provider_session_id: run.providerSessionId,
    provider_session_mode: run.providerSessionMode,
    provider_turn_id: run.providerTurnId,
    execution_mode: run.executionMode,
    execution_policy: run.executionPolicy,
    route: run.route,
  })
})

app.get<{ Params: { runId: string } }>('/api/runs/:runId', async (request, reply) => {
  const run = runs.get(request.params.runId)
  if (!run) return reply.code(404).send({ error: 'run_not_found' })
  if (run.ownerId !== request.principal.userId && !request.principal.roles.includes('admin')) {
    return permissionDenied(reply, 'Run belongs to another user')
  }
  return run
})

app.post<{ Params: { runId: string } }>('/api/runs/:runId/diff', async (request) => {
  const body = objectBody(request)
  const decision = enumValue(body, 'decision', ['accepted', 'rejected'] as const)
  if (!decision) throw new Error('decision is required')
  const hunkIndex = body.hunk_index
  if (!Number.isInteger(hunkIndex) || (hunkIndex as number) < 0) throw new Error('hunk_index must be a non-negative integer')
  await runs.resolveDiff(
    request.params.runId,
    request.principal,
    requiredString(body, 'file_path', 2_000),
    hunkIndex as number,
    decision,
  )
  return { ok: true }
})

app.get<{ Params: { runId: string }; Querystring: { after?: string } }>(
  '/api/runs/:runId/events',
  async (request, reply) => {
    const run = runs.get(request.params.runId)
    if (!run) return reply.code(404).send({ error: 'run_not_found' })
    if (run.ownerId !== request.principal.userId && !request.principal.roles.includes('admin')) {
      return permissionDenied(reply, 'Run belongs to another user')
    }

    let cursor = Number(request.query.after ?? '-1')
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send = (event: (typeof run.events)[number]) => {
      if (event.sequence <= cursor) return
      cursor = event.sequence
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    const unsubscribe = runs.subscribe(run.id, (event) => {
      send(event)
      if (event.type === 'session.closed') {
        unsubscribe()
        reply.raw.end()
      }
    })
    const latest = runs.get(run.id)
    for (const event of latest?.events ?? []) send(event)
    if (latest?.status === 'completed' || latest?.status === 'failed' || latest?.status === 'cancelled') {
      unsubscribe()
      reply.raw.end()
      return
    }
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000)
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  },
)

app.post<{ Params: { runId: string } }>('/api/runs/:runId/cancel', async (request, reply) => {
  const cancelled = await runs.cancel(request.params.runId, request.principal)
  return cancelled ? { ok: true } : reply.code(404).send({ error: 'run_not_found' })
})

app.post<{ Params: { runId: string } }>('/api/runs/:runId/pause', async (request, reply) => {
  const paused = await runs.pause(request.params.runId, request.principal)
  return paused ? { ok: true } : reply.code(404).send({ error: 'run_not_found' })
})

app.post<{ Params: { runId: string } }>('/api/runs/:runId/resume', async (request, reply) => {
  const run = await runs.resume(request.params.runId, request.principal)
  return run
    ? {
      ok: true,
      run_id: run.id,
      session_id: run.sessionId,
      status: run.status,
    }
    : reply.code(404).send({ error: 'run_not_found' })
})

app.post<{ Params: { runId: string } }>('/api/runs/:runId/retry', async (request, reply) => {
  const run = await runs.retry(request.params.runId, request.principal)
  return run
    ? reply.code(201).send({
      run_id: run.id,
      session_id: run.sessionId,
      parent_run_id: run.parentRunId,
      status: run.status,
      route: run.route,
    })
    : reply.code(404).send({ error: 'run_not_found' })
})

app.post<{ Params: { runId: string } }>('/api/runs/:runId/steer', async (request, reply) => {
  const body = objectBody(request)
  const accepted = await runs.steer(
    request.params.runId,
    request.principal,
    requiredString(body, 'text', 20_000),
  )
  if (accepted === undefined) return reply.code(404).send({ error: 'run_not_found' })
  if (!accepted) {
    return reply.code(409).send({
      error: 'steering_unavailable',
      reason: 'This harness or active turn does not support same-turn steering.',
    })
  }
  return { ok: true }
})

app.post<{ Params: { runId: string } }>('/api/runs/:runId/queue', async (request, reply) => {
  const body = objectBody(request)
  const queued = await runs.queue(
    request.params.runId,
    request.principal,
    requiredString(body, 'text', 20_000),
  )
  if (!queued) return reply.code(404).send({ error: 'run_not_found' })
  return reply.code(201).send({
    run_id: queued.id,
    session_id: queued.sessionId,
    parent_run_id: queued.parentRunId,
    queued_after_run_id: queued.queuedAfterRunId,
    status: queued.status,
    route: queued.route,
  })
})

app.post<{ Params: { runId: string; requestId: string } }>(
  '/api/runs/:runId/requests/:requestId/respond',
  async (request, reply) => {
    const body = objectBody(request)
    const rawAnswers = body.answers
    if (rawAnswers !== undefined && (
      !rawAnswers
      || typeof rawAnswers !== 'object'
      || Array.isArray(rawAnswers)
      || Object.values(rawAnswers).some((value) =>
        !Array.isArray(value) || value.some((answer) => typeof answer !== 'string'),
      )
    )) {
      return reply.code(400).send({ error: 'answers_must_be_string_arrays' })
    }
    const rawForm = body.form
    if (rawForm !== undefined && (!rawForm || typeof rawForm !== 'object' || Array.isArray(rawForm))) {
      return reply.code(400).send({ error: 'form_must_be_object' })
    }
    const responded = await runs.respondInteraction(
      request.params.runId,
      request.params.requestId,
      request.principal,
      {
        approved: typeof body.approved === 'boolean' ? body.approved : undefined,
        scope: enumValue(body, 'scope', ['once', 'session']),
        text: optionalString(body, 'text', 20_000),
        answers: rawAnswers as Record<string, string[]> | undefined,
        form: rawForm as Record<string, unknown> | undefined,
      },
    )
    return responded ? { ok: true } : reply.code(404).send({ error: 'pending_request_not_found' })
  },
)

app.get<{ Querystring: { project_id?: string } }>('/api/permissions', async (request) => {
  const all = store.grants()
  const admin = requireAdmin(all, request.principal)
  const visible = admin.allowed
    ? all
    : all.filter((grant) =>
      (grant.principalKind === 'user' && grant.principalId === request.principal.userId)
      || grant.principalKind === 'agent',
    )
  if (!request.query.project_id) return visible
  return visible.filter((grant) =>
    grant.resourceKind === 'organization' || grant.resourceId === request.query.project_id,
  )
})

app.post('/api/permissions/check', async (request) => {
  const body = objectBody(request)
  const requestedUserId = optionalString(body, 'user_id', 200)
  const admin = requireAdmin(store.grants(), request.principal)
  const userId = requestedUserId && admin.allowed ? requestedUserId : request.principal.userId
  return evaluatePermissions(store.grants(), {
    userId,
    agentId: optionalString(body, 'agent_id', 200),
    resourceKind: enumValue<ResourceKind>(
      body,
      'resource_kind',
      ['organization', 'project', 'folder', 'repository', 'source', 'tool', 'workflow'],
    ) ?? 'project',
    resourceId: requiredString(body, 'resource_id', 500),
    action: requiredString(body, 'action', 100),
    path: optionalString(body, 'path', 2_000),
  })
})

app.put('/api/permissions/grants', async (request, reply) => {
  const admin = requireAdmin(store.grants(), request.principal)
  if (!admin.allowed) return permissionDenied(reply, admin.reason)
  const body = objectBody(request)
  const scope = enumValue(body, 'scope', ['once', 'thread', 'project', 'organization'] as const)
  const usesRemaining = body.uses_remaining
  if (usesRemaining !== undefined && (!Number.isInteger(usesRemaining) || (usesRemaining as number) < 0 || (usesRemaining as number) > 1_000)) {
    return reply.code(400).send({ error: 'uses_remaining_must_be_a_non_negative_integer' })
  }
  const grant: PermissionGrant = {
    id: optionalString(body, 'id', 200) ?? `grant_${randomUUID().slice(0, 12)}`,
    principalKind: enumValue<PrincipalKind>(body, 'principal_kind', ['user', 'group', 'agent']) ?? 'user',
    principalId: requiredString(body, 'principal_id', 200),
    resourceKind: enumValue<ResourceKind>(
      body,
      'resource_kind',
      ['organization', 'project', 'folder', 'repository', 'source', 'tool', 'workflow'],
    ) ?? 'project',
    resourceId: requiredString(body, 'resource_id', 500),
    action: requiredString(body, 'action', 100),
    effect: enumValue(body, 'effect', ['allow', 'deny'] as const) ?? 'deny',
    approvalRequired: body.approval_required === true,
    expiresAt: typeof body.expires_at === 'number' ? body.expires_at : undefined,
    pathPrefix: optionalString(body, 'path_prefix', 2_000),
    scope,
    scopeId: optionalString(body, 'scope_id', 500),
    usesRemaining: usesRemaining as number | undefined,
    createdAt: Date.now(),
    createdBy: request.principal.userId,
  }
  await store.replaceGrant(grant)
  return grant
})

app.post<{ Params: { grantId: string } }>('/api/permissions/grants/:grantId/consume', async (request, reply) => {
  const admin = requireAdmin(store.grants(), request.principal)
  if (!admin.allowed) return permissionDenied(reply, admin.reason)
  const grant = store.grants().find((candidate) => candidate.id === request.params.grantId)
  if (!grant) return reply.code(404).send({ error: 'grant_not_found' })
  if (grant.principalKind === 'user' && grant.principalId !== request.principal.userId && !request.principal.roles.includes('admin')) {
    return permissionDenied(reply, 'Grant belongs to another user')
  }
  const consumed = await store.consumeGrant(grant.id)
  return consumed ?? reply.code(409).send({ error: 'grant_not_consumable' })
})

app.delete<{ Params: { grantId: string } }>('/api/permissions/grants/:grantId', async (request, reply) => {
  const admin = requireAdmin(store.grants(), request.principal)
  if (!admin.allowed) return permissionDenied(reply, admin.reason)
  const removed = await store.removeGrant(request.params.grantId)
  return removed ? { ok: true } : reply.code(404).send({ error: 'grant_not_found' })
})

app.get('/api/approvals', async (request) => {
  const admin = requireAdmin(store.grants(), request.principal)
  return store.approvals().filter((approval) =>
    admin.allowed || approval.requestedBy === request.principal.userId,
  )
})

app.post('/api/approvals', async (request, reply) => {
  const body = objectBody(request)
  const projectId = requiredString(body, 'project_id', 200)
  const agentId = optionalString(body, 'agent_id', 200)
  const action = requiredString(body, 'action', 100)
  const permission = evaluatePermissions(store.grants(), {
    userId: request.principal.userId,
    agentId,
    resourceKind: 'project',
    resourceId: projectId,
    action,
  })
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  if (!permission.approvalRequired && action !== 'push') {
    return reply.code(400).send({ error: 'approval_not_required' })
  }
  const approval: ApprovalRecord = {
    id: `approval_${randomUUID().slice(0, 12)}`,
    requestedBy: request.principal.userId,
    projectId,
    agentId,
    action,
    status: 'pending',
    createdAt: Date.now(),
  }
  await store.saveApproval(approval)
  return reply.code(201).send(approval)
})

app.post<{ Params: { approvalId: string } }>('/api/approvals/:approvalId/resolve', async (request, reply) => {
  const admin = requireAdmin(store.grants(), request.principal)
  if (!admin.allowed) return permissionDenied(reply, admin.reason)
  const approval = store.approval(request.params.approvalId)
  if (!approval) return reply.code(404).send({ error: 'approval_not_found' })
  if (approval.status !== 'pending') return reply.code(409).send({ error: 'approval_already_resolved' })
  const body = objectBody(request)
  if (typeof body.allow !== 'boolean') return reply.code(400).send({ error: 'allow_must_be_boolean' })
  approval.status = body.allow ? 'approved' : 'denied'
  approval.resolvedAt = Date.now()
  approval.resolvedBy = request.principal.userId
  await store.saveApproval(approval)
  return approval
})

app.get('/api/runtimes', async (request) => {
  const admin = requireAdmin(store.grants(), request.principal)
  return store.runtimes().filter((runtime) => admin.allowed || runtime.ownerId === request.principal.userId)
})

app.post('/api/runtimes', async (request, reply) => {
  const body = objectBody(request)
  const projectId = requiredString(body, 'project_id', 200)
  const permission = evaluatePermissions(store.grants(), {
    userId: request.principal.userId,
    resourceKind: 'project',
    resourceId: projectId,
    action: 'execute',
  })
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
  const runtime = await provisioner.provision({
    projectId,
    kind: enumValue<RuntimeKind>(body, 'kind', ['local', 'browser', 'sandbox', 'vm', 'gpu', 'restricted']) ?? 'sandbox',
    repo: optionalString(body, 'repo', 2_000),
    principal: request.principal,
  })
  return reply.code(201).send(runtime)
})

app.delete<{ Params: { runtimeId: string } }>('/api/runtimes/:runtimeId', async (request, reply) => {
  const removed = await provisioner.release(request.params.runtimeId, request.principal)
  return removed ? { ok: true } : reply.code(404).send({ error: 'runtime_not_found' })
})

const cleanup = setInterval(() => void provisioner.cleanupExpired(), 60_000)
cleanup.unref()

await app.listen({ host: config.host, port: config.port })
app.log.info({
  mode: config.mode,
  host: config.host,
  port: config.port,
  runtimeProvider: config.runtimeProvider,
  models: models.configuredKeys(),
}, 'OpenSaddle control plane ready')
