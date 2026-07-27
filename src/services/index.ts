import { detectRuntimeMode, type RuntimeMode } from './capabilities'
import type { FileStore, LocalProjectClient, PermissionClient, RuntimeClient, SandboxClient, ThreadClient, ToolClient, WorkspaceClient } from './contracts'
import { createFileStore } from './fileStore'
import { MockRuntimeClient } from './mockRuntime'
import { OpenSaddleRuntimeClient } from './opensaddleClient'
import { LocalPermissionClient } from './permissions'
import { RemotePermissionClient } from './remotePermissions'
import { RemoteWorkspaceClient } from './remoteWorkspace'
import { RemoteThreadClient } from './remoteThreads'
import { RemoteLocalProjectClient } from './remoteLocalProjects'
import { WorkerSandboxClient } from './sandbox'
import { MockOAuthToolClient } from './oauthTools'
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
  controlPlane: {
    connected: boolean
    mode?: 'local' | 'company'
    modelProvider?: string
    models: string[]
    storage?: string
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

export function defaultConnectionProfile(): ConnectionProfile {
  const baseUrl = (import.meta.env.VITE_OPENSADDLE_URL as string | undefined) ?? 'http://127.0.0.1:8765'
  return {
    id: 'configured-server',
    name: import.meta.env.VITE_OPENSADDLE_URL ? 'Configured OpenSaddle server' : 'Local OpenSaddle server',
    mode: 'remote',
    baseUrl,
    allowMockFallback: import.meta.env.VITE_ALLOW_MOCK_FALLBACK === 'true',
  }
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
      const allowFallback = connection.mode === 'demo' || connection.allowMockFallback
      let backendAvailable = false
      let backendMode: 'local' | 'company' | undefined
      let modelProvider: string | undefined
      let configuredModels: string[] = []
      let storage: string | undefined
      if (connection.mode === 'remote' && mode !== 'mock') {
        try {
          const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health`, {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              'X-OpenSaddle-User': getUserId(),
            },
            signal: AbortSignal.timeout(1200),
          })
          backendAvailable = response.ok
          if (response.ok) {
            const health = await response.json() as {
              mode?: 'local' | 'company'
              model_provider?: string
              configured_models?: string[]
              storage?: { engine?: string }
            }
            backendMode = health.mode
            modelProvider = health.model_provider
            configuredModels = health.configured_models ?? []
            storage = health.storage?.engine
          }
        } catch {
          backendAvailable = false
        }
      }
      let permissions: PermissionClient
      if (backendAvailable) {
        const remote = new RemotePermissionClient(baseUrl, getUserId, token)
        let serverGrants = await remote.list()
        // A fresh loopback daemon can be initialized from the local demo's
        // grants. Company mode never trusts browser state as bootstrap policy.
        if (backendMode === 'local' && serverGrants.length <= 1 && opts.getGrants().length > 0) {
          for (const grant of opts.getGrants()) await remote.upsert(grant)
          serverGrants = await remote.list()
        }
        opts.setGrants(serverGrants)
        permissions = remote
      } else {
        permissions = new LocalPermissionClient(opts.getGrants, opts.setGrants)
      }
      const tools = new MockOAuthToolClient(opts.getGrants, opts.currentUserId)
      const sandbox = new WorkerSandboxClient()
      const browserRuntime = new BrowserAgentRuntime(files, sandbox, permissions, ['https://example.com'])
      const runtime = connection.mode === 'remote' && (mode === 'desktop' || mode === 'browser')
          ? new OpenSaddleRuntimeClient(baseUrl, new MockRuntimeClient(), {
            token,
            getUserId,
            allowFallback,
          })
          : new MockRuntimeClient()
      const workspace = backendAvailable
        ? new RemoteWorkspaceClient(baseUrl, getUserId, token)
        : undefined
      const threads = backendAvailable
        ? new RemoteThreadClient(baseUrl, getUserId, token)
        : undefined
      const localProjects = backendAvailable && backendMode === 'local'
        ? new RemoteLocalProjectClient(baseUrl, getUserId, token)
        : undefined
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
        controlPlane: {
          connected: backendAvailable,
          mode: backendMode,
          modelProvider,
          models: configuredModels,
          storage,
        },
      }
    })()
}

export function resetServices() {
  // Kept for callers that used to reset the singleton service cache.
}
