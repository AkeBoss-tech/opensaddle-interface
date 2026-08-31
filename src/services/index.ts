import { detectRuntimeMode, type RuntimeMode } from './capabilities'
import type { AutonomyPolicySummary, DelegationPolicySummary, ExtensionCatalogClient, FileStore, LocalProjectClient, PermissionClient, ProjectGoalClient, ProjectIntelligenceClient, RuntimeClient, SandboxClient, ThreadClient, ToolClient, WorkflowClient, WorkspaceClient } from './contracts'
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
import { RemoteProjectGoalClient } from './remoteProjectGoals'
import { RemoteExtensionCatalogClient } from './remoteExtensions'
import { RemoteProjectIntelligenceClient } from './remoteProjectIntelligence'
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
  projectGoals?: ProjectGoalClient
  extensions?: ExtensionCatalogClient
  projectIntelligence?: ProjectIntelligenceClient
  controlPlane: {
    connected: boolean
    mode?: 'local' | 'company'
    modelProvider?: string
    models: string[]
    storage?: string
    capabilities: string[]
    contracts?: Record<string, string>
    delegation?: DelegationPolicySummary
    autonomy?: AutonomyPolicySummary
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
      let delegation: DelegationPolicySummary | undefined
      let autonomy: AutonomyPolicySummary | undefined
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
              delegation?: {
                enabled?: boolean
                allowed_harnesses?: string[]
                max_depth?: number
                max_active_children_per_channel?: number
                max_total_children_per_channel?: number
                default_session_strategy?: DelegationPolicySummary['defaultSessionStrategy']
                allow_network?: boolean
                allow_write?: boolean
                max_budget_usd_per_child?: number
                max_minutes_per_child?: number
              }
              autonomy?: {
                enabled?: boolean
                allowed_harnesses?: string[]
                max_active_sessions?: number
                max_runs_per_session?: number
                max_active_children_per_session?: number
                max_minutes_per_session?: number
                default_execution_mode?: AutonomyPolicySummary['defaultExecutionMode']
                allow_write?: boolean
                allow_network?: boolean
                requires_explicit_goal?: boolean
                requires_approvals?: boolean
              }
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
            if (health.delegation) {
              delegation = {
                enabled: health.delegation.enabled === true,
                allowedHarnesses: health.delegation.allowed_harnesses ?? [],
                maxDepth: health.delegation.max_depth ?? 0,
                maxActiveChildrenPerChannel: health.delegation.max_active_children_per_channel ?? 0,
                maxTotalChildrenPerChannel: health.delegation.max_total_children_per_channel ?? 0,
                defaultSessionStrategy: health.delegation.default_session_strategy ?? 'new',
                allowNetwork: health.delegation.allow_network === true,
                allowWrite: health.delegation.allow_write === true,
                maxBudgetUsdPerChild: health.delegation.max_budget_usd_per_child ?? 0,
                maxMinutesPerChild: health.delegation.max_minutes_per_child ?? 0,
              }
            }
            if (health.autonomy) {
              autonomy = {
                enabled: health.autonomy.enabled === true,
                allowedHarnesses: health.autonomy.allowed_harnesses ?? [],
                maxActiveSessions: health.autonomy.max_active_sessions ?? 0,
                maxRunsPerSession: health.autonomy.max_runs_per_session ?? 0,
                maxActiveChildrenPerSession: health.autonomy.max_active_children_per_session ?? 0,
                maxMinutesPerSession: health.autonomy.max_minutes_per_session ?? 0,
                defaultExecutionMode: health.autonomy.default_execution_mode ?? 'plan',
                allowWrite: health.autonomy.allow_write === true,
                allowNetwork: health.autonomy.allow_network === true,
                requiresExplicitGoal: health.autonomy.requires_explicit_goal !== false,
                requiresApprovals: health.autonomy.requires_approvals !== false,
              }
            }
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
      const projectGoals = backendAvailable && backendCapabilities.has('project_self_driving_v1')
        ? new RemoteProjectGoalClient(baseUrl, getUserId, token)
        : undefined
      const extensions = backendAvailable && backendCapabilities.has('extension_packages_v1')
        ? new RemoteExtensionCatalogClient(baseUrl, getUserId, token)
        : undefined
      const projectIntelligence = backendAvailable && backendCapabilities.has('project_intelligence_snapshot_v1')
        ? new RemoteProjectIntelligenceClient(baseUrl, getUserId, token)
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
        projectGoals,
        extensions,
        projectIntelligence,
        controlPlane: {
          connected: backendAvailable,
          mode: backendMode,
          modelProvider,
          models: configuredModels,
          storage,
          capabilities: [...backendCapabilities].sort(),
          contracts: backendContracts,
          delegation,
          autonomy,
        },
      }
    })()
}

export function resetServices() {
  // Kept for callers that used to reset the singleton service cache.
}
