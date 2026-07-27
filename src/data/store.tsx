import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AgentInterface, AppData, Chat, CodingProvider, CustomAgent, Dashboard, LocalProjectSettings, Message, PermissionGrant, PinnedArtifact, Project, ProjectSource, QuickApi, SettingsState, Site, SiteVersion, Theme, Visibility, WikiSettings, WorkflowDef, WorkflowRun,
} from '../types'
import { createSeedData, DATA_VERSION, STORAGE_KEY } from './seed'
import { defaultConnectionProfile, initServices, resetServices, type ConnectionProfile, type ServiceBundle } from '../services'
import { detectRuntimeMode, modeLabel } from '../services/capabilities'
import { evaluatePermissions } from '../services/permissions'

function normalizeWorkspace(data: AppData): AppData {
  data.pinnedArtifacts ??= []
  for (const project of data.projects) {
    project.workspaceKind ??= project.local ? 'local' : 'enterprise'
    if (project.local) {
      project.local.harnesses ??= []
      project.local.skills ??= []
      project.local.documents ??= []
      project.local.detectedConfigs ??= []
      project.local.defaultHarnessId ??= 'codex'
      project.local.permissionPreset ??= 'workspace-write'
      project.local.adminAccess = true
    }
  }
  const codingProject = data.projects.find((project) => project.id === 'proj-coding')
  if (codingProject && !codingProject.routingDefaults) {
    codingProject.routingDefaults = {
      providerKey: 'codex',
      modelKey: 'sonnet',
      runtimeKey: 'sandbox',
      reviewProviderKey: 'claude',
    }
  }
  return data
}

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return normalizeWorkspace(createSeedData())
    const parsed = JSON.parse(raw) as AppData
    if (parsed.version !== DATA_VERSION) return normalizeWorkspace(createSeedData())
    return normalizeWorkspace(parsed)
  } catch {
    return normalizeWorkspace(createSeedData())
  }
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

interface StoreApi {
  data: AppData
  setTheme: (t: Theme) => void
  updateSettings: (patch: Partial<SettingsState>) => void
  setActiveProject: (id: string) => void
  setActiveChat: (id: string | null) => void
  createChat: (projectId: string, title?: string, agentId?: string) => Chat
  renameChat: (id: string, title: string) => void
  deleteChat: (id: string) => void
  archiveChat: (id: string) => void
  setChatVisibility: (id: string, visibility: Visibility, sharedWith?: string[]) => void
  branchChat: (id: string) => Chat | null
  branchChatFromMessage: (chatId: string, messageId: string) => Chat | null
  appendMessage: (msg: Omit<Message, 'id' | 'createdAt'> & { id?: string }) => Message
  updateMessage: (id: string, patch: Partial<Message>) => void
  createProject: (name: string, parentId: string | null, description: string) => string
  importLocalProject: (input: { name: string; description: string; local: LocalProjectSettings }) => string
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'routingDefaults' | 'workspaceKind' | 'local'>>) => void
  setPinnedArtifacts: (items: PinnedArtifact[]) => void
  createAgent: (input: Omit<CustomAgent, 'id' | 'createdAt'>) => CustomAgent
  updateAgent: (id: string, patch: Partial<Omit<CustomAgent, 'id' | 'projectId' | 'createdAt'>>) => void
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
  runtimeModeLabel: string
  persistenceStatus: 'local' | 'loading' | 'syncing' | 'synced' | 'needs_setup' | 'error'
  lastSavedAt: number | null
  connection: ConnectionProfile
  connectToServer: (profile: Pick<ConnectionProfile, 'name' | 'baseUrl' | 'token'>) => Promise<void>
  switchToDemo: () => void
  initializeRemoteWorkspace: () => Promise<void>
}

const StoreContext = createContext<StoreApi | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => load())
  const [toasts, setToasts] = useState<Array<{ id: string; title: string; message: string }>>([])
  const [services, setServices] = useState<ServiceBundle | null>(null)
  const [persistenceStatus, setPersistenceStatus] = useState<StoreApi['persistenceStatus']>('loading')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [connection, setConnection] = useState<ConnectionProfile>(() => defaultConnectionProfile())
  const grantsRef = useRef(data.permissionGrants)
  const currentUserRef = useRef(data.currentUserId)
  const dataRef = useRef(data)
  const workspaceHydratedRef = useRef(false)
  const saveSequenceRef = useRef(0)
  grantsRef.current = data.permissionGrants
  currentUserRef.current = data.currentUserId
  dataRef.current = data

  const toast = useCallback((title: string, message: string) => {
    const id = uid('toast')
    setToasts((t) => [...t, { id, title, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600)
  }, [])

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

  const api = useMemo<StoreApi>(() => ({
    data,
    toasts,
    dismissToast,
    toast,
    persistenceStatus,
    lastSavedAt,
    connection,
    connectToServer: async (profile) => {
      const baseUrl = profile.baseUrl.trim().replace(/\/$/, '')
      if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Server URL must start with http:// or https://')
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: {
          ...(profile.token ? { Authorization: `Bearer ${profile.token}` } : {}),
          'X-OpenSaddle-User': currentUserRef.current,
        },
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) throw new Error(`OpenSaddle server returned HTTP ${response.status}`)
      setPersistenceStatus('loading')
      workspaceHydratedRef.current = false
      setServices(null)
      setConnection({ id: `remote-${baseUrl}`, name: profile.name.trim() || baseUrl, mode: 'remote', baseUrl, token: profile.token, allowMockFallback: false })
    },
    switchToDemo: () => {
      workspaceHydratedRef.current = false
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
    createChat: (projectId, title = 'New chat', agentId) => {
      const chat: Chat = { id: uid('chat'), projectId, title, visibility: 'private', createdAt: Date.now(), updatedAt: Date.now(), sharedWith: [], agentId }
      patch((d) => { d.chats.unshift(chat); d.activeChatId = chat.id; d.activeProjectId = projectId; d.recentChatIds = [chat.id, ...d.recentChatIds].slice(0, 12); return d })
      return chat
    },
    renameChat: (id, title) => patch((d) => { const c = d.chats.find((x) => x.id === id); if (c) { c.title = title; c.updatedAt = Date.now() } return d }),
    deleteChat: (id) => patch((d) => {
      d.chats = d.chats.filter((c) => c.id !== id)
      d.messages = d.messages.filter((m) => m.chatId !== id)
      d.recentChatIds = d.recentChatIds.filter((x) => x !== id)
      if (d.activeChatId === id) d.activeChatId = null
      return d
    }),
    archiveChat: (id) => patch((d) => { const c = d.chats.find((x) => x.id === id); if (c) c.archived = true; return d }),
    setChatVisibility: (id, visibility, sharedWith = []) => patch((d) => {
      const c = d.chats.find((x) => x.id === id)
      if (c) { c.visibility = visibility; c.sharedWith = sharedWith; c.updatedAt = Date.now() }
      return d
    }),
    branchChat: (id) => {
      const src = dataRef.current.chats.find((c) => c.id === id)
      if (!src) return null
      const created: Chat = { ...src, id: uid('chat'), title: `${src.title} (fork)`, branchedFromId: id, createdAt: Date.now(), updatedAt: Date.now(), visibility: 'private', sharedWith: [] }
      patch((d) => {
        d.chats.unshift(created)
        const msgs = d.messages.filter((m) => m.chatId === id).map((m) => ({ ...m, id: uid('msg'), chatId: created.id }))
        d.messages.push(...msgs)
        d.activeChatId = created.id
        return d
      })
      return created
    },
    branchChatFromMessage: (chatId, messageId) => {
      const src = dataRef.current.chats.find((chat) => chat.id === chatId)
      const sourceMessages = dataRef.current.messages
        .filter((message) => message.chatId === chatId)
        .sort((left, right) => left.createdAt - right.createdAt)
      const targetIndex = sourceMessages.findIndex((message) => message.id === messageId)
      if (!src || targetIndex < 0) return null
      const created: Chat = {
        ...src,
        id: uid('chat'),
        title: `${src.title} (branch)`,
        branchedFromId: chatId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        visibility: 'private',
        sharedWith: [],
      }
      patch((data) => {
        data.chats.unshift(created)
        data.messages.push(...sourceMessages.slice(0, targetIndex + 1).map((message) => ({
          ...message,
          id: uid('msg'),
          chatId: created.id,
        })))
        data.activeChatId = created.id
        data.recentChatIds = [created.id, ...data.recentChatIds.filter((id) => id !== created.id)].slice(0, 12)
        return data
      })
      return created
    },
    appendMessage: (msg) => {
      const full: Message = { ...msg, id: msg.id ?? uid('msg'), createdAt: Date.now() }
      patch((d) => {
        d.messages.push(full)
        const c = d.chats.find((x) => x.id === full.chatId)
        if (c) {
          c.updatedAt = Date.now()
          if (full.role === 'user' && (c.title === 'New chat' || !c.title)) c.title = full.text.slice(0, 48)
        }
        return d
      })
      return full
    },
    updateMessage: (id, p) => patch((d) => {
      const i = d.messages.findIndex((m) => m.id === id)
      if (i >= 0) d.messages[i] = { ...d.messages[i], ...p }
      return d
    }),
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
      const seed = createSeedData()
      setData(seed)
      toast('Data reset', 'Demo workspace restored from seed.')
    },
    exportData: () => JSON.stringify(data, null, 2),
    services,
    runtimeModeLabel: modeLabel(detectRuntimeMode()),
  }), [data, toast, toasts, dismissToast, patch, services, persistenceStatus, lastSavedAt, connection])

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
