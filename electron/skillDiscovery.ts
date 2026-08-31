import path from 'node:path'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'

export type SkillDiscoverySource = 'codex' | 'claude' | 'cursor'

export interface DiscoveredAgentSkill {
  id: string
  name: string
  description: string
  source: SkillDiscoverySource
  sourcePath: string
  modifiedAt: number
  helperFileCount: number
  content: string
}

const MAX_SKILLS = 500
const MAX_MANIFEST_BYTES = 100_000

function frontmatterValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  if (!match) return null
  return match.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2').trim()
}

async function skillManifests(root: string, maxDepth: number): Promise<string[]> {
  const manifests: string[] = []
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || manifests.length >= MAX_SKILLS) return
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (manifests.length >= MAX_SKILLS || entry.isSymbolicLink()) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isFile() && entry.name === 'SKILL.md') manifests.push(absolute)
      else if (entry.isDirectory()) await walk(absolute, depth + 1)
    }
  }
  await walk(root, 0)
  return manifests
}

async function helperFileCount(directory: string): Promise<number> {
  let count = 0
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 4 || count >= 999) return
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isSymbolicLink() || count >= 999) continue
      if (entry.isDirectory()) await walk(path.join(current, entry.name), depth + 1)
      else if (entry.isFile() && !(current === directory && entry.name === 'SKILL.md')) count += 1
    }
  }
  await walk(directory, 0)
  return count
}

/** Discovers instruction manifests only. It never executes skill code or follows symlinks. */
export async function discoverAgentSkills(home = homedir()): Promise<DiscoveredAgentSkill[]> {
  const roots: Array<{ source: SkillDiscoverySource; root: string; depth: number }> = [
    { source: 'codex', root: path.join(home, '.codex', 'skills'), depth: 3 },
    { source: 'codex', root: path.join(home, '.codex', 'plugins', 'cache'), depth: 9 },
    { source: 'claude', root: path.join(home, '.claude', 'skills'), depth: 5 },
    { source: 'cursor', root: path.join(home, '.cursor', 'skills'), depth: 5 },
  ]
  const candidates = (await Promise.all(roots.map(async (entry) => ({
    ...entry,
    manifests: await skillManifests(entry.root, entry.depth),
  })))).flatMap((entry) => entry.manifests.map((manifest) => ({ source: entry.source, manifest })))
  const seen = new Set<string>()
  const discovered: DiscoveredAgentSkill[] = []
  for (const candidate of candidates) {
    const sourcePath = await realpath(candidate.manifest).catch(() => null)
    if (!sourcePath || seen.has(sourcePath)) continue
    seen.add(sourcePath)
    const metadata = await stat(sourcePath).catch(() => null)
    if (!metadata?.isFile() || metadata.size > MAX_MANIFEST_BYTES) continue
    const content = await readFile(sourcePath, 'utf8').catch(() => '')
    if (!content.trim() || content.includes('\0')) continue
    const directory = path.dirname(sourcePath)
    const name = frontmatterValue(content, 'name') ?? path.basename(directory)
    const description = frontmatterValue(content, 'description') ?? 'Reusable agent instructions'
    discovered.push({
      id: `skill-${createHash('sha256').update(sourcePath).digest('hex').slice(0, 16)}`,
      name,
      description,
      source: candidate.source,
      sourcePath,
      modifiedAt: metadata.mtimeMs,
      helperFileCount: await helperFileCount(directory),
      content,
    })
  }
  return discovered.sort((left, right) => right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name))
}
