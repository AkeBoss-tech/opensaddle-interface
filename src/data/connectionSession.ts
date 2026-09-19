import type { ConnectionProfile } from '../services'

const KEY = 'opensaddle-connection-session-v1'

export function loadSessionConnection(fallback: ConnectionProfile, storage: Storage | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage): ConnectionProfile {
  if (!storage) return fallback
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? 'null') as Partial<ConnectionProfile> | null
    if (!value || value.mode !== 'remote' || typeof value.baseUrl !== 'string' || !/^https?:\/\//i.test(value.baseUrl)) return fallback
    return { id: `remote-${value.baseUrl.replace(/\/$/, '')}`, name: typeof value.name === 'string' && value.name.trim() ? value.name : value.baseUrl, mode: 'remote', baseUrl: value.baseUrl.replace(/\/$/, ''), token: typeof value.token === 'string' ? value.token : undefined, allowMockFallback: false }
  } catch { return fallback }
}

export function saveSessionConnection(profile: ConnectionProfile, storage: Storage | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage, includeToken = true) {
  if (!storage) return
  if (profile.mode === 'demo') storage.removeItem(KEY)
  else storage.setItem(KEY, JSON.stringify(includeToken ? profile : { ...profile, token: undefined }))
}
