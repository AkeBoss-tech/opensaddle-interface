import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import type { HarnessProfile } from './harness/types.js'
import type { CodingProvider, DeploymentMode, ModelKey, ModelRouteConfig } from './types.js'

function loadLocalEnvironment(): void {
  const candidates = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), 'packages/control-plane/.env.local'),
    resolve(process.cwd(), 'packages/control-plane/.env'),
  ]
  for (const path of [...new Set(candidates)]) {
    try {
      loadEnvFile(path)
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
      if (!missing) throw error
    }
  }
}

loadLocalEnvironment()

export interface ApiKeyIdentity {
  userId: string
  roles: string[]
}

export interface ControlPlaneConfig {
  mode: DeploymentMode
  host: string
  port: number
  dataDir: string
  workspaceDir: string
  corsOrigins: string[]
  apiKeys: Map<string, ApiKeyIdentity>
  bootstrapAdminId: string
  modelRoutes: Partial<Record<Exclude<ModelKey, 'auto'>, ModelRouteConfig>>
  defaultModel: Exclude<ModelKey, 'auto'>
  /** Prefer this coding harness when available (`opensaddle` = native). */
  defaultCodingProvider: Exclude<CodingProvider, 'auto'>
  /** Allowlisted coding providers (plus opensaddle is always eligible). */
  codingProviders: string[]
  /** Extra/override harness profiles (KRAIL-style custom harness registration). */
  harnessProfiles: HarnessProfile[]
  runtimeProvider: 'local' | 'docker'
  dockerImage: string
  runtimeTtlMs: number
  allowedRepoRoots: string[]
  maxConcurrentRuns: number
  modelProvider: 'openrouter' | 'openai-compatible' | 'unconfigured'
}

function parseJson<T>(name: string, fallback: T): T {
  const raw = process.env[name]
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`${name} must contain valid JSON`)
  }
}

function parseApiKeys(): Map<string, ApiKeyIdentity> {
  const configured = parseJson<Record<string, ApiKeyIdentity | string>>('OPENSADDLE_API_KEYS_JSON', {})
  const result = new Map<string, ApiKeyIdentity>()
  for (const [token, identity] of Object.entries(configured)) {
    if (token.length < 24) throw new Error('Company API keys must be at least 24 characters')
    result.set(token, typeof identity === 'string' ? { userId: identity, roles: [] } : identity)
  }
  return result
}

function parseModelRoutes(): ControlPlaneConfig['modelRoutes'] {
  const routes = parseJson<ControlPlaneConfig['modelRoutes']>('OPENSADDLE_MODEL_ROUTES_JSON', {})

  // OpenRouter is OpenAI-compatible. Keep the key server-only and use its
  // free-model router unless a specific model is configured.
  if (process.env.OPENROUTER_API_KEY && !routes.gpt) {
    const headers: Record<string, string> = {}
    if (process.env.OPENROUTER_SITE_URL) headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL
    headers['X-OpenRouter-Title'] = process.env.OPENROUTER_APP_NAME ?? 'OpenSaddle'
    routes.gpt = {
      baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      model: process.env.OPENROUTER_MODEL ?? 'openrouter/free',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      headers,
    }
  }

  // A single OpenAI-compatible endpoint works for hosted gateways and local
  // servers such as Ollama, vLLM, or LM Studio.
  const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL
  const model = process.env.OPENAI_COMPATIBLE_MODEL
  if (baseUrl && model && !routes.gpt) {
    routes.gpt = {
      baseUrl,
      model,
      apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    }
  }
  return routes
}

export function loadConfig(): ControlPlaneConfig {
  const mode = (process.env.OPENSADDLE_MODE ?? 'local') as DeploymentMode
  if (mode !== 'local' && mode !== 'company') throw new Error('OPENSADDLE_MODE must be local or company')

  const apiKeys = parseApiKeys()
  if (mode === 'company' && apiKeys.size === 0) {
    throw new Error('Company mode requires OPENSADDLE_API_KEYS_JSON')
  }

  const dataDir = resolve(process.env.OPENSADDLE_DATA_DIR ?? '.opensaddle')
  const workspaceDir = resolve(process.env.OPENSADDLE_WORKSPACE_DIR ?? resolve(dataDir, 'workspaces'))
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  mkdirSync(workspaceDir, { recursive: true, mode: 0o700 })

  const defaultHost = mode === 'local' ? '127.0.0.1' : '0.0.0.0'
  const corsOrigins = (process.env.OPENSADDLE_CORS_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  const defaultModel = (process.env.OPENSADDLE_DEFAULT_MODEL ?? 'gpt') as Exclude<ModelKey, 'auto'>
  const modelRoutes = parseModelRoutes()
  const runtimeProvider = (process.env.OPENSADDLE_RUNTIME_PROVIDER ?? (mode === 'company' ? 'docker' : 'local')) as 'local' | 'docker'
  if (runtimeProvider !== 'local' && runtimeProvider !== 'docker') {
    throw new Error('OPENSADDLE_RUNTIME_PROVIDER must be local or docker')
  }

  const defaultCodingProvider = (process.env.OPENSADDLE_DEFAULT_CODING_PROVIDER ?? 'opensaddle') as Exclude<CodingProvider, 'auto'>
  const codingProviders = (process.env.OPENSADDLE_CODING_PROVIDERS
    ?? 'opensaddle,codex,claude,cursor,gemini,opencode')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  return {
    mode,
    host: process.env.OPENSADDLE_HOST ?? defaultHost,
    port: Number(process.env.OPENSADDLE_PORT ?? 8765),
    dataDir,
    workspaceDir,
    corsOrigins,
    apiKeys,
    bootstrapAdminId: process.env.OPENSADDLE_BOOTSTRAP_ADMIN ?? 'user-ad',
    modelRoutes,
    defaultModel,
    defaultCodingProvider,
    codingProviders,
    harnessProfiles: parseJson<HarnessProfile[]>('OPENSADDLE_HARNESS_PROFILES_JSON', []),
    runtimeProvider,
    dockerImage: process.env.OPENSADDLE_DOCKER_IMAGE ?? 'node:22-alpine',
    runtimeTtlMs: Number(process.env.OPENSADDLE_RUNTIME_TTL_MS ?? 3_600_000),
    allowedRepoRoots: (process.env.OPENSADDLE_ALLOWED_REPO_ROOTS ?? process.cwd())
      .split(',')
      .map((root) => resolve(root.trim()))
      .filter(Boolean),
    maxConcurrentRuns: Number(process.env.OPENSADDLE_MAX_CONCURRENT_RUNS ?? 4),
    modelProvider: process.env.OPENROUTER_API_KEY
      ? 'openrouter'
      : Object.keys(modelRoutes).length > 0
        ? 'openai-compatible'
        : 'unconfigured',
  }
}
