import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AgentInterface, AppData, Chat, CodingProvider, CustomAgent, Dashboard, LocalProjectSettings, Message, PermissionGrant, PinnedArtifact, Project, ProjectSource, QuickApi, SettingsState, Site, SiteVersion, Theme, Visibility, WikiSettings, WorkflowDef, WorkflowRun,
} from '../types'
import { createSeedData, DATA_VERSION, STORAGE_KEY } from './seed'
import {
  captureWorkspaceRecovery,
  deleteWorkspaceRecovery,
  listWorkspaceRecoveries,
  loadWorkspace,
  normalizeWorkspace,
  readWorkspaceRecovery,
  type WorkspaceRecovery,
} from './workspacePersistence'
import { defaultConnectionProfile, initServices, resetServices, type ConnectionProfile, type ServiceBundle } from '../services'
import { detectRuntimeMode, modeLabel } from '../services/capabilities'
import { evaluatePermissions } from '../services/permissions'
import { adoptNativeContinuation } from '../lib/nativeContinuation'
import { projectFromRegisteredLocalProject } from './registeredLocalProjects'
import type {
  DurableThread,
  DurableThreadMessage,
  HarnessCapability,
  ProjectArtifactManifest,
} from '../services/contracts'

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

function messageFromDurable(message: DurableThreadMessage): Message {
  const payload = message.payload ?? {}
  return {
    ...payload,
    id: message.id,
    chatId: message.threadId,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    runtimeRunId: typeof payload.runtime_run_id === 'string'
      ? payload.runtime_run_id
      : typeof payload.runtimeRunId === 'string'
        ? payload.runtimeRunId
        : undefined,
  } as Message
}

function mergeRuntimeProjection(remote: Message, existing: Message | undefined): Message {
  if (
    !existing?.run
    || !remote.runtimeRunId
    || (existing.runtimeRunId !== remote.runtimeRunId && existing.run.id !== remote.runtimeRunId)
  ) return remote
  return {
    ...remote,
    run: existing.run,
    routingNote: remote.routingNote ?? existing.routingNote,
    lightHtml: remote.lightHtml ?? existing.lightHtml,
  }
}

interface StoreApi {
  data: AppData
  setTheme: (t: Theme) => void
  updateSettings: (patch: Partial<SettingsState>) => void
  setActiveProject: (id: string) => void
  setActiveChat: (id: string | null) => void
  createChat: (projectId: string, title?: string, agentId?: string, continuation?: Chat['continuation'], activate?: boolean) => Chat
  adoptChatContinuation: (id: string, sessionId: string, checkpointId?: string, provider?: NonNullable<Chat['continuation']>['provider']) => void
  renameChat: (id: string, title: string) => void
  updateChatRunConfig: (id: string, runConfig: NonNullable<Chat['runConfig']>) => void
  deleteChat: (id: string) => void
  archiveChat: (id: string) => void
  setChatArchived: (id: string, archived: boolean) => void
  setChatVisibility: (id: string, visibility: Visibility, sharedWith?: string[]) => void
  branchChat: (id: string) => Chat | null
  branchChatFromMessage: (chatId: string, messageId: string) => Chat | null
  appendMessage: (
    msg: Omit<Message, 'id' | 'createdAt'> & { id?: string },
    options?: { persist?: boolean },
  ) => Message
  updateMessage: (id: string, patch: Partial<Message>) => void
  createProject: (name: string, parentId: string | null, description: string) => string
  importLocalProject: (input: { name: string; description: string; local: LocalProjectSettings }) => string
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'routingDefaults' | 'workspaceKind' | 'local'>>) => void
  setPinnedArtifacts: (items: PinnedArtifact[]) => void
  createAgent: (input: Omit<CustomAgent, 'id' | 'createdAt'>) => CustomAgent
  updateAgent: (id: string, patch: Partial<Omit<CustomAgent, 'id' | 'projectId' | 'createdAt'>>) => void
  deleteAgent: (id: string) => void
  createSite: (input: Omit<Site, 'id' | 'createdAt' | 'updatedAt' | 'slug' | 'accent' | 'versions' | 'agentPlacement'> & Partial<Pick<Site, 'slug' | 'accent' | 'agentPlacement'>>) => Site
  createSiteVersion: (siteId: string, label: string, summary: string) => SiteVersion | null
  publishSiteVersion: (siteId: string, versionId: string) => void
  updateSite: (siteId: string, patch: Partial<Pick<Site, 'name' | 'slug' | 'accent' | 'pages' | 'agentId' | 'agentPlacement' | 'visibility' | 'description'>>) => void
  switchUser: (userId: string) => void
  createApi: (input: Omit<QuickApi, 'id' | 'createdAt' | 'runHistory' | 'records'> & { records?: QuickApi['records'] }) => QuickApi
  mutateApi: (id: string, action: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'TRANSFORM', payload?: Record<string, string | number | boolean>) => void
  createDashboard: (input: Omit<Dashboard, 'id' | 'createdAt'>) => Dashboard
  createInterface: (input: Omit<AgentInterface, 'id' | 'createdAt'>) => AgentInterface
  togglePlugin: (id: string) => void
  markNotificationsRead: () => void
  updateTaskStatus: (id: string, status: AppData['tasks'][0]['status']) => void
  updateEnvironmentStatus: (id: string, status: AppData['environments'][0]['status']) => void
  requestSecureVm: (input: { projectId: string; task: string; cpu: string; network: string; idleTimeout: string }) => { environmentId: string; taskId: string }
  updateWikiSettings: (patch: Partial<WikiSettings>) => void
  refreshWikiSummaries: (projectId: string) => void
  setPermissionGrants: (grants: PermissionGrant[]) => void
  upsertPermissionGrant: (grant: Omit<PermissionGrant, 'id' | 'createdAt'> & { id?: string }) => Promise<PermissionGrant>
  consumePermissionGrant: (id: string) => Promise<PermissionGrant>
  revokePermissionGrant: (id: string) => Promise<void>
  createWorkflow: (input: Omit<WorkflowDef, 'id' | 'createdAt'>) => WorkflowDef
  updateWorkflowStatus: (id: string, status: WorkflowDef['status']) => void
  runWorkflow: (id: string) => Promise<WorkflowRun | null>
  attachSource: (input: Omit<ProjectSource, 'id' | 'lastSyncAt'>) => ProjectSource
  updateSource: (id: string, patch: Partial<Pick<ProjectSource, 'name' | 'url' | 'status' | 'branch' | 'folderPath'>>) => void
  updateHunk: (messageId: string, hunkId: string, status: 'accepted' | 'rejected') => void
  resetData: () => void
  exportData: () => string
  toast: (title: string, message: string) => void
  toasts: Array<{ id: string; title: string; message: string }>
  dismissToast: (id: string) => void
  services: ServiceBundle | null
  harnessCapabilities: HarnessCapability[]
  refreshHarnessCapabilities: () => Promise<HarnessCapability[]>
  localProjectManifests: Record<string, ProjectArtifactManifest>
  rescanLocalProject: (projectId: string) => Promise<ProjectArtifactManifest | null>
  runtimeModeLabel: string
  persistenceStatus: 'local' | 'loading' | 'syncing' | 'synced' | 'needs_setup' | 'error'
  threadHistoryHydrated: boolean
  lastSavedAt: number | null
  connection: ConnectionProfile
  connectToServer: (profile: Pick<ConnectionProfile, 'name' | 'baseUrl' | 'token'>) => Promise<void>
  switchToDemo: () => void
  initializeRemoteWorkspace: () => Promise<void>
  workspaceRecoveries: WorkspaceRecovery[]
  restoreWorkspaceRecovery: (id: string) => void
  discardWorkspaceRecovery: (id: string) => void
}

const StoreContext = createContext<StoreApi | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [initialLoad] = useState(() => loadWorkspace())
  const [data, setData] = useState<AppData>(() => initialLoad.data)
  const [workspaceRecoveries, setWorkspaceRecoveries] = useState<WorkspaceRecovery[]>(() => initialLoad.recoveries)
  const [toasts, setToasts] = useState<Array<{ id: string; title: string; message: string }>>([])
  const [services, setServices] = useState<ServiceBundle | null>(null)
  const [persistenceStatus, setPersistenceStatus] = useState<StoreApi['persistenceStatus']>('loading')
  const [threadHistoryHydrated, setThreadHistoryHydrated] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [connection, setConnection] = useState<ConnectionProfile>(() => defaultConnectionProfile())
  const [harnessCapabilities, setHarnessCapabilities] = useState<HarnessCapability[]>([])
  const [localProjectManifests, setLocalProjectManifests] = useState<Record<string, ProjectArtifactManifest>>({})
  const grantsRef = useRef(data.permissionGrants)
  const currentUserRef = useRef(data.currentUserId)
  const dataRef = useRef(data)
  const workspaceHydratedRef = useRef(false)
  const saveSequenceRef = useRef(0)
  const durableHydratedServiceRef = useRef<ServiceBundle['threads'] | null>(null)
  const threadCreatePromisesRef = useRef(new Map<string, Promise<unknown>>())
  const messageCreatePromisesRef = useRef(new Map<string, Promise<unknown>>())
  const threadMessageTailRef = useRef(new Map<string, Promise<unknown>>())
  const messageSyncTimersRef = useRef(new Map<string, number>())
  const messageSyncSnapshotsRef = useRef(new Map<string, Message>())
  const loadNoticeShownRef = useRef(false)
  grantsRef.current = data.permissionGrants
  currentUserRef.current = data.currentUserId
  dataRef.current = data
  const localProjectKey = data.projects
    .filter((project) => project.workspaceKind === 'local' && project.local)
    .map((project) => `${project.id}:${project.local!.rootPath}:${JSON.stringify(project.local!.harnesses)}`)
    .sort()
    .join('|')

  const toast = useCallback((title: string, message: string) => {
    const id = uid('toast')
    setToasts((t) => [...t, { id, title, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600)
  }, [])

  useEffect(() => {
    if (!initialLoad.notice || loadNoticeShownRef.current) return
    loadNoticeShownRef.current = true
    toast('Workspace recovery', initialLoad.notice)
  }, [initialLoad.notice, toast])

  const refreshHarnessCapabilities = useCallback(async () => {
    if (!services?.localProjects) {
      setHarnessCapabilities([])
      return []
    }
    const snapshot = await services.localProjects.refreshHarnessCapabilities()
    setHarnessCapabilities(snapshot.harnesses)
    return snapshot.harnesses
  }, [services])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      toast('Local save unavailable', 'Browser storage is full or blocked. Your current session remains in memory.')
    }
  }, [data, toast])

  useEffect(() => {
    document.body.dataset.theme = data.settings.theme === 'dark' ? undefined : data.settings.theme
    if (data.settings.theme === 'dark') document.body.removeAttribute('data-theme')
    else document.body.setAttribute('data-theme', data.settings.theme)
  }, [data.settings.theme])

  useEffect(() => {
    let cancelled = false
    void initServices({
      getGrants: () => grantsRef.current,
      setGrants: (grants) => setData((d) => ({ ...d, permissionGrants: grants })),
      currentUserId: data.currentUserId,
      getCurrentUserId: () => currentUserRef.current,
      connection,
    }).then(async (bundle) => {
      if (cancelled) return
      setServices(bundle)
      if (!workspaceHydratedRef.current && bundle.workspace) {
        try {
          const remote = await bundle.workspace.load()
          if (cancelled) return
          if (remote?.version === DATA_VERSION) {
            const normalized = normalizeWorkspace(remote)
            setData(normalized)
          } else {
            workspaceHydratedRef.current = true
            setPersistenceStatus('needs_setup')
            toast('Remote workspace needs setup', 'No compatible workspace was found. Choose Initialize remote workspace to upload demo data explicitly.')
            return
          }
          workspaceHydratedRef.current = true
          setPersistenceStatus('synced')
        } catch (error) {
          workspaceHydratedRef.current = true
          setPersistenceStatus('error')
          toast('Database sync unavailable', error instanceof Error ? error.message : String(error))
        }
      } else if (!bundle.workspace) {
        workspaceHydratedRef.current = true
        setPersistenceStatus('local')
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setServices(null)
        setPersistenceStatus('local')
        toast('Control plane unavailable', error instanceof Error ? error.message : String(error))
      }
    })
    return () => { cancelled = true }
  }, [connection, data.currentUserId, toast])

  // The desktop sidecar can restart independently of the renderer. Recreate
  // the service bundle whenever loopback health changes so the UI recovers
  // without a manual reload and never keeps displaying a stale connection.
  useEffect(() => {
    if (!services || connection.mode !== 'remote') return
    let cancelled = false
    let checking = false
    const reinitialize = () => {
      workspaceHydratedRef.current = false
      durableHydratedServiceRef.current = null
      setPersistenceStatus('loading')
      setServices(null)
      setConnection((current) => ({ ...current }))
    }
    const check = async () => {
      if (checking) return
      checking = true
      try {
        const response = await fetch(`${connection.baseUrl.replace(/\/$/, '')}/api/health`, {
          headers: connection.token ? { Authorization: `Bearer ${connection.token}` } : undefined,
          signal: AbortSignal.timeout(1_200),
        })
        const connected = response.ok
        if (!cancelled && connected !== services.controlPlane.connected) {
          reinitialize()
        }
      } catch {
        if (!cancelled && services.controlPlane.connected) {
          reinitialize()
        }
      } finally {
        checking = false
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 3_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [connection, services])

  useEffect(() => {
    if (!services?.localProjects) {
      setHarnessCapabilities([])
      setLocalProjectManifests({})
      return
    }
    let cancelled = false
    void services.localProjects.harnessCapabilities()
      .then((snapshot) => {
        if (!cancelled) setHarnessCapabilities(snapshot.harnesses)
      })
      .catch(() => {
        if (!cancelled) setHarnessCapabilities([])
      })
    // Workspace persistence is debounced. Re-probe shortly after it settles so
    // newly registered project-local executables and model ids are reflected.
    const harnessRefreshTimer = window.setTimeout(() => {
      void services.localProjects!.refreshHarnessCapabilities()
        .then((snapshot) => {
          if (!cancelled) setHarnessCapabilities(snapshot.harnesses)
        })
        .catch(() => undefined)
    }, 800)
    const localProjects = dataRef.current.projects.filter((project) => project.workspaceKind === 'local' && project.local)
    void Promise.all(localProjects.map(async (project) => {
      try {
        return [project.id, await services.localProjects!.rescan(project.id)] as const
      } catch {
        return null
      }
    })).then((entries) => {
      if (cancelled) return
      setLocalProjectManifests(Object.fromEntries(entries.filter((entry): entry is readonly [string, ProjectArtifactManifest] => Boolean(entry))))
    })
    return () => {
      cancelled = true
      window.clearTimeout(harnessRefreshTimer)
    }
  }, [localProjectKey, services])

  useEffect(() => {
    if (!services?.localProjects?.listProjects || !harnessCapabilities.length) return
    let cancelled = false
    const preferredHarness = ['codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity']
      .find((id) => harnessCapabilities.some((capability) =>
        capability.id === id
        && capability.availability === 'available'
        && capability.readiness === 'ready'))
      ?? 'opensaddle'
    void services.localProjects.listProjects()
      .then((registrations) => {
        if (cancelled || !registrations.length) return
        setData((current) => {
          const missing = registrations.filter((registration) =>
            !current.projects.some((project) => project.id === registration.projectId))
          if (!missing.length) return current
          const next = structuredClone(current)
          for (const registration of missing) {
            next.projects.push(projectFromRegisteredLocalProject(registration, preferredHarness))
            for (const action of ['read', 'write', 'execute', 'administer']) {
              if (next.permissionGrants.some((grant) =>
                grant.principalKind === 'user'
                && grant.principalId === next.currentUserId
                && grant.resourceKind === 'project'
                && grant.resourceId === registration.projectId
                && grant.action === action
                && grant.effect === 'allow')) continue
              next.permissionGrants.push({
                id: uid('grant'),
                principalKind: 'user',
                principalId: next.currentUserId,
                resourceKind: 'project',
                resourceId: registration.projectId,
                action,
                effect: 'allow',
                inheritance: 'direct',
                createdAt: Date.now(),
                createdBy: next.currentUserId,
              })
            }
          }
          return next
        })
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [harnessCapabilities, services])

  useEffect(() => {
    if (!services?.threads) {
      setThreadHistoryHydrated(true)
      return
    }
    if (!workspaceHydratedRef.current || durableHydratedServiceRef.current === services.threads) return
    setThreadHistoryHydrated(false)
    durableHydratedServiceRef.current = services.threads
    let cancelled = false
    void (async () => {
      const durableThreads: DurableThread[] = []
      let threadCursor: string | undefined
      do {
        const page = await services.threads!.list({ includeArchived: true, limit: 100, cursor: threadCursor })
        durableThreads.push(...page.threads)
        threadCursor = page.nextCursor
      } while (threadCursor && durableThreads.length < 2_000)

      // Thread metadata is enough to hydrate the Work page and navigation.
      // Fetching every transcript here caused one request (plus a browser CORS
      // preflight) per historical task and could temporarily starve the local
      // sidecar's health checks. The active transcript is loaded by the
      // granular effect below; other transcripts are loaded when opened or
      // when their server-owned updatedAt changes.
      let durableMessages: DurableThreadMessage[] = []
      const durableThreadIds = new Set(durableThreads.map((thread) => thread.id))
      const localOnlyChats = dataRef.current.chats.filter((chat) => !durableThreadIds.has(chat.id))
      for (const chat of localOnlyChats) {
        const created = await services.threads!.create({
          id: chat.id,
          projectId: chat.projectId,
          title: chat.title,
          visibility: chat.visibility,
          sharedWith: chat.sharedWith,
          agentId: chat.agentId,
          continuation: chat.continuation,
          runConfig: chat.runConfig,
          pinned: dataRef.current.recentChatIds.includes(chat.id),
        })
        durableThreads.push(created)
        const localMessages = dataRef.current.messages
          .filter((message) => message.chatId === chat.id)
          .sort((left, right) => left.createdAt - right.createdAt)
        const uploaded: DurableThreadMessage[] = []
        for (const message of localMessages) {
          uploaded.push(await services.threads!.appendMessage(chat.id, {
            id: message.id,
            role: message.role,
            text: message.text,
            payload: threadPayload(message),
          }))
        }
        durableMessages = [...durableMessages, ...uploaded]
      }
      if (cancelled) return
      setData((current) => {
        const next = structuredClone(current)
        const remoteChats = durableThreads.map<Chat>((thread) => ({
          id: thread.id,
          projectId: thread.projectId,
          title: thread.title,
          visibility: thread.visibility,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          branchedFromId: thread.branchedFromId,
          sharedWith: thread.sharedWith,
          archived: Boolean(thread.archivedAt),
          agentId: thread.agentId,
          runConfig: thread.runConfig as Chat['runConfig'],
          continuation: thread.continuation,
        }))
        const remoteMessages = durableMessages.map(messageFromDurable)
          .map((message) => mergeRuntimeProjection(
            message,
            next.messages.find((existing) => existing.id === message.id),
          ))
        const remoteChatIds = new Set(remoteChats.map((thread) => thread.id))
        const remoteMessageIds = new Set(remoteMessages.map((message) => message.id))
        next.chats = [...remoteChats, ...next.chats.filter((thread) => !remoteChatIds.has(thread.id))]
        next.messages = [...remoteMessages, ...next.messages.filter((message) => !remoteMessageIds.has(message.id))]
        return normalizeWorkspace(next)
      })
      setThreadHistoryHydrated(true)
    })().catch((error: unknown) => {
      if (!cancelled) toast('Task history sync failed', error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [services, persistenceStatus, toast])

  // Keep the open task current with granular thread storage. This is separate
  // from the workspace snapshot because a run, another desktop window, or a
  // restored process can append messages after the initial hydration.
  useEffect(() => {
    const threads = services?.threads
    const threadId = data.activeChatId
    if (!threads || !threadId || !threadHistoryHydrated) return
    let cancelled = false

    const refresh = async () => {
      const page = await threads.messages(threadId, { limit: 250 })
      if (cancelled) return
      const durable = page.messages.map(messageFromDurable)
      setData((current) => {
        const currentById = new Map(
          current.messages
            .filter((message) => message.chatId === threadId)
            .map((message) => [message.id, message]),
        )
        const remote = durable.map((message) => mergeRuntimeProjection(
          message,
          currentById.get(message.id),
        ))
        const changed = remote.some((message) => {
          const existing = currentById.get(message.id)
          return !existing
            || existing.text !== message.text
            || JSON.stringify(existing.run) !== JSON.stringify(message.run)
            || existing.routingNote !== message.routingNote
            || existing.lightHtml !== message.lightHtml
        })
        if (!changed) return current
        const remoteIds = new Set(remote.map((message) => message.id))
        return normalizeWorkspace({
          ...current,
          messages: [
            ...current.messages.filter((message) => message.chatId !== threadId || !remoteIds.has(message.id)),
            ...remote,
          ],
        })
      })
    }

    void refresh().catch((error: unknown) => {
      if (!cancelled) toast('Task history sync failed', error instanceof Error ? error.message : String(error))
    })
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 2_500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [data.activeChatId, services, threadHistoryHydrated, toast])

  // Keep operational surfaces (Work, sidebar, search) current even when a
  // different task is open. Thread metadata is cheap to poll; message history
  // is fetched only for threads whose server-owned updatedAt changed.
  useEffect(() => {
    const threads = services?.threads
    if (!threads || persistenceStatus !== 'synced') return
    let cancelled = false
    let refreshing = false

    const refreshChangedThreads = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const durableThreads: DurableThread[] = []
        let cursor: string | undefined
        do {
          const page = await threads.list({ includeArchived: true, limit: 100, cursor })
          durableThreads.push(...page.threads)
          cursor = page.nextCursor
        } while (cursor && durableThreads.length < 2_000)
        if (cancelled) return

        const currentChats = new Map(dataRef.current.chats.map((chat) => [chat.id, chat]))
        const changedThreads = durableThreads.filter((thread) => {
          const current = currentChats.get(thread.id)
          return !current
            || current.updatedAt !== thread.updatedAt
            || Boolean(current.archived) !== Boolean(thread.archivedAt)
        })
        if (!changedThreads.length) return

        const changedMessages = (
          await Promise.all(changedThreads.map(async (thread) => {
            const items: DurableThreadMessage[] = []
            let messageCursor: string | undefined
            do {
              const page = await threads.messages(thread.id, { limit: 250, cursor: messageCursor })
              items.push(...page.messages)
              messageCursor = page.nextCursor
            } while (messageCursor && items.length < 10_000)
            return items
          }))
        ).flat()
        if (cancelled) return

        const changedIds = new Set(changedThreads.map((thread) => thread.id))
        const remoteChats = changedThreads.map<Chat>((thread) => ({
          id: thread.id,
          projectId: thread.projectId,
          title: thread.title,
          visibility: thread.visibility,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          branchedFromId: thread.branchedFromId,
          sharedWith: thread.sharedWith,
          archived: Boolean(thread.archivedAt),
          agentId: thread.agentId,
          runConfig: thread.runConfig as Chat['runConfig'],
          continuation: thread.continuation,
        }))
        const remoteMessages = changedMessages.map(messageFromDurable)
        setData((current) => {
          const currentById = new Map(current.messages.map((message) => [message.id, message]))
          return normalizeWorkspace({
            ...current,
            chats: [
              ...remoteChats,
              ...current.chats.filter((chat) => !changedIds.has(chat.id)),
            ],
            messages: [
              ...remoteMessages.map((message) => mergeRuntimeProjection(
                message,
                currentById.get(message.id),
              )),
              ...current.messages.filter((message) => !changedIds.has(message.chatId)),
            ],
          })
        })
      } finally {
        refreshing = false
      }
    }

    const timer = window.setInterval(() => {
      void refreshChangedThreads().catch(() => undefined)
    }, 3_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [persistenceStatus, services])

  useEffect(() => {
    if (!services?.workspace || !workspaceHydratedRef.current || persistenceStatus === 'needs_setup') return
    const sequence = ++saveSequenceRef.current
    setPersistenceStatus('syncing')
    const timer = window.setTimeout(() => {
      void services.workspace?.save(data).then((result) => {
        if (sequence !== saveSequenceRef.current) return
        setLastSavedAt(result.updatedAt)
        setPersistenceStatus('synced')
      }).catch((error: unknown) => {
        if (sequence !== saveSequenceRef.current) return
        setPersistenceStatus('error')
        toast('Database save failed', error instanceof Error ? error.message : String(error))
      })
    }, 450)
    return () => window.clearTimeout(timer)
    // `persistenceStatus` is intentionally not a dependency. Updating it to
    // "syncing" or "synced" must not schedule another save of unchanged data.
  }, [data, services, toast])

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const patch = useCallback((fn: (d: AppData) => AppData) => setData((d) => fn(structuredClone(d))), [])

  const rescanLocalProject = useCallback(async (projectId: string) => {
    if (!services?.localProjects) return null
    const manifest = await services.localProjects.rescan(projectId)
    setLocalProjectManifests((current) => ({ ...current, [projectId]: manifest }))
    return manifest
  }, [services])

  const threadPayload = useCallback((message: Message): Record<string, unknown> => ({
    ...(message.routingNote ? { routingNote: message.routingNote } : {}),
    ...(message.run ? { run: message.run } : {}),
    ...(message.lightHtml ? { lightHtml: message.lightHtml } : {}),
    ...(message.runtimeRunId ? { runtime_run_id: message.runtimeRunId } : {}),
  }), [])

  const reportThreadSyncError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('already_exists')) return
    toast('Task history sync failed', message)
  }, [toast])

  const api = useMemo<StoreApi>(() => ({
    data,
    toasts,
    dismissToast,
    toast,
    persistenceStatus,
    threadHistoryHydrated,
    lastSavedAt,
    connection,
    harnessCapabilities,
    refreshHarnessCapabilities,
    localProjectManifests,
    rescanLocalProject,
    connectToServer: async (profile) => {
      const baseUrl = profile.baseUrl.trim().replace(/\/$/, '')
      if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Server URL must start with http:// or https://')
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: profile.token ? { Authorization: `Bearer ${profile.token}` } : undefined,
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) throw new Error(`OpenSaddle server returned HTTP ${response.status}`)
      setPersistenceStatus('loading')
      workspaceHydratedRef.current = false
      durableHydratedServiceRef.current = null
      setServices(null)
      setConnection({ id: `remote-${baseUrl}`, name: profile.name.trim() || baseUrl, mode: 'remote', baseUrl, token: profile.token, allowMockFallback: false })
    },
    switchToDemo: () => {
      workspaceHydratedRef.current = false
      durableHydratedServiceRef.current = null
      setServices(null)
      setConnection(defaultConnectionProfile().mode === 'demo' ? defaultConnectionProfile() : {
        id: 'demo', name: 'Demo workspace', mode: 'demo', baseUrl: 'http://127.0.0.1:8765', allowMockFallback: true,
      })
    },
    initializeRemoteWorkspace: async () => {
      if (!services?.workspace || connection.mode !== 'remote') throw new Error('Connect to a remote server first')
      const result = await services.workspace.save(dataRef.current)
      workspaceHydratedRef.current = true
      setLastSavedAt(result.updatedAt)
      setPersistenceStatus('synced')
    },
    setTheme: (t) => patch((d) => { d.settings.theme = t; return d }),
    updateSettings: (s) => patch((d) => { d.settings = { ...d.settings, ...s, notifications: { ...d.settings.notifications, ...(s.notifications ?? {}) } }; return d }),
    setActiveProject: (id) => patch((d) => { d.activeProjectId = id; return d }),
    setActiveChat: (id) => patch((d) => {
      d.activeChatId = id
      if (id) d.recentChatIds = [id, ...d.recentChatIds.filter((x) => x !== id)].slice(0, 12)
      return d
    }),
    createChat: (projectId, title = 'New chat', agentId, continuation, activate = true) => {
      const chat: Chat = { id: uid('chat'), projectId, title, visibility: 'private', createdAt: Date.now(), updatedAt: Date.now(), sharedWith: [], agentId, continuation }
      patch((d) => {
        d.chats.unshift(chat)
        if (activate) {
          d.activeChatId = chat.id
          d.activeProjectId = projectId
        }
        d.recentChatIds = [chat.id, ...d.recentChatIds].slice(0, 12)
        return d
      })
      if (services?.threads) {
        const pending = services.threads.create({
          id: chat.id,
          projectId,
          title,
          visibility: chat.visibility,
          sharedWith: chat.sharedWith,
          agentId,
          continuation,
          runConfig: chat.runConfig,
        }).catch(reportThreadSyncError).finally(() => threadCreatePromisesRef.current.delete(chat.id))
        threadCreatePromisesRef.current.set(chat.id, pending)
      }
      return chat
    },
    adoptChatContinuation: (id, sessionId, checkpointId, provider) => {
      const targetChat = dataRef.current.chats.find((chat) => chat.id === id)
      const existing = targetChat?.continuation
      const project = targetChat ? dataRef.current.projects.find((candidate) => candidate.id === targetChat.projectId) : undefined
      if (existing?.sessionId === sessionId && existing.checkpointId === checkpointId && existing.mode === 'resume') return
      const continuation = adoptNativeContinuation({
        existing,
        sessionId,
        checkpointId,
        provider,
        sourcePath: project?.local?.rootPath ?? `project:${targetChat?.projectId ?? 'local'}`,
      })
      if (!continuation) return
      patch((d) => {
        const chat = d.chats.find((candidate) => candidate.id === id)
        if (chat) {
          chat.continuation = continuation
          chat.updatedAt = Date.now()
        }
        return d
      })
      if (services?.threads) {
        void (async () => {
          await threadCreatePromisesRef.current.get(id)
          await services.threads!.update(id, { continuation })
        })().catch(reportThreadSyncError)
      }
    },
    renameChat: (id, title) => {
      patch((d) => { const c = d.chats.find((x) => x.id === id); if (c) { c.title = title; c.updatedAt = Date.now() } return d })
      void services?.threads?.update(id, { title }).catch(reportThreadSyncError)
    },
    updateChatRunConfig: (id, runConfig) => {
      const current = data.chats.find((candidate) => candidate.id === id)?.runConfig
      if (JSON.stringify(current ?? null) === JSON.stringify(runConfig)) return
      patch((d) => {
        const chat = d.chats.find((candidate) => candidate.id === id)
        if (chat) {
          chat.runConfig = runConfig
          chat.updatedAt = Date.now()
        }
        return d
      })
      void services?.threads?.update(id, { runConfig }).catch(reportThreadSyncError)
    },
    deleteChat: (id) => {
      patch((d) => {
        d.chats = d.chats.filter((c) => c.id !== id)
        d.messages = d.messages.filter((m) => m.chatId !== id)
        d.recentChatIds = d.recentChatIds.filter((x) => x !== id)
        if (d.activeChatId === id) d.activeChatId = null
        return d
      })
      void services?.threads?.remove(id).catch(reportThreadSyncError)
    },
    archiveChat: (id) => {
      patch((d) => { const c = d.chats.find((x) => x.id === id); if (c) c.archived = true; return d })
      void services?.threads?.update(id, { archived: true }).catch(reportThreadSyncError)
    },
    setChatArchived: (id, archived) => {
      patch((d) => {
        const chat = d.chats.find((candidate) => candidate.id === id)
        if (chat) {
          chat.archived = archived
          chat.updatedAt = Date.now()
        }
        return d
      })
      void services?.threads?.update(id, { archived }).catch(reportThreadSyncError)
    },
    setChatVisibility: (id, visibility, sharedWith = []) => {
      patch((d) => {
        const c = d.chats.find((x) => x.id === id)
        if (c) { c.visibility = visibility; c.sharedWith = sharedWith; c.updatedAt = Date.now() }
        return d
      })
      void services?.threads?.update(id, { visibility, sharedWith }).catch(reportThreadSyncError)
    },
    branchChat: (id) => {
      const src = dataRef.current.chats.find((c) => c.id === id)
      if (!src) return null
      const created: Chat = {
        ...src,
        id: uid('chat'),
        title: `${src.title} (fork)`,
        branchedFromId: id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        visibility: 'private',
        sharedWith: [],
        continuation: src.continuation ? { ...src.continuation, mode: 'fork' } : undefined,
        runConfig: src.runConfig ? structuredClone(src.runConfig) : undefined,
      }
      const copied = dataRef.current.messages
        .filter((message) => message.chatId === id)
        .map((message) => ({ ...message, id: uid('msg'), chatId: created.id }))
      patch((d) => {
        d.chats.unshift(created)
        d.messages.push(...copied)
        d.activeChatId = created.id
        return d
      })
      if (services?.threads) {
        const pending = services.threads.create({
          id: created.id,
          projectId: created.projectId,
          title: created.title,
          visibility: created.visibility,
          sharedWith: created.sharedWith,
          agentId: created.agentId,
          continuation: created.continuation,
          runConfig: created.runConfig,
          branchedFromId: id,
        }).then(async () => {
          for (const message of copied) {
            await services.threads!.appendMessage(created.id, {
              id: message.id,
              role: message.role,
              text: message.text,
              payload: threadPayload(message),
            })
          }
        }).catch(reportThreadSyncError).finally(() => threadCreatePromisesRef.current.delete(created.id))
        threadCreatePromisesRef.current.set(created.id, pending)
      }
      return created
    },
    branchChatFromMessage: (chatId, messageId) => {
      const src = dataRef.current.chats.find((chat) => chat.id === chatId)
      const sourceMessages = dataRef.current.messages
        .filter((message) => message.chatId === chatId)
        .sort((left, right) => left.createdAt - right.createdAt)
      const targetIndex = sourceMessages.findIndex((message) => message.id === messageId)
      if (!src || targetIndex < 0) return null
      const providerCheckpoint = [...sourceMessages.slice(0, targetIndex + 1)]
        .reverse()
        .find((message) => message.run?.providerSessionId)
        ?.run
      const created: Chat = {
        ...src,
        id: uid('chat'),
        title: `${src.title} (branch)`,
        branchedFromId: chatId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        visibility: 'private',
        sharedWith: [],
        continuation: src.continuation ? {
          ...src.continuation,
          sessionId: providerCheckpoint?.providerSessionId ?? src.continuation.sessionId,
          checkpointId: providerCheckpoint?.providerTurnId,
          mode: 'fork',
        } : undefined,
        runConfig: src.runConfig ? structuredClone(src.runConfig) : undefined,
      }
      const copied = sourceMessages.slice(0, targetIndex + 1).map((message) => ({
        ...message,
        id: uid('msg'),
        chatId: created.id,
      }))
      patch((data) => {
        data.chats.unshift(created)
        data.messages.push(...copied)
        data.activeChatId = created.id
        data.recentChatIds = [created.id, ...data.recentChatIds.filter((id) => id !== created.id)].slice(0, 12)
        return data
      })
      if (services?.threads) {
        const pending = services.threads.create({
          id: created.id,
          projectId: created.projectId,
          title: created.title,
          visibility: created.visibility,
          sharedWith: created.sharedWith,
          agentId: created.agentId,
          continuation: created.continuation,
          runConfig: created.runConfig,
          branchedFromId: chatId,
        }).then(async () => {
          for (const message of copied) {
            await services.threads!.appendMessage(created.id, {
              id: message.id,
              role: message.role,
              text: message.text,
              payload: threadPayload(message),
            })
          }
        }).catch(reportThreadSyncError).finally(() => threadCreatePromisesRef.current.delete(created.id))
        threadCreatePromisesRef.current.set(created.id, pending)
      }
      return created
    },
    appendMessage: (msg, options) => {
      const full: Message = { ...msg, id: msg.id ?? uid('msg'), createdAt: Date.now() }
      // Make the optimistic message immediately available to follow-up
      // updateMessage calls. A runtime can start emitting before React has
      // committed the append into dataRef.
      messageSyncSnapshotsRef.current.set(full.id, full)
      patch((d) => {
        d.messages.push(full)
        const c = d.chats.find((x) => x.id === full.chatId)
        if (c) {
          c.updatedAt = Date.now()
          if (full.role === 'user' && (c.title === 'New chat' || !c.title)) c.title = full.text.slice(0, 48)
        }
        return d
      })
      if (services?.threads && options?.persist !== false) {
        const prior = threadMessageTailRef.current.get(full.chatId) ?? Promise.resolve()
        const pending = prior.catch(() => undefined).then(async () => {
          await threadCreatePromisesRef.current.get(full.chatId)
          return await services.threads!.appendMessage(full.chatId, {
            id: full.id,
            role: full.role,
            text: full.text,
            payload: threadPayload(full),
          })
        }).catch(reportThreadSyncError).finally(() => {
          messageCreatePromisesRef.current.delete(full.id)
          if (threadMessageTailRef.current.get(full.chatId) === pending) {
            threadMessageTailRef.current.delete(full.chatId)
          }
        })
        messageCreatePromisesRef.current.set(full.id, pending)
        threadMessageTailRef.current.set(full.chatId, pending)
      }
      window.setTimeout(() => {
        if (
          !messageSyncTimersRef.current.has(full.id)
          && messageSyncSnapshotsRef.current.get(full.id) === full
        ) {
          messageSyncSnapshotsRef.current.delete(full.id)
        }
      }, 5_000)
      return full
    },
    updateMessage: (id, p) => {
      // Runtime events can arrive faster than React commits dataRef. Merge
      // against the most recently queued durable snapshot so a later status
      // event cannot persist stale/empty text over an earlier streamed delta.
      const current = messageSyncSnapshotsRef.current.get(id)
        ?? dataRef.current.messages.find((message) => message.id === id)
      const next = current ? { ...current, ...p } : undefined
      if (next) messageSyncSnapshotsRef.current.set(id, next)
      patch((d) => {
        const i = d.messages.findIndex((m) => m.id === id)
        if (i >= 0) d.messages[i] = { ...d.messages[i], ...p }
        return d
      })
      // Assistant/system messages are projections of the authoritative run
      // stream. The server writes their durable content when a run completes;
      // only user-authored messages may be edited through the thread PATCH
      // endpoint. Keeping run-card updates renderer-local also prevents a
      // refresh reconciliation from attempting to mutate server-authored
      // history and producing noisy 422 responses.
      if (services?.threads && next?.role === 'user') {
        window.clearTimeout(messageSyncTimersRef.current.get(id))
        messageSyncTimersRef.current.set(id, window.setTimeout(() => {
          messageSyncTimersRef.current.delete(id)
          void (async () => {
            await messageCreatePromisesRef.current.get(id)
            const snapshot = messageSyncSnapshotsRef.current.get(id) ?? next
            await services.threads!.updateMessage(snapshot.chatId, id, {
              text: snapshot.text,
              payload: threadPayload(snapshot),
            })
            if (messageSyncSnapshotsRef.current.get(id) === snapshot) {
              messageSyncSnapshotsRef.current.delete(id)
            }
          })().catch(reportThreadSyncError)
        }, 180))
      }
    },
    createProject: (name, parentId, description) => {
      const id = uid('proj')
      patch((d) => {
        const parent = d.projects.find((p) => p.id === parentId)
        d.projects.push({
          id, name, parentId, description, iconColor: '#80a9ff', knowledgeCount: 0, serviceCount: 0, childCount: 0, autoConfidence: 80,
          lineage: parent ? [...parent.lineage, name] : ['Organization', name], workspaceKind: 'enterprise',
        })
        if (parent) parent.childCount += 1
        d.activeProjectId = id
        return d
      })
      return id
    },
    importLocalProject: ({ name, description, local }) => {
      const id = uid('local')
      patch((d) => {
        d.projects.push({
          id,
          name,
          parentId: null,
          description,
          iconColor: '#d6af63',
          knowledgeCount: local.documents.length,
          serviceCount: local.harnesses.length,
          childCount: 0,
          autoConfidence: 100,
          lineage: ['Local projects', name],
          workspaceKind: 'local',
          local,
          routingDefaults: {
            modelKey: 'auto',
            providerKey: ['codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity', 'opensaddle'].includes(local.defaultHarnessId)
              ? local.defaultHarnessId as CodingProvider
              : 'custom',
            runtimeKey: 'local',
          },
        })
        d.permissionGrants.push(
          {
            id: uid('grant'),
            principalKind: 'user',
            principalId: d.currentUserId,
            resourceKind: 'project',
            resourceId: id,
            action: 'administer',
            effect: 'allow',
            inheritance: 'direct',
            createdAt: Date.now(),
            createdBy: d.currentUserId,
          },
          {
            id: uid('grant'),
            principalKind: 'user',
            principalId: d.currentUserId,
            resourceKind: 'project',
            resourceId: id,
            action: 'execute',
            effect: 'allow',
            inheritance: 'direct',
            createdAt: Date.now(),
            createdBy: d.currentUserId,
          },
        )
        d.activeProjectId = id
        return d
      })
      return id
    },
    updateProject: (id, projectPatch) => patch((d) => {
      const project = d.projects.find((item) => item.id === id)
      if (project) Object.assign(project, projectPatch)
      return d
    }),
    setPinnedArtifacts: (items) => patch((d) => {
      d.pinnedArtifacts = items
      return d
    }),
    createAgent: (input) => {
      const agent: CustomAgent = { ...input, id: uid('agent'), createdAt: Date.now() }
      patch((d) => { d.agents.unshift(agent); return d })
      return agent
    },
    updateAgent: (id, agentPatch) => patch((d) => {
      const agent = d.agents.find((item) => item.id === id)
      if (agent) Object.assign(agent, agentPatch)
      return d
    }),
    deleteAgent: (id) => patch((d) => {
      d.agents = d.agents.filter((agent) => agent.id !== id)
      d.permissionGrants = d.permissionGrants.filter((grant) =>
        !(grant.principalKind === 'agent' && grant.principalId === id))
      return d
    }),
    createSite: (input) => {
      const slug = input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      const site: Site = {
        ...input,
        id: uid('site'),
        slug,
        accent: input.accent ?? '#80a9ff',
        versions: [],
        agentPlacement: input.agentPlacement ?? 'bubble',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      const firstVersion: SiteVersion = {
        id: uid('sv'), label: 'v1', summary: 'Initial version', status: 'draft', createdAt: Date.now(), createdBy: data.currentUserId,
        snapshot: {
          name: site.name,
          description: site.description,
          accent: site.accent,
          pages: structuredClone(site.pages),
          agentId: site.agentId,
          agentPlacement: site.agentPlacement,
        },
      }
      site.versions = [firstVersion]
      patch((d) => { d.sites.unshift(site); return d })
      return site
    },
    createSiteVersion: (siteId, label, summary) => {
      const s = dataRef.current.sites.find((x) => x.id === siteId)
      if (!s) return null
      const version: SiteVersion = {
        id: uid('sv'), label, summary, status: 'draft', createdAt: Date.now(), createdBy: data.currentUserId,
        snapshot: {
          name: s.name,
          description: s.description,
          accent: s.accent,
          pages: structuredClone(s.pages),
          agentId: s.agentId,
          agentPlacement: s.agentPlacement,
        },
      }
      patch((d) => {
        const target = d.sites.find((x) => x.id === siteId)
        if (!target) return d
        target.versions.unshift(version)
        target.updatedAt = Date.now()
        return d
      })
      return version
    },
    publishSiteVersion: (siteId, versionId) => patch((d) => {
      const s = d.sites.find((x) => x.id === siteId)
      if (!s) return d
      for (const v of s.versions) {
        if (v.id === versionId) v.status = 'published'
        else if (v.status === 'published') v.status = 'archived'
      }
      s.publishedVersionId = versionId
      s.updatedAt = Date.now()
      return d
    }),
    updateSite: (siteId, sitePatch) => patch((d) => {
      const s = d.sites.find((x) => x.id === siteId)
      if (s) {
        Object.assign(s, sitePatch)
        s.updatedAt = Date.now()
        const currentDraft = s.versions.find((version) => version.status === 'draft')
        if (currentDraft) {
          currentDraft.snapshot = {
            name: s.name,
            description: s.description,
            accent: s.accent,
            pages: structuredClone(s.pages),
            agentId: s.agentId,
            agentPlacement: s.agentPlacement,
          }
        }
      }
      return d
    }),
    switchUser: (userId) => patch((d) => {
      const member = d.members.find((m) => m.id === userId)
      if (!member) return d
      d.currentUserId = member.id
      d.settings.displayName = member.name
      d.settings.email = member.email
      return d
    }),
    createApi: (input) => {
      const apiItem: QuickApi = { ...input, id: uid('api'), createdAt: Date.now(), records: input.records ?? [], runHistory: [] }
      patch((d) => { d.apis.unshift(apiItem); return d })
      return apiItem
    },
    mutateApi: (id, action, payload) => patch((d) => {
      const apiItem = d.apis.find((a) => a.id === id)
      if (!apiItem) return d
      if (action === 'POST' && payload) {
        apiItem.records.push({ id: uid('rec'), data: payload })
        apiItem.runHistory.unshift({ at: Date.now(), action, detail: `Inserted ${payload.account ?? 'record'}` })
      } else if (action === 'DELETE' && payload?.id) {
        apiItem.records = apiItem.records.filter((r) => r.id !== payload.id)
        apiItem.runHistory.unshift({ at: Date.now(), action, detail: `Deleted ${payload.id}` })
      } else if (action === 'TRANSFORM') {
        apiItem.records = apiItem.records.map((r) => ({
          ...r,
          data: Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, typeof v === 'string' ? v.toUpperCase() : v])),
        }))
        apiItem.runHistory.unshift({ at: Date.now(), action, detail: 'Ran transform script (mock)' })
      } else {
        apiItem.runHistory.unshift({ at: Date.now(), action, detail: `Listed ${apiItem.records.length} records` })
      }
      return d
    }),
    createDashboard: (input) => {
      const dash: Dashboard = { ...input, id: uid('dash'), createdAt: Date.now() }
      patch((d) => { d.dashboards.unshift(dash); return d })
      return dash
    },
    createInterface: (input) => {
      const iface: AgentInterface = { ...input, id: uid('iface'), createdAt: Date.now() }
      patch((d) => { d.interfaces.unshift(iface); return d })
      return iface
    },
    togglePlugin: (id) => patch((d) => {
      const p = d.plugins.find((x) => x.id === id)
      if (p) p.installed = !p.installed
      return d
    }),
    markNotificationsRead: () => patch((d) => { d.notifications.forEach((n) => { n.read = true }); return d }),
    updateTaskStatus: (id, status) => patch((d) => { const t = d.tasks.find((x) => x.id === id); if (t) t.status = status; return d }),
    updateEnvironmentStatus: (id, status) => patch((d) => { const e = d.environments.find((x) => x.id === id); if (e) e.status = status; return d }),
    requestSecureVm: (input) => {
      const environmentId = uid('env')
      const taskId = uid('task')
      const shortTask = input.task.trim().replace(/\s+/g, ' ').slice(0, 56) || 'Background task'
      const projectName = dataRef.current.projects.find((project) => project.id === input.projectId)?.name ?? 'Project'
      patch((d) => {
        d.environments.unshift({
          id: environmentId,
          name: `Secure VM · ${shortTask}`,
          subtitle: `${projectName} · isolated ephemeral workspace`,
          kind: 'sandbox',
          status: 'Provisioning',
          os: 'Hardened Ubuntu 22.04',
          cpu: input.cpu,
          network: input.network,
          secrets: 'Short-lived vault refs',
          packages: ['hardened image', 'node 20', 'git', 'audit agent'],
          idleTimeout: input.idleTimeout,
          cost: '$0.34 / hr · budget capped',
          mounts: 'project workspace (ephemeral)',
          region: 'us-east-1',
          taskId,
        })
        d.tasks.unshift({
          id: taskId,
          projectId: input.projectId,
          name: shortTask,
          type: 'background',
          schedule: 'Queued · provisioning secure VM',
          harness: 'Secure VM agent',
          status: 'queued',
          progress: 0,
          timeline: [
            { time: 'now', title: 'Request accepted', detail: 'Policy, budget, and network controls applied', kind: 'info' },
            { time: 'now', title: 'VM provisioning', detail: `${input.cpu} · ${input.network}` },
          ],
        })
        return d
      })
      window.setTimeout(() => patch((d) => {
        const environment = d.environments.find((item) => item.id === environmentId)
        const task = d.tasks.find((item) => item.id === taskId)
        if (environment?.status === 'Provisioning') environment.status = 'Running'
        if (task?.status === 'queued') {
          task.status = 'running'
          task.progress = 12
          task.schedule = 'Running in secure VM'
          task.timeline?.push({ time: 'now', title: 'VM ready', detail: 'Ephemeral workspace encrypted and attached', kind: 'info' })
        }
        return d
      }), 700)
      return { environmentId, taskId }
    },
    updateWikiSettings: (settings) => patch((d) => {
      d.wikiSettings = { ...d.wikiSettings, ...settings }
      return d
    }),
    refreshWikiSummaries: (projectId) => patch((d) => {
      const refreshedAt = Date.now()
      for (const summary of d.wikiSummaries) {
        if (summary.projectId === projectId) summary.updatedAt = refreshedAt
      }
      return d
    }),
    setPermissionGrants: (grants) => patch((d) => { d.permissionGrants = grants; return d }),
    upsertPermissionGrant: async (grant) => {
      const next = services
        ? await services.permissions.upsert(grant)
        : { ...grant, id: grant.id ?? uid('grant'), createdAt: Date.now() }
      patch((d) => {
        const idx = d.permissionGrants.findIndex((g) => g.id === next.id)
        if (idx >= 0) d.permissionGrants[idx] = next
        else d.permissionGrants.push(next)
        return d
      })
      return next
    },
    consumePermissionGrant: async (id) => {
      const consumed = services
        ? await services.permissions.consume(id)
        : (() => {
          const current = dataRef.current.permissionGrants.find((grant) => grant.id === id)
          if (!current || current.usesRemaining === undefined || current.usesRemaining <= 0) {
            throw new Error('Permission grant is not consumable')
          }
          return { ...current, usesRemaining: current.usesRemaining - 1, consumedAt: Date.now() }
        })()
      patch((d) => {
        const index = d.permissionGrants.findIndex((grant) => grant.id === consumed.id)
        if (index >= 0) d.permissionGrants[index] = consumed
        return d
      })
      return consumed
    },
    revokePermissionGrant: async (id) => {
      if (services) await services.permissions.revoke(id)
      patch((d) => { d.permissionGrants = d.permissionGrants.filter((g) => g.id !== id); return d })
    },
    createWorkflow: (input) => {
      const wf: WorkflowDef = { ...input, id: uid('wf'), createdAt: Date.now() }
      patch((d) => { d.workflows.unshift(wf); return d })
      return wf
    },
    updateWorkflowStatus: (id, status) => patch((d) => {
      const wf = d.workflows.find((w) => w.id === id)
      if (wf) wf.status = status
      return d
    }),
    runWorkflow: async (id) => {
      const wf = data.workflows.find((w) => w.id === id)
      if (!wf) {
        toast('Missing workflow', id)
        return null
      }
      const agentId = wf.agentIds[0]
      const check = evaluatePermissions(data.permissionGrants, {
        userId: data.currentUserId,
        agentId,
        resourceKind: 'project',
        resourceId: wf.projectId,
        action: 'execute',
      })
      if (!check.allowed) {
        toast('Blocked', check.reason)
        return null
      }
      if (wf.approvalRequired && check.approvalRequired) {
        toast('Approval required', `Confirm ${wf.name} before continuing`)
        return null
      }

      const run: WorkflowRun = {
        id: uid('wfr'),
        workflowId: wf.id,
        projectId: wf.projectId,
        ownerId: data.currentUserId,
        agentId,
        status: 'running',
        startedAt: Date.now(),
        summary: `Running ${wf.steps.map((s) => s.label).join(' → ')}`,
      }
      patch((d) => {
        d.workflowRuns.unshift(run)
        const target = d.workflows.find((w) => w.id === wf.id)
        if (target) target.lastRunAt = run.startedAt
        return d
      })

      try {
        if (services?.runtime && agentId) {
          const agent = data.agents.find((a) => a.id === agentId)
          const started = await services.runtime.startRun({
            projectId: wf.projectId,
            task: `Workflow ${wf.name}: ${wf.description}`,
            agentId,
            modelKey: agent?.modelPolicy === 'claude' ? 'claude' : undefined,
            harnessKey: agent?.harness,
            runtimeKey: agent?.runtime,
          })
          await new Promise<void>((resolve) => {
            const stop = services.runtime.subscribe(started.runId, (event) => {
              if (event.type === 'agent.completed' || event.type === 'agent.failed' || event.type === 'session.closed') {
                stop()
                resolve()
              }
            })
            window.setTimeout(() => { stop(); resolve() }, 20_000)
          })
        } else {
          await new Promise((r) => window.setTimeout(r, 900))
        }
        const finished: WorkflowRun = {
          ...run,
          status: 'completed',
          finishedAt: Date.now(),
          summary: `Completed ${wf.steps.length} steps · ${wf.name}`,
        }
        patch((d) => {
          const row = d.workflowRuns.find((r) => r.id === run.id)
          if (row) {
            row.status = finished.status
            row.finishedAt = finished.finishedAt
            row.summary = finished.summary
          }
          return d
        })
        toast('Workflow finished', wf.name)
        return finished
      } catch (err) {
        patch((d) => {
          const row = d.workflowRuns.find((r) => r.id === run.id)
          if (row) {
            row.status = 'failed'
            row.finishedAt = Date.now()
            row.summary = String(err)
          }
          return d
        })
        toast('Workflow failed', String(err))
        return null
      }
    },
    attachSource: (input) => {
      const source: ProjectSource = { ...input, id: uid('src'), lastSyncAt: Date.now() }
      patch((d) => { d.sources.unshift(source); return d })
      return source
    },
    updateSource: (id, sourcePatch) => patch((data) => {
      const source = data.sources.find((item) => item.id === id)
      if (source) {
        Object.assign(source, sourcePatch)
        source.lastSyncAt = Date.now()
      }
      return data
    }),
    updateHunk: (messageId, hunkId, status) => patch((d) => {
      const m = d.messages.find((x) => x.id === messageId)
      const files = m?.run?.artifacts?.flatMap((a) => a.diff ?? []) ?? []
      for (const f of files) for (const h of f.hunks) if (h.id === hunkId) h.status = status
      return d
    }),
    resetData: () => {
      resetServices()
      captureWorkspaceRecovery(localStorage, STORAGE_KEY, JSON.stringify(data), 'Snapshot before reset to seed')
      setWorkspaceRecoveries(listWorkspaceRecoveries())
      const seed = createSeedData()
      setData(seed)
      toast('Data reset', 'Demo workspace restored from seed. The previous workspace is available in recovery.')
    },
    exportData: () => JSON.stringify(data, null, 2),
    workspaceRecoveries,
    restoreWorkspaceRecovery: (id) => {
      const recovery = workspaceRecoveries.find((item) => item.id === id)
      if (!recovery) return
      try {
        captureWorkspaceRecovery(localStorage, STORAGE_KEY, JSON.stringify(data), 'Snapshot before manual restore')
        const restored = readWorkspaceRecovery(recovery)
        setData(restored)
        setWorkspaceRecoveries(listWorkspaceRecoveries())
        toast('Workspace restored', `Recovered the snapshot from ${new Date(recovery.createdAt).toLocaleString()}.`)
      } catch (error) {
        toast('Restore failed', error instanceof Error ? error.message : String(error))
      }
    },
    discardWorkspaceRecovery: (id) => {
      const recovery = workspaceRecoveries.find((item) => item.id === id)
      if (!recovery) return
      setWorkspaceRecoveries(deleteWorkspaceRecovery(recovery))
      toast('Recovery removed', 'The preserved snapshot was deleted.')
    },
    services,
    runtimeModeLabel: modeLabel(detectRuntimeMode()),
  }), [data, toast, toasts, dismissToast, patch, services, persistenceStatus, threadHistoryHydrated, lastSavedAt, connection, harnessCapabilities, refreshHarnessCapabilities, localProjectManifests, rescanLocalProject, threadPayload, reportThreadSyncError, workspaceRecoveries])

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
