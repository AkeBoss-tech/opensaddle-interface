import path from 'node:path'
import { homedir } from 'node:os'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'

type SortField = 'name' | 'lastSeenAt' | 'tokenUsage' | 'estimatedCostUsd'

export interface DiscoveredUiPlugin {
  id: string
  name: string
  sourcePath: string
  projectSorts: Array<{ id: string; title: string; field: SortField; direction: 'asc' | 'desc'; missing: 'first' | 'last' }>
  projectViews: Array<{ id: string; title: string; density: 'comfortable' | 'compact'; showPath: boolean; showUsage: boolean; showSources: boolean }>
}

const ID = /^[a-z0-9][a-z0-9.-]{2,99}$/
const SORT_FIELDS = new Set<SortField>(['name', 'lastSeenAt', 'tokenUsage', 'estimatedCostUsd'])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Loads declarative UI descriptors only. Plugin manifests cannot execute renderer or Node code. */
export async function discoverUiPlugins(home = homedir()): Promise<DiscoveredUiPlugin[]> {
  const root = path.join(home, '.opensaddle', 'plugins')
  const directories = await readdir(root, { withFileTypes: true }).catch(() => [])
  const plugins: DiscoveredUiPlugin[] = []
  for (const directory of directories.slice(0, 100)) {
    if (!directory.isDirectory() || directory.isSymbolicLink()) continue
    const sourcePath = await realpath(path.join(root, directory.name, 'plugin.json')).catch(() => null)
    if (!sourcePath) continue
    const metadata = await stat(sourcePath).catch(() => null)
    if (!metadata?.isFile() || metadata.size > 256_000) continue
    const manifest = record(await readFile(sourcePath, 'utf8').then((text) => JSON.parse(text) as unknown).catch(() => null))
    const id = typeof manifest?.id === 'string' && ID.test(manifest.id) ? manifest.id : null
    if (!id || manifest?.schemaVersion !== 'opensaddle.ui-plugin.v1') continue
    const contributions = record(manifest.contributions)
    const projectSorts = (Array.isArray(contributions?.projectSorts) ? contributions.projectSorts : []).flatMap((value) => {
      const item = record(value)
      if (!item || typeof item.id !== 'string' || !ID.test(item.id) || typeof item.title !== 'string' || !SORT_FIELDS.has(item.field as SortField)) return []
      return [{
        id: item.id,
        title: item.title.slice(0, 80),
        field: item.field as SortField,
        direction: item.direction === 'asc' ? 'asc' as const : 'desc' as const,
        missing: item.missing === 'first' ? 'first' as const : 'last' as const,
      }]
    })
    const projectViews = (Array.isArray(contributions?.projectViews) ? contributions.projectViews : []).flatMap((value) => {
      const item = record(value)
      if (!item || typeof item.id !== 'string' || !ID.test(item.id) || typeof item.title !== 'string') return []
      return [{
        id: item.id,
        title: item.title.slice(0, 80),
        density: item.density === 'compact' ? 'compact' as const : 'comfortable' as const,
        showPath: item.showPath !== false,
        showUsage: item.showUsage !== false,
        showSources: item.showSources !== false,
      }]
    })
    if (!projectSorts.length && !projectViews.length) continue
    plugins.push({ id, name: typeof manifest.name === 'string' ? manifest.name.slice(0, 100) : id, sourcePath, projectSorts, projectViews })
  }
  return plugins.sort((left, right) => left.name.localeCompare(right.name))
}
