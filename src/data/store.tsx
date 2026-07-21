import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AgentInterface, AppData, Chat, CustomAgent, Dashboard, Message, PermissionGrant, ProjectSource, QuickApi, SettingsState, Site, Theme, Visibility, WikiSettings, WorkflowDef,
} from '../types'
import { createSeedData, DATA_VERSION, STORAGE_KEY } from './seed'
import { initServices, resetServices, type ServiceBundle } from '../services'
import { detectRuntimeMode, modeLabel } from '../services/capabilities'

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeedData()
    const parsed = JSON.parse(raw) as AppData
    if (parsed.version !== DATA_VERSION) return createSeedData()
    return parsed
  } catch {
    return createSeedData()
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
  branchChat: (id: string) => Chat
  appendMessage: (msg: Omit<Message, 'id' | 'createdAt'> & { id?: string }) => Message
  updateMessage: (id: string, patch: Partial<Message>) => void
  createProject: (name: string, parentId: string | null, description: string) => string
  createAgent: (input: Omit<CustomAgent, 'id' | 'createdAt'>) => CustomAgent
  createSite: (input: Omit<Site, 'id' | 'createdAt'>) => Site
  createApi: (input: Omit<QuickApi, 'id' | 'createdAt' | 'runHistory' | 'records'> & { records?: QuickApi['records'] }) => QuickApi
  mutateApi: (id: string, action: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'TRANSFORM', payload?: Record<string, string | number | boolean>) => void
  createDashboard: (input: Omit<Dashboard, 'id' | 'createdAt'>) => Dashboard
  createInterface: (input: Omit<AgentInterface, 'id' | 'createdAt'>) => AgentInterface
  togglePlugin: (id: string) => void
  markNotificationsRead: () => void
  updateTaskStatus: (id: string, status: AppData['tasks'][0]['status']) => void
  updateEnvironmentStatus: (id: string, status: AppData['environments'][0]['status']) => void
  updateWikiSettings: (patch: Partial<WikiSettings>) => void
  refreshWikiSummaries: (projectId: string) => void
  setPermissionGrants: (grants: PermissionGrant[]) => void
  upsertPermissionGrant: (grant: Omit<PermissionGrant, 'id' | 'createdAt'> & { id?: string }) => PermissionGrant
  revokePermissionGrant: (id: string) => void
  createWorkflow: (input: Omit<WorkflowDef, 'id' | 'createdAt'>) => WorkflowDef
  updateWorkflowStatus: (id: string, status: WorkflowDef['status']) => void
  attachSource: (input: Omit<ProjectSource, 'id' | 'lastSyncAt'>) => ProjectSource
  updateHunk: (messageId: string, hunkId: string, status: 'accepted' | 'rejected') => void
  resetData: () => void
  exportData: () => string
  toast: (title: string, message: string) => void
  toasts: Array<{ id: string; title: string; message: string }>
  dismissToast: (id: string) => void
  services: ServiceBundle | null
  runtimeModeLabel: string
}

const StoreContext = createContext<StoreApi | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => load())
  const [toasts, setToasts] = useState<Array<{ id: string; title: string; message: string }>>([])
  const [services, setServices] = useState<ServiceBundle | null>(null)
  const grantsRef = useRef(data.permissionGrants)
  grantsRef.current = data.permissionGrants

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

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
    }).then((bundle) => {
      if (!cancelled) setServices(bundle)
    })
    return () => { cancelled = true }
  }, [data.currentUserId])

  const toast = useCallback((title: string, message: string) => {
    const id = uid('toast')
    setToasts((t) => [...t, { id, title, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600)
  }, [])

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const patch = useCallback((fn: (d: AppData) => AppData) => setData((d) => fn(structuredClone(d))), [])

  const api = useMemo<StoreApi>(() => ({
    data,
    toasts,
    dismissToast,
    toast,
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
      let created!: Chat
      patch((d) => {
        const src = d.chats.find((c) => c.id === id)
        if (!src) return d
        created = { ...src, id: uid('chat'), title: `${src.title} (fork)`, branchedFromId: id, createdAt: Date.now(), updatedAt: Date.now(), visibility: 'private', sharedWith: [] }
        d.chats.unshift(created)
        const msgs = d.messages.filter((m) => m.chatId === id).map((m) => ({ ...m, id: uid('msg'), chatId: created.id }))
        d.messages.push(...msgs)
        d.activeChatId = created.id
        return d
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
          lineage: parent ? [...parent.lineage, name] : ['Organization', name],
        })
        if (parent) parent.childCount += 1
        d.activeProjectId = id
        return d
      })
      return id
    },
    createAgent: (input) => {
      const agent: CustomAgent = { ...input, id: uid('agent'), createdAt: Date.now() }
      patch((d) => { d.agents.unshift(agent); return d })
      return agent
    },
    createSite: (input) => {
      const site: Site = { ...input, id: uid('site'), createdAt: Date.now() }
      patch((d) => { d.sites.unshift(site); return d })
      return site
    },
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
    upsertPermissionGrant: (grant) => {
      const next: PermissionGrant = { ...grant, id: grant.id ?? uid('grant'), createdAt: Date.now() }
      patch((d) => {
        const idx = d.permissionGrants.findIndex((g) => g.id === next.id)
        if (idx >= 0) d.permissionGrants[idx] = next
        else d.permissionGrants.push(next)
        return d
      })
      return next
    },
    revokePermissionGrant: (id) => patch((d) => { d.permissionGrants = d.permissionGrants.filter((g) => g.id !== id); return d }),
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
    attachSource: (input) => {
      const source: ProjectSource = { ...input, id: uid('src'), lastSyncAt: Date.now() }
      patch((d) => { d.sources.unshift(source); return d })
      return source
    },
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
  }), [data, toast, toasts, dismissToast, patch, services])

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
