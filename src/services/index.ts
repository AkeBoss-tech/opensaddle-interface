import { detectRuntimeMode, type RuntimeMode } from './capabilities'
import type { AutonomyPolicySummary, CommandCenterClient, DelegationPolicySummary, ExtensionCatalogClient, FileStore, KrailProposalClient, LocalProjectClient, MalleableShellClient, OperationsSessionClient, ParticipantClient, PermissionClient, ProjectGoalClient, ProjectIntelligenceClient, RuntimeClient, SandboxClient, ThreadClient, ToolClient, WorkflowClient, WorkspaceClient } from './contracts'
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
import { RemoteCommandCenterClient } from './remoteCommandCenter'
import { RemoteMalleableShellClient } from './remoteMalleableShell'
import { RemoteKrailProposalClient } from './remoteKrailProposals'
import { RemoteParticipantClient } from './remoteParticipants'
import { RemoteOperationsSessionClient } from './remoteOperations'
import { RemoteJourneyClient } from './remoteJourney'
import type { JourneyAuthority } from '../features/onboarding/ConnectedJourneySurface'
import { negotiateRunRecovery, type RunRecoverySupport } from './recoverySupport'
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
  commandCenter?: CommandCenterClient
  krailProposals?: KrailProposalClient
  participants?: ParticipantClient
  operationsSessions?: OperationsSessionClient
  malleableShell?: MalleableShellClient
  journey?: JourneyAuthority
  controlPlane: {
    connected: boolean
    mode?: string
    v2Capabilities?: boolean
    modelProvider?: string
    models: string[]
    storage?: string
    capabilities: string[]
    contracts?: Record<string, string>
    delegation?: DelegationPolicySummary
    autonomy?: AutonomyPolicySummary
    runRecovery: RunRecoverySupport
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

export function usesConnectedProductSurface(services: ServiceBundle | null): boolean {
  return Boolean(services?.controlPlane.connected && (services.controlPlane.v2Capabilities || services.localProjects))
}

export function connectionProfileForRuntime(input: {
  runtimeMode: RuntimeMode
  configuredUrl?: string
  desktopUrl?: string
  allowMockFallback?: boolean
}): ConnectionProfile {
  const explicitUrl = input.configuredUrl ?? input.desktopUrl
  if (input.runtimeMode === 'mock' && !explicitUrl && input.allowMockFallback === true) {
    return {
      id: 'explicit-dev-fixture', name: 'Development fixture', mode: 'demo',
      baseUrl: 'http://127.0.0.1:8765', allowMockFallback: true,
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
      let backendMode: string | undefined
      let modelProvider: string | undefined
      let configuredModels: string[] = []
      let storage: string | undefined
      let backendCapabilities = new Set<string>()
      let backendContracts: Record<string, string> = {}
      let commandCenterAvailable = false
      let managedKrailAvailable = false
      let participantsAvailable = false
      let resourceCapacityAvailable = false
      let nativeAdaptersAvailable = false
      let legacyHealthAvailable = false
      let v2CapabilitiesAvailable = false
      let delegation: DelegationPolicySummary | undefined
      let autonomy: AutonomyPolicySummary | undefined
      if (connection.mode === 'remote' && mode !== 'mock') {
        try {
          const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            signal: AbortSignal.timeout(1200),
          })
          backendAvailable = response.ok
          legacyHealthAvailable = response.ok
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
        try {
          const capabilityResponse = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v2/capabilities`, {
            headers: {
              'X-OpenSaddle-User': getUserId(),
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: AbortSignal.timeout(1200),
          })
          if (capabilityResponse.ok) {
            v2CapabilitiesAvailable = true
            const capabilities = await capabilityResponse.json() as {
              capability_mode?: string
              command_center?: { available?: boolean; path?: string; schema_version?: string }
              managed_krail?: boolean
              participants?: { available?: boolean; schema_version?: string; project_path_template?: string }
              resource_capacity?: { available?: boolean; schema_version?: string; project_config_path_template?: string; status_path_template?: string }
              native_adapters?: { available?: boolean; schema_version?: string; supported_adapter_ids?: unknown; unsupported_adapter_ids?: unknown; readiness_path_template?: string; report_path_template?: string; selection_field?: string; observation_authority?: string; policy_authority?: string }
            }
            backendAvailable = true
            backendMode = capabilities.capability_mode ?? backendMode
            commandCenterAvailable = capabilities.command_center?.available === true
              && capabilities.command_center.path === '/api/v2/command-center'
              && capabilities.command_center.schema_version === 'opensaddle.command-center.v1'
            managedKrailAvailable = capabilities.managed_krail === true
            participantsAvailable = capabilities.participants?.available === true && capabilities.participants.schema_version === 'opensaddle.participant.v1' && capabilities.participants.project_path_template === '/api/v2/projects/{project_id}/participants'
            resourceCapacityAvailable = capabilities.resource_capacity?.available === true && capabilities.resource_capacity.schema_version === 'opensaddle.resource-capacity.v1' && capabilities.resource_capacity.project_config_path_template === '/api/v2/projects/{project_id}/capacity-limits' && capabilities.resource_capacity.status_path_template === '/api/v2/projects/{project_id}/capacity'
            const native = capabilities.native_adapters
            nativeAdaptersAvailable = native?.available === true && native.schema_version === 'opensaddle.native-adapter-readiness.v1' && JSON.stringify(native.supported_adapter_ids) === JSON.stringify(['codex-app-server','claude-code-stream-json']) && JSON.stringify(native.unsupported_adapter_ids) === JSON.stringify(['cursor']) && native.readiness_path_template === '/api/v2/projects/{project_id}/native-adapters' && native.report_path_template === '/api/v2/workers/{worker_id}/native-adapter-readiness' && native.selection_field === 'native_adapter_id' && native.observation_authority === 'worker_self_reported' && native.policy_authority === 'core'
          }
        } catch {
          commandCenterAvailable = false
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
      const runtime = connection.mode === 'remote'
          ? new OpenSaddleRuntimeClient(baseUrl, new MockRuntimeClient(), {
            token,
            getUserId,
            // Connected mode is authoritative. Demo mode selects the mock
            // client directly and never reaches this connected client.
            allowFallback: false,
          })
          : new MockRuntimeClient()
      const workspace = backendAvailable && legacyHealthAvailable && backendMode !== 'local' && (backendCapabilities.size === 0 || backendCapabilities.has('workspace'))
        ? new RemoteWorkspaceClient(baseUrl, getUserId, token)
        : undefined
      const threads = backendAvailable && legacyHealthAvailable && backendMode !== 'local'
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
      const projectGoals = backendAvailable && (backendCapabilities.has('project_self_driving_v1') || commandCenterAvailable)
        ? new RemoteProjectGoalClient(baseUrl, getUserId, token, commandCenterAvailable && !backendCapabilities.has('project_self_driving_v1'))
        : undefined
      const extensions = backendAvailable && backendCapabilities.has('extension_packages_v1')
        ? new RemoteExtensionCatalogClient(baseUrl, getUserId, token)
        : undefined
      const projectIntelligence = backendAvailable && backendCapabilities.has('project_intelligence_snapshot_v1')
        ? new RemoteProjectIntelligenceClient(baseUrl, getUserId, token)
        : undefined
      const commandCenter = backendAvailable && commandCenterAvailable
        ? new RemoteCommandCenterClient(baseUrl, getUserId, token)
        : undefined
      const malleableShell = commandCenter
        ? new RemoteMalleableShellClient(baseUrl, getUserId, token)
        : undefined
      const krailProposals = backendAvailable && managedKrailAvailable
        ? new RemoteKrailProposalClient(baseUrl, getUserId, token)
        : undefined
      const participants = backendAvailable && participantsAvailable ? new RemoteParticipantClient(baseUrl, getUserId, token) : undefined
      const operationsSessions = backendAvailable && commandCenterAvailable ? new RemoteOperationsSessionClient(baseUrl, getUserId, token) : undefined
      const journey = backendAvailable && commandCenterAvailable ? new RemoteJourneyClient(baseUrl, getUserId, token, resourceCapacityAvailable, nativeAdaptersAvailable) : undefined
      const tools = connection.mode === 'remote'
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
        commandCenter,
        krailProposals,
        participants,
        operationsSessions,
        malleableShell,
        journey,
        controlPlane: {
          connected: backendAvailable,
          mode: backendMode,
          v2Capabilities: v2CapabilitiesAvailable,
          modelProvider,
          models: configuredModels,
          storage,
          capabilities: [...backendCapabilities].sort(),
          contracts: backendContracts,
          delegation,
          autonomy,
          runRecovery: negotiateRunRecovery(legacyHealthAvailable, v2CapabilitiesAvailable),
        },
      }
    })()
}

export function resetServices() {
  // Kept for callers that used to reset the singleton service cache.
}
