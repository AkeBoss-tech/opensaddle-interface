import type { AppData, EntityKind, EntityReference } from '../types'

export interface EntityDisplay {
  kind: EntityKind
  id: string
  label: string
  description?: string
  avatarUrl?: string
  state?: 'blocked' | 'actionable' | 'claimed' | 'in-progress' | 'done'
}

type RemoteResolver = (refs: Array<Pick<EntityReference, 'kind' | 'id'>>) => Promise<EntityDisplay[]>

const cache = new Map<string, EntityDisplay | null>()
let remoteResolver: RemoteResolver | undefined
let pending = new Map<string, Pick<EntityReference, 'kind' | 'id'>>()
let pendingPromise: Promise<void> | undefined

const cacheKey = (kind: EntityKind, id: string) => `${kind}:${id}`

function localEntity(data: AppData, kind: EntityKind, id: string): EntityDisplay | undefined {
  if (kind === 'agent') {
    const agent = data.agents.find((item) => item.id === id)
    return agent && { kind, id, label: agent.name, description: agent.description }
  }
  if (kind === 'user') {
    const member = data.members.find((item) => item.id === id)
    return member && { kind, id, label: member.name, description: member.role }
  }
  if (kind === 'thread') {
    const chat = data.chats.find((item) => item.id === id)
    return chat && { kind, id, label: chat.title, description: 'Thread' }
  }
  if (kind === 'project') {
    const project = data.projects.find((item) => item.id === id)
    return project && { kind, id, label: project.name, description: project.description }
  }
  if (kind === 'run') {
    const run = data.messages.flatMap((message) => message.run ? [message.run] : []).find((item) => item.id === id)
    return run && { kind, id, label: run.title, description: run.statusText, state: run.done ? 'done' : 'in-progress' }
  }
  if (kind === 'skill') {
    const skill = data.projects.flatMap((project) => project.local?.skills ?? []).find((item) => item.id === id)
    return skill && { kind, id, label: skill.name, description: skill.description }
  }
  return undefined
}

async function flush(): Promise<void> {
  const batch = [...pending.values()]
  pending = new Map()
  pendingPromise = undefined
  if (!batch.length || !remoteResolver) {
    for (const ref of batch) cache.set(cacheKey(ref.kind, ref.id), null)
    return
  }
  try {
    const resolved = await remoteResolver(batch)
    const found = new Map(resolved.map((entity) => [cacheKey(entity.kind, entity.id), entity]))
    for (const ref of batch) cache.set(cacheKey(ref.kind, ref.id), found.get(cacheKey(ref.kind, ref.id)) ?? null)
  } catch {
    for (const ref of batch) cache.set(cacheKey(ref.kind, ref.id), null)
  }
}

/** Resolver shared by all surfaces. Local workspace data wins before a batched remote lookup. */
export const entityResolver = {
  setRemoteResolver(resolver?: RemoteResolver) { remoteResolver = resolver },
  resolveLocal(data: AppData, kind: EntityKind, id: string): EntityDisplay | undefined {
    const local = localEntity(data, kind, id)
    if (local) cache.set(cacheKey(kind, id), local)
    return local
  },
  async resolve(data: AppData, kind: EntityKind, id: string): Promise<EntityDisplay | undefined> {
    const local = this.resolveLocal(data, kind, id)
    if (local) return local
    const key = cacheKey(kind, id)
    if (cache.has(key)) return cache.get(key) ?? undefined
    pending.set(key, { kind, id })
    pendingPromise ??= Promise.resolve().then(flush)
    await pendingPromise
    return cache.get(key) ?? undefined
  },
  search(data: AppData, kinds: EntityKind[], query: string, projectId?: string): EntityDisplay[] {
    const needle = query.trim().toLocaleLowerCase()
    const matches = (entity: EntityDisplay) => !needle || `${entity.label} ${entity.description ?? ''}`.toLocaleLowerCase().includes(needle)
    const entries: EntityDisplay[] = []
    for (const kind of kinds) {
      if (kind === 'agent') entries.push(...data.agents.filter((item) => !projectId || item.projectId === projectId).map((item) => ({ kind, id: item.id, label: item.name, description: item.description })))
      if (kind === 'user') entries.push(...data.members.map((item) => ({ kind, id: item.id, label: item.name, description: item.role })))
      if (kind === 'thread') entries.push(...data.chats.filter((item) => !projectId || item.projectId === projectId).map((item) => ({ kind, id: item.id, label: item.title, description: 'Thread' })))
      if (kind === 'project') entries.push(...data.projects.map((item) => ({ kind, id: item.id, label: item.name, description: item.description })))
      if (kind === 'skill') entries.push(...data.projects.flatMap((project) => project.local?.skills ?? []).map((item) => ({ kind, id: item.id, label: item.name, description: item.description })))
    }
    return entries.filter(matches)
  },
}
