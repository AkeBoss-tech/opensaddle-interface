import { detectRuntimeMode, type RuntimeMode } from './capabilities'
import type { FileStore, PermissionClient, RuntimeClient, SandboxClient, ToolClient, WorkspaceClient } from './contracts'
import { createFileStore } from './fileStore'
import { MockRuntimeClient } from './mockRuntime'
import { OpenSaddleRuntimeClient } from './opensaddleClient'
import { LocalPermissionClient } from './permissions'
import { RemotePermissionClient } from './remotePermissions'
import { RemoteWorkspaceClient } from './remoteWorkspace'
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
  controlPlane: {
    connected: boolean
    mode?: 'local' | 'company'
    modelProvider?: string
    models: string[]
    storage?: string
  }
}

let bundlePromise: Promise<ServiceBundle> | null = null

export function initServices(opts: {
  getGrants: () => PermissionGrant[]
  setGrants: (g: PermissionGrant[]) => void
  currentUserId: string
  getCurrentUserId?: () => string
  opensaddleBaseUrl?: string
}): Promise<ServiceBundle> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const mode = detectRuntimeMode()
      const files = await createFileStore()
      const baseUrl = opts.opensaddleBaseUrl
        ?? import.meta.env.VITE_OPENSADDLE_URL
        ?? 'http://127.0.0.1:8765'
      const token = import.meta.env.VITE_OPENSADDLE_TOKEN as string | undefined
      const getUserId = opts.getCurrentUserId ?? (() => opts.currentUserId)
      const explicitlyRemote = Boolean(import.meta.env.VITE_OPENSADDLE_URL)
      const allowFallback = import.meta.env.VITE_ALLOW_MOCK_FALLBACK === 'true'
        || (!explicitlyRemote && import.meta.env.VITE_ALLOW_MOCK_FALLBACK !== 'false')
      let backendAvailable = false
      let backendMode: 'local' | 'company' | undefined
      let modelProvider: string | undefined
      let configuredModels: string[] = []
      let storage: string | undefined
      if (mode !== 'mock') {
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
      const runtime = mode === 'desktop' || mode === 'browser'
          ? new OpenSaddleRuntimeClient(baseUrl, new MockRuntimeClient(), {
            token,
            getUserId,
            allowFallback,
          })
          : new MockRuntimeClient()
      const workspace = backendAvailable
        ? new RemoteWorkspaceClient(baseUrl, getUserId, token)
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
  return bundlePromise
}

export function resetServices() {
  bundlePromise = null
}
