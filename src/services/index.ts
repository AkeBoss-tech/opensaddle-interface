import { detectRuntimeMode, type RuntimeMode } from './capabilities'
import type { FileStore, PermissionClient, RuntimeClient, SandboxClient, ToolClient, WorkspaceClient } from './contracts'
import { createFileStore } from './fileStore'
import { MockRuntimeClient } from './mockRuntime'
import { LocalPermissionClient } from './permissions'
import { WorkerSandboxClient } from './sandbox'
import { MockOAuthToolClient } from './oauthTools'
import { BrowserAgentRuntime } from './browserAgentRuntime'
import type { PermissionGrant, ToolManifest, ToolCallRequest, ToolCallResult } from './contracts'
import { DaemonUnavailableError, createIpcDaemonTransport, type DaemonTransport, OpenSaddleRuntimeClient, unavailableDaemonTransport } from './opensaddleClient'

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

export interface ConnectionProfile {
  id: string
  name: string
  mode: 'demo' | 'remote'
  baseUrl: string
  token?: string
  allowMockFallback: boolean
  /** Browser HTTP is permitted only when a caller explicitly injects this transport. */
  daemonTransport?: DaemonTransport
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
      let backendAvailable = false
      let backendMode: 'local' | 'company' | undefined
      let modelProvider: string | undefined
      let configuredModels: string[] = []
      let storage: string | undefined
      const daemonTransport = connection.daemonTransport
        ?? (mode === 'desktop' && typeof window !== 'undefined' && window.opensaddle
          ? createIpcDaemonTransport(window.opensaddle)
          : unavailableDaemonTransport())
      if (connection.mode === 'remote' && mode !== 'mock') {
        try {
          const capabilities = await daemonTransport.capabilities()
          backendAvailable = capabilities.service === 'opensaddle-daemon'
          configuredModels = capabilities.capabilities
          backendMode = mode === 'desktop' ? 'local' : undefined
          modelProvider = undefined
          storage = undefined
        } catch { backendAvailable = false }
      }
      let permissions: PermissionClient
      if (connection.mode === 'demo' || mode === 'mock') {
        permissions = new LocalPermissionClient(opts.getGrants, opts.setGrants)
      } else {
        permissions = new UnavailablePermissionClient()
      }
      const tools = connection.mode === 'demo' || mode === 'mock'
        ? new MockOAuthToolClient(opts.getGrants, opts.currentUserId)
        : new UnavailableToolClient()
      const sandbox = new WorkerSandboxClient()
      const browserRuntime = new BrowserAgentRuntime(files, sandbox, permissions, ['https://example.com'])
      const runtime = connection.mode === 'remote' && (mode === 'desktop' || mode === 'browser')
        ? new OpenSaddleRuntimeClient(baseUrl, undefined, { transport: daemonTransport })
        : new MockRuntimeClient()
      const workspace = undefined
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

class UnavailablePermissionClient implements PermissionClient {
  private fail(): never { throw new DaemonUnavailableError() }
  list(): Promise<PermissionGrant[]> { return Promise.reject(this.fail()) }
  upsert(): Promise<PermissionGrant> { return Promise.reject(this.fail()) }
  revoke(): Promise<void> { return Promise.reject(this.fail()) }
  check(): Promise<never> { return Promise.reject(this.fail()) }
}

class UnavailableToolClient {
  list(): Promise<ToolManifest[]> { return Promise.reject(new DaemonUnavailableError()) }
  connect(): Promise<{ authUrl: string } | { connected: true }> { return Promise.reject(new DaemonUnavailableError()) }
  disconnect(): Promise<void> { return Promise.reject(new DaemonUnavailableError()) }
  call(_request: ToolCallRequest): Promise<ToolCallResult> { return Promise.reject(new DaemonUnavailableError()) }
}

export function resetServices() {
  // Kept for callers that used to reset the singleton service cache.
}
