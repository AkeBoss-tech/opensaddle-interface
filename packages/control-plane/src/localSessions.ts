import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

export type LocalSessionProvider = 'codex' | 'claude'

export interface LocalSessionSummary {
  provider: LocalSessionProvider
  sessionId: string
  path: string
  cwd?: string
  updatedAt: number
  version?: string
  originator?: string
  branch?: string
}

export interface LocalSessionDiscoveryOptions {
  codexRoot?: string
  claudeRoot?: string
  maxFiles?: number
  maxLinesPerFile?: number
}

export class LocalSessionDiscovery {
  private readonly roots: Record<LocalSessionProvider, string>
  private readonly maxFiles: number
  private readonly maxLinesPerFile: number

  constructor(options: LocalSessionDiscoveryOptions = {}) {
    this.roots = {
      codex: resolve(options.codexRoot ?? join(homedir(), '.codex', 'sessions')),
      claude: resolve(options.claudeRoot ?? join(homedir(), '.claude', 'projects')),
    }
    this.maxFiles = Math.max(1, Math.min(options.maxFiles ?? 2_000, 10_000))
    this.maxLinesPerFile = Math.max(1, Math.min(options.maxLinesPerFile ?? 80, 500))
  }

  async list(provider?: LocalSessionProvider, limit = 40): Promise<LocalSessionSummary[]> {
    const providers: LocalSessionProvider[] = provider ? [provider] : ['codex', 'claude']
    const candidates = (await Promise.all(providers.map(async (item) => {
      const files = await collectJsonl(this.roots[item], this.maxFiles)
      return files.map(({ path, updatedAt }) => ({
        provider: item,
        path,
        updatedAt,
      }))
    }))).flat()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, Math.min(limit * 4, 400)))

    const summaries = await Promise.all(candidates.map(async (candidate) => {
      return candidate.provider === 'codex'
        ? await readCodexMetadata(candidate.path, candidate.updatedAt, this.maxLinesPerFile)
        : await readClaudeMetadata(candidate.path, candidate.updatedAt, this.maxLinesPerFile)
    }))
    return summaries
      .filter((summary): summary is LocalSessionSummary => Boolean(summary))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, Math.min(limit, 100)))
  }
}

async function collectJsonl(root: string, maxFiles: number): Promise<Array<{ path: string; updatedAt: number }>> {
  let files: Array<{ path: string; updatedAt: number }> = []
  const queue = [root]
  const maxDirectories = Math.max(100, maxFiles * 4)
  let visitedDirectories = 0
  while (queue.length && visitedDirectories < maxDirectories) {
    const directory = queue.shift()!
    visitedDirectories += 1
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(path)
      else if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.jsonl')) {
        const metadata = await stat(path).catch(() => undefined)
        if (metadata) files.push({ path, updatedAt: metadata.mtimeMs })
        if (files.length >= maxFiles * 2) {
          files = files.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxFiles)
        }
      }
    }
  }
  return files.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxFiles)
}

async function readCodexMetadata(
  path: string,
  updatedAt: number,
  maxLines: number,
): Promise<LocalSessionSummary | undefined> {
  for await (const record of jsonLines(path, maxLines)) {
    if (record.type !== 'session_meta') continue
    const payload = object(record.payload)
    const sessionId = string(payload?.session_id) ?? string(payload?.id)
    if (!sessionId) return undefined
    return {
      provider: 'codex',
      sessionId,
      path,
      cwd: string(payload?.cwd),
      updatedAt,
      version: string(payload?.cli_version),
      originator: string(payload?.originator) ?? 'Codex',
    }
  }
  const fallback = basename(path).match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i)?.[1]
  return fallback ? { provider: 'codex', sessionId: fallback, path, updatedAt, originator: 'Codex' } : undefined
}

async function readClaudeMetadata(
  path: string,
  updatedAt: number,
  maxLines: number,
): Promise<LocalSessionSummary | undefined> {
  let discoveredSessionId: string | undefined
  for await (const record of jsonLines(path, maxLines)) {
    const sessionId = string(record.sessionId)
    if (!sessionId) continue
    discoveredSessionId ??= sessionId
    const cwd = string(record.cwd)
    if (!cwd) continue
    return {
      provider: 'claude',
      sessionId,
      path,
      cwd,
      updatedAt,
      version: string(record.version),
      branch: string(record.gitBranch),
      originator: 'Claude Code',
    }
  }
  const fallback = discoveredSessionId ?? basename(path, '.jsonl')
  return fallback ? { provider: 'claude', sessionId: fallback, path, updatedAt, originator: 'Claude Code' } : undefined
}

async function* jsonLines(path: string, limit: number): AsyncGenerator<Record<string, unknown>> {
  const input = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let count = 0
  try {
    for await (const line of lines) {
      if (++count > limit) break
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          yield parsed as Record<string, unknown>
        }
      } catch {
        // Ignore incomplete or legacy lines and continue within the bound.
      }
    }
  } finally {
    lines.close()
    input.destroy()
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
