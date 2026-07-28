import type { AppData } from '../types'
import { createSeedData, DATA_VERSION, STORAGE_KEY } from './seed'

const RECOVERY_INDEX_KEY = 'opensaddle-recovery-index-v1'
const LEGACY_STORAGE_KEYS = Array.from(
  { length: Math.max(0, DATA_VERSION - 1) },
  (_, index) => `opensaddle-data-v${DATA_VERSION - index - 1}`,
)
const MAX_RECOVERIES = 5

export interface WorkspaceRecovery {
  id: string
  storageKey: string
  sourceKey: string
  sourceVersion?: number
  createdAt: number
  reason: string
}

export interface WorkspaceLoadResult {
  data: AppData
  recoveries: WorkspaceRecovery[]
  notice?: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function normalizeWorkspace(data: AppData): AppData {
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
  if (!data.projects.some((project) => project.id === data.activeProjectId)) {
    data.activeProjectId = data.projects[0]?.id ?? ''
  }
  if (data.activeChatId && !data.chats.some((chat) => chat.id === data.activeChatId)) {
    data.activeChatId = null
  }
  return data
}

export function migrateWorkspace(snapshot: unknown): AppData {
  const source = record(snapshot)
  if (!source) throw new Error('Workspace snapshot is not an object')
  const sourceVersion = typeof source.version === 'number' ? source.version : 1
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1) {
    throw new Error('Workspace snapshot has an invalid version')
  }
  if (sourceVersion > DATA_VERSION) {
    throw new Error(`Workspace version ${sourceVersion} is newer than this app supports`)
  }

  const seed = createSeedData()
  const sourceSettings = record(source.settings)
  const sourceNotifications = record(sourceSettings?.notifications)
  const migrated = {
    ...seed,
    ...source,
    version: DATA_VERSION,
    settings: {
      ...seed.settings,
      ...sourceSettings,
      notifications: {
        ...seed.settings.notifications,
        ...sourceNotifications,
      },
    },
  } as AppData

  const arrayKeys: Array<keyof AppData> = [
    'members', 'projects', 'chats', 'messages', 'agents', 'sites', 'apis',
    'dashboards', 'interfaces', 'knowledge', 'services', 'tasks', 'environments',
    'plugins', 'notifications', 'usageDays', 'budgets', 'wikiSummaries',
    'permissionGrants', 'folders', 'sources', 'workflows', 'workflowRuns',
    'agentSessions', 'recentChatIds',
  ]
  for (const key of arrayKeys) {
    if (!Array.isArray(migrated[key])) {
      ;(migrated as unknown as Record<string, unknown>)[key] = seed[key]
    }
  }
  if (!record(migrated.capabilities)) migrated.capabilities = seed.capabilities
  if (!record(migrated.wikiSettings)) migrated.wikiSettings = seed.wikiSettings

  return normalizeWorkspace(migrated)
}

export function listWorkspaceRecoveries(storage: Storage = localStorage): WorkspaceRecovery[] {
  try {
    const parsed = JSON.parse(storage.getItem(RECOVERY_INDEX_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is WorkspaceRecovery => {
        const candidate = record(item)
        return typeof candidate?.id === 'string'
          && typeof candidate.storageKey === 'string'
          && typeof candidate.sourceKey === 'string'
          && typeof candidate.createdAt === 'number'
          && typeof candidate.reason === 'string'
      })
      .filter((item) => storage.getItem(item.storageKey) !== null)
      .sort((left, right) => right.createdAt - left.createdAt)
  } catch {
    return []
  }
}

export function captureWorkspaceRecovery(
  storage: Storage,
  sourceKey: string,
  raw: string,
  reason: string,
): WorkspaceRecovery | null {
  try {
    const existing = listWorkspaceRecoveries(storage)
      .find((item) => storage.getItem(item.storageKey) === raw)
    if (existing) return existing

    let sourceVersion: number | undefined
    try {
      const parsed = record(JSON.parse(raw))
      sourceVersion = typeof parsed?.version === 'number' ? parsed.version : undefined
    } catch {
      // The raw value is intentionally retained even when it cannot be parsed.
    }
    const createdAt = Date.now()
    const id = `${createdAt}-${Math.random().toString(36).slice(2, 8)}`
    const storageKey = `opensaddle-recovery-${id}`
    const recovery: WorkspaceRecovery = {
      id,
      storageKey,
      sourceKey,
      sourceVersion,
      createdAt,
      reason,
    }
    storage.setItem(storageKey, raw)
    const previous = listWorkspaceRecoveries(storage)
    const next = [recovery, ...previous].slice(0, MAX_RECOVERIES)
    for (const stale of previous) {
      if (!next.some((item) => item.id === stale.id)) storage.removeItem(stale.storageKey)
    }
    storage.setItem(RECOVERY_INDEX_KEY, JSON.stringify(next))
    return recovery
  } catch {
    return null
  }
}

export function loadWorkspace(storage: Storage = localStorage): WorkspaceLoadResult {
  const candidates = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]
  let notice: string | undefined

  for (const key of candidates) {
    const raw = storage.getItem(key)
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      const source = record(parsed)
      const version = typeof source?.version === 'number' ? source.version : 1
      if (version > DATA_VERSION) {
        captureWorkspaceRecovery(storage, key, raw, `Newer workspace version ${version}`)
        notice = `A newer workspace snapshot was preserved because this app supports version ${DATA_VERSION}.`
        continue
      }
      if (key !== STORAGE_KEY || version !== DATA_VERSION) {
        captureWorkspaceRecovery(storage, key, raw, `Migrated workspace v${version} to v${DATA_VERSION}`)
        notice = `Workspace data was migrated from version ${version}; the original snapshot is available in Settings.`
      }
      return {
        data: migrateWorkspace(parsed),
        recoveries: listWorkspaceRecoveries(storage),
        notice,
      }
    } catch {
      captureWorkspaceRecovery(storage, key, raw, 'Unreadable workspace snapshot')
      notice = 'An unreadable workspace snapshot was preserved for recovery instead of being overwritten.'
    }
  }

  return {
    data: normalizeWorkspace(createSeedData()),
    recoveries: listWorkspaceRecoveries(storage),
    notice,
  }
}

export function readWorkspaceRecovery(recovery: WorkspaceRecovery, storage: Storage = localStorage): AppData {
  const raw = storage.getItem(recovery.storageKey)
  if (!raw) throw new Error('Recovery snapshot is no longer available')
  return migrateWorkspace(JSON.parse(raw) as unknown)
}

export function deleteWorkspaceRecovery(recovery: WorkspaceRecovery, storage: Storage = localStorage): WorkspaceRecovery[] {
  storage.removeItem(recovery.storageKey)
  const next = listWorkspaceRecoveries(storage).filter((item) => item.id !== recovery.id)
  storage.setItem(RECOVERY_INDEX_KEY, JSON.stringify(next))
  return next
}
