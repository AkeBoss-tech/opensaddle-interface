import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import { authenticate, redactUrl } from './auth.js'
import { loadConfig } from './config.js'
import { GitWorkspaceError, GitWorkspaceService } from './gitWorkspace.js'
import { HarnessRegistry } from './harness/index.js'
import type { HarnessProfile } from './harness/types.js'
import { ModelGateway } from './modelGateway.js'
import { canDelegateToAgent, evaluatePermissions, requireAdmin } from './permissions.js'
import { RuntimeProvisioner } from './provisioner.js'
import { estimateRoute } from './router.js'
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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

const BUILTIN_PROVIDER_IDS = new Set(['opensaddle', 'codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity'])

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
  let profile: HarnessProfile | undefined
  if (configured && typeof configured.id === 'string' && typeof configured.label === 'string' && typeof configured.command === 'string') {
    const promptMode = configured.promptMode
    profile = {
      id: configured.id,
      label: configured.label,
      command: configured.command,
      description: typeof configured.description === 'string' ? configured.description : 'Project-local harness',
      kind: 'cli',
      promptMode: promptMode === 'flag' || promptMode === 'stdin' ? promptMode : 'final_arg',
      promptFlag: typeof configured.promptFlag === 'string' ? configured.promptFlag : undefined,
      baseArgs: Array.isArray(configured.args) ? configured.args.filter((value): value is string => typeof value === 'string').slice(0, 100) : [],
      modelFlag: typeof configured.modelFlag === 'string' ? configured.modelFlag : undefined,
      codingAffinity: 1,
      supportsCancel: true,
      supportsStreaming: configured.supportsStreaming !== false,
    }
  }
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

function openRouterModelId(body: Record<string, unknown>): string | undefined {
  const modelId = optionalString(body, 'model_id', 300)
  if (!modelId) return undefined
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

app.get('/api/health', async () => ({
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
  harnesses: harnesses.list().map((h) => ({
    id: h.id,
    availability: h.availability,
  })),
}))

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

app.get('/api/workspace', async (_request, reply) => {
  const workspace = store.workspace()
  if (!workspace) return reply.code(404).send({ error: 'workspace_not_found' })
  return {
    workspace,
    storage: store.storageInfo().engine,
    ...store.workspaceInfo(),
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
  const route = estimateRoute(requiredString(body, 'task'), config, {
    routingPref: optionalString(body, 'routing_pref', 50),
    modelKey: enumValue(body, 'model_key', ['auto', 'gpt', 'claude', 'sonnet', 'gemini', 'llama'] as const) ?? defaults.modelKey,
    modelId: openRouterModelId(body),
    harnessKey: enumValue(body, 'harness_key', ['chat', 'research', 'coding', 'browser', 'vm'] as const),
    providerKey: enumValue(body, 'provider_key', ['auto', 'opensaddle', 'codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity', 'custom'] as const) ?? defaults.providerKey,
    runtimeKey: enumValue(body, 'runtime_key', ['local', 'browser', 'sandbox', 'vm', 'gpu', 'restricted'] as const) ?? defaults.runtimeKey,
    telemetry: store.routeTelemetry(projectId),
  })
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

app.get('/api/runs', async (request) => runs.list(request.principal).map((run) => ({
  run_id: run.id,
  session_id: run.sessionId,
  project_id: run.projectId,
  agent_id: run.agentId,
  parent_run_id: run.parentRunId,
  source_ids: run.sourceIds,
  status: run.status,
  route: run.route,
  created_at: run.createdAt,
  updated_at: run.updatedAt,
  error: run.error,
})))

app.post('/api/runs', async (request, reply) => {
  const body = objectBody(request)
  const projectId = requiredString(body, 'project_id', 200)
  const agentId = optionalString(body, 'agent_id', 200)
  const localSettings = localRunSettings(projectId, agentId)
  const parentRunId = optionalString(body, 'parent_run_id', 200)
  const defaults = projectRoutingDefaults(projectId)
  const task = requiredString(body, 'task')
  const requestedProvider = enumValue<CodingProvider>(body, 'provider_key', ['auto', 'opensaddle', 'codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity', 'custom'])
  const localProvider = localSettings.harnessId
    ? BUILTIN_PROVIDER_IDS.has(localSettings.harnessId)
      ? localSettings.harnessId as CodingProvider
      : 'custom'
    : undefined
  const route = estimateRoute(task, config, {
    modelKey: enumValue<ModelKey>(body, 'model_key', ['auto', 'gpt', 'claude', 'sonnet', 'gemini', 'llama']) ?? defaults.modelKey,
    modelId: openRouterModelId(body),
    harnessKey: enumValue<Harness>(body, 'harness_key', ['chat', 'research', 'coding', 'browser', 'vm']),
    providerKey: requestedProvider ?? localProvider ?? defaults.providerKey,
    runtimeKey: enumValue<RuntimeKind>(body, 'runtime_key', ['local', 'browser', 'sandbox', 'vm', 'gpu', 'restricted']) ?? defaults.runtimeKey,
    routingPref: optionalString(body, 'routing_pref', 50),
    telemetry: store.routeTelemetry(projectId),
  })
  const permission = evaluatePermissions(store.grants(), {
    userId: request.principal.userId,
    agentId,
    resourceKind: 'project',
    resourceId: projectId,
    action: 'execute',
  })
  if (!permission.allowed) return permissionDenied(reply, permission.reason)
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
    && !(config.mode === 'local' && localSettings.policy?.approvals === 'never')
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
    executionPolicy: localSettings.policy,
    principal: request.principal,
  })
  return reply.code(202).send({
    run_id: run.id,
    session_id: run.sessionId,
    mode: config.mode,
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
    createdAt: Date.now(),
    createdBy: request.principal.userId,
  }
  await store.replaceGrant(grant)
  return grant
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
