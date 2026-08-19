import { detectRuntimeMode, type RuntimeMode } from './capabilities'
import type { FileStore, LocalProjectClient, PermissionClient, RuntimeClient, SandboxClient, ThreadClient, ToolClient, WorkflowClient, WorkspaceClient } from './contracts'
import { createFileStore } from './fileStore'
import { MockRuntimeClient } from './mockRuntime'
import { OpenSaddleRuntimeClient } from './opensaddleClient'
import { LocalPermissionClient } from './permissions'
import { RemotePermissionClient } from './remotePermissions'
import { RemoteWorkspaceClient } from './remoteWorkspace'
import { RemoteThreadClient } from './remoteThreads'
import { AuthoritativeThreadClient } from './authoritativeThreads'
import { AuthoritativeLocalProjectClient } from './authoritativeLocalProjects'
import { RemoteLocalProjectClient } from './remoteLocalProjects'
import { WorkerSandboxClient } from './sandbox'
import { MockOAuthToolClient } from './oauthTools'
import { RemoteIntegrationToolClient } from './remoteIntegrations'
import { RemoteWorkflowClient } from './remoteWorkflows'
import { BrowserAgentRuntime } from './browserAgentRuntime'
import type { PermissionGrant } from './contracts'

export interface ServiceBundle {
  mode: RuntimeMode
  runtime: RuntimeClient
  files: FileStore
  sandbox: SandboxClient
  tools: ToolClient
  browserRuntime: BrowserAgentRuntime
  permissions: PermissionClient
  workspace?: WorkspaceClient
  threads?: ThreadClient
  localProjects?: LocalProjectClient
  workflows?: WorkflowClient
  controlPlane: {
    connected: boolean
    mode?: 'local' | 'company'
    modelProvider?: string
    models: string[]
    storage?: string
    capabilities: string[]
    contracts?: Record<string, string>
  }
}

export interface ConnectionProfile {
  id: string
  name: string
  mode: 'demo' | 'remote'
  baseUrl: string
  token?: string
  allowMockFallback: boolean
}

export function connectionProfileForRuntime(input: {
  runtimeMode: RuntimeMode
  configuredUrl?: string
  desktopUrl?: string
  allowMockFallback?: boolean
}): ConnectionProfile {
  const explicitUrl = input.configuredUrl ?? input.desktopUrl
  if (input.runtimeMode === 'mock' && !explicitUrl) {
    return {
      id: 'demo',
      name: 'Demo workspace',
      mode: 'demo',
      baseUrl: 'http://127.0.0.1:8765',
      allowMockFallback: true,
    }
  }
  const baseUrl = explicitUrl ?? 'http://127.0.0.1:8765'
  return {
    id: 'configured-server',
    name: input.configuredUrl ? 'Configured OpenSaddle server' : 'Local OpenSaddle server',
    mode: 'remote',
    baseUrl,
    allowMockFallback: input.allowMockFallback ?? false,
  }
}

export function defaultConnectionProfile(): ConnectionProfile {
  const desktopUrl = typeof window !== 'undefined'
    ? window.opensaddle?.opensaddleUrl
    : undefined
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
  return connectionProfileForRuntime({
    runtimeMode: detectRuntimeMode(),
    configuredUrl: env.VITE_OPENSADDLE_URL,
    desktopUrl,
    allowMockFallback: env.VITE_ALLOW_MOCK_FALLBACK === 'true',
  })
}

export function initServices(opts: {
  getGrants: () => PermissionGrant[]
  setGrants: (g: PermissionGrant[]) => void
  currentUserId: string
  getCurrentUserId?: () => string
  connection?: ConnectionProfile
}): Promise<ServiceBundle> {
  return (async () => {
      const mode = detectRuntimeMode()
      const files = await createFileStore()
      const connection = opts.connection ?? defaultConnectionProfile()
      const baseUrl = connection.baseUrl
      const token = connection.token
      const getUserId = opts.getCurrentUserId ?? (() => opts.currentUserId)
      let backendAvailable = false
      let backendMode: 'local' | 'company' | undefined
      let modelProvider: string | undefined
      let configuredModels: string[] = []
      let storage: string | undefined
      let backendCapabilities = new Set<string>()
      let backendContracts: Record<string, string> = {}
      if (connection.mode === 'remote' && mode !== 'mock') {
        try {
          const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            signal: AbortSignal.timeout(1200),
          })
          backendAvailable = response.ok
          if (response.ok) {
            const health = await response.json() as {
              mode?: 'local' | 'company'
              model_provider?: string
              configured_models?: string[]
              storage?: { engine?: string }
              capabilities?: string[]
              contracts?: Record<string, unknown>
            }
            backendMode = health.mode
            modelProvider = health.model_provider
            configuredModels = health.configured_models ?? []
            storage = health.storage?.engine
            backendCapabilities = new Set(health.capabilities ?? [])
            backendContracts = Object.fromEntries(
              Object.entries(health.contracts ?? {})
                .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
            )
          }
        } catch {
          backendAvailable = false
        }
      }
      let permissions: PermissionClient
      if (backendAvailable && (backendCapabilities.size === 0 || backendCapabilities.has('permissions'))) {
        const remote = new RemotePermissionClient(baseUrl, getUserId, token)
        try {
          let serverGrants = await remote.list()
          opts.setGrants(serverGrants)
          permissions = remote
        } catch {
          permissions = new LocalPermissionClient(opts.getGrants, opts.setGrants)
        }
      } else {
        permissions = new LocalPermissionClient(opts.getGrants, opts.setGrants)
      }
      const runtime = connection.mode === 'remote' && (mode === 'desktop' || mode === 'browser')
          ? new OpenSaddleRuntimeClient(baseUrl, new MockRuntimeClient(), {
            token,
            getUserId,
            // Connected mode is authoritative. Demo mode selects the mock
            // client directly and never reaches this connected client.
            allowFallback: false,
          })
          : new MockRuntimeClient()
      const workspace = backendAvailable && backendMode !== 'local' && (backendCapabilities.size === 0 || backendCapabilities.has('workspace'))
        ? new RemoteWorkspaceClient(baseUrl, getUserId, token)
        : undefined
      const threads = backendAvailable && backendMode !== 'local'
        ? backendCapabilities.has('threads')
          ? new AuthoritativeThreadClient(baseUrl, getUserId, token)
          : backendCapabilities.size === 0
            ? new RemoteThreadClient(baseUrl, getUserId, token)
            : undefined
        : undefined
      const localProjects = backendAvailable
        && backendMode === 'local'
        ? backendCapabilities.has('projects')
          ? new AuthoritativeLocalProjectClient(baseUrl, getUserId, token)
          : backendCapabilities.size === 0 || backendCapabilities.has('local-projects')
            ? new RemoteLocalProjectClient(baseUrl, getUserId, token)
            : undefined
        : undefined
      const workflows = backendAvailable && backendMode !== 'local' && backendCapabilities.has('workflows')
        ? new RemoteWorkflowClient(baseUrl, getUserId, token)
        : undefined
      const tools = connection.mode === 'remote' && mode !== 'mock'
        ? new RemoteIntegrationToolClient(baseUrl, getUserId, token)
        : new MockOAuthToolClient(opts.getGrants, opts.currentUserId)
      const sandbox = new WorkerSandboxClient()
      const browserRuntime = new BrowserAgentRuntime(
        files,
        sandbox,
        permissions,
        ['https://example.com'],
        localProjects,
      )
      return {
        mode,
        runtime,
        files,
        sandbox,
        tools,
        browserRuntime,
        permissions,
        workspace,
        threads,
        localProjects,
        workflows,
        controlPlane: {
          connected: backendAvailable,
          mode: backendMode,
          modelProvider,
          models: configuredModels,
          storage,
          capabilities: [...backendCapabilities].sort(),
          contracts: backendContracts,
        },
      }
    })()
}

export function resetServices() {
  // Kept for callers that used to reset the singleton service cache.
}
