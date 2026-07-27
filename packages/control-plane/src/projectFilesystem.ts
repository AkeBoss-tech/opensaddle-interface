import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import type { Dirent, Stats } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache',
  '.turbo', '.vite', '.venv', 'venv', '__pycache__', 'vendor', 'target', 'out', '.idea', '.vscode',
])

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.csv', '.go', '.html', '.java', '.js', '.json', '.jsx', '.md', '.mdx',
  '.mjs', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml',
  '.yaml', '.yml', '.zsh', '.env',
])

const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc', '.pdf', '.docx'])
const SITE_MARKERS = new Set(['astro.config.mjs', 'astro.config.ts', 'docusaurus.config.js', 'gatsby-config.js', 'hugo.toml', 'mkdocs.yml', 'next.config.js', 'next.config.mjs', 'next.config.ts', 'vite.config.ts', 'vite.config.js'])
const INSTRUCTION_BASENAMES = new Set(['agents.md', 'claude.md', 'codex.md', 'copilot-instructions.md', 'instructions.md'])

export type ProjectFileKind = 'file' | 'directory' | 'symlink'
export type ProjectArtifactKind = 'instruction' | 'skill' | 'agent' | 'documentation' | 'site'

export interface ProjectFileEntry {
  path: string
  name: string
  kind: ProjectFileKind
  size: number | null
  modifiedAt: number | null
  symlinkTarget?: string
}

export interface ProjectFileList {
  root: string
  path: string
  entries: ProjectFileEntry[]
  truncated: boolean
}

export interface ProjectFileStat extends ProjectFileEntry {
  root: string
  readable: boolean
}

export interface ProjectFileRead {
  root: string
  path: string
  content: string
  bytes: number
  truncated: boolean
}

export interface ProjectManagedArtifactWrite {
  root: string
  path: string
  bytes: number
  modifiedAt: number
}

export interface ProjectManagedArtifactArchive {
  root: string
  path: string
  archivedPath: string
  archivedAt: number
}

export interface ProjectManagedArtifactArchiveEntry {
  archivedPath: string
  originalPath: string
  kind: 'agent' | 'skill'
  name: string
  archivedAt: number
  bytes: number
}

export interface ProjectManagedArtifactRestore {
  root: string
  path: string
  archivedPath: string
  restoredAt: number
}

export interface ProjectSearchMatch {
  path: string
  line: number
  column: number
  preview: string
}

export interface ProjectSearchResult {
  root: string
  query: string
  matches: ProjectSearchMatch[]
  scannedFiles: number
  scannedBytes: number
  truncated: boolean
}

export interface ProjectArtifact {
  kind: ProjectArtifactKind
  path: string
  name: string
  modifiedAt: number | null
  /** A useful identifier for sidebar groups, for example `docs` or `.claude/agents`. */
  location: string
}

export interface ProjectArtifactManifest {
  root: string
  generatedAt: number
  artifacts: ProjectArtifact[]
  counts: Record<ProjectArtifactKind, number>
  truncated: boolean
}

export interface ProjectFilesystemOptions {
  maxListEntries?: number
  maxReadBytes?: number
  maxSearchFiles?: number
  maxSearchBytes?: number
  maxSearchResults?: number
  maxWalkEntries?: number
  ignoredDirectories?: Iterable<string>
}

export class ProjectFilesystemError extends Error {
  constructor(
    readonly code: 'invalid_root' | 'root_not_allowed' | 'invalid_path' | 'not_found' | 'not_a_file' | 'not_a_directory' | 'path_escaped' | 'file_too_large' | 'invalid_query' | 'already_exists',
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
  }
}

interface ResolvedProjectPath {
  root: string
  relativePath: string
  resolvedPath: string
  link: Stats
  info: Stats
}

function isInside(candidate: string, root: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function normalizeRelativePath(value?: string): string {
  if (!value || value === '.') return ''
  if (value.length > 2_000 || value.includes('\0') || isAbsolute(value)) {
    throw new ProjectFilesystemError('invalid_path', 'path must be a relative path of at most 2000 characters', 400)
  }
  const virtualRoot = resolve('/opensaddle-project-root')
  const normalized = relative(virtualRoot, resolve(virtualRoot, value))
  if (normalized === '..' || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)) {
    throw new ProjectFilesystemError('invalid_path', 'path must stay within the project root', 400)
  }
  return normalized === '.' ? '' : normalized
}

function managedArtifactPath(pathInput: string): string {
  const path = normalizeRelativePath(pathInput).split(sep).join('/')
  const managed = /^\.opensaddle\/agents\/[a-z0-9][a-z0-9-]{0,79}\.md$/.test(path)
    || /^\.opensaddle\/skills\/[a-z0-9][a-z0-9-]{0,79}\/SKILL\.md$/.test(path)
  if (!managed) {
    throw new ProjectFilesystemError('invalid_path', 'managed artifacts must be an OpenSaddle agent or skill path', 400)
  }
  return path
}

function managedArchivePath(pathInput: string): {
  archivedPath: string
  originalPath: string
  kind: 'agent' | 'skill'
  name: string
  archivedAt: number
} {
  const archivedPath = normalizeRelativePath(pathInput).split(sep).join('/')
  const match = archivedPath.match(
    /^\.opensaddle\/archive\/(\d{10,16})-(agents|skills)-([a-z0-9][a-z0-9-]{0,79})-([a-f0-9]{8})\.md$/,
  )
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new ProjectFilesystemError('invalid_path', 'archive path must identify an OpenSaddle-managed artifact', 400)
  }
  const kind = match[2] === 'agents' ? 'agent' : 'skill'
  return {
    archivedPath,
    originalPath: kind === 'agent'
      ? `.opensaddle/agents/${match[3]}.md`
      : `.opensaddle/skills/${match[3]}/SKILL.md`,
    kind,
    name: match[3],
    archivedAt: Number(match[1]),
  }
}

function entryKind(info: Stats): ProjectFileKind {
  if (info.isSymbolicLink()) return 'symlink'
  return info.isDirectory() ? 'directory' : 'file'
}

function canReadAsText(path: string): boolean {
  const name = basename(path).toLowerCase()
  return name.startsWith('.env') || TEXT_EXTENSIONS.has(extname(name)) || !name.includes('.')
}

function artifactFor(path: string, modifiedAt: number | null): ProjectArtifact | null {
  const normalized = path.split(sep).join('/')
  const name = basename(normalized)
  const lowerName = name.toLowerCase()
  const lower = normalized.toLowerCase()
  const segments = lower.split('/')
  const location = segments.slice(0, -1).join('/') || '.'

  if (INSTRUCTION_BASENAMES.has(lowerName) || lower.endsWith('/.github/copilot-instructions.md')) {
    return { kind: 'instruction', path: normalized, name, modifiedAt, location }
  }
  if (lowerName === 'skill.md' && (segments.includes('skills') || segments.includes('.codex') || segments.includes('.claude'))) {
    return { kind: 'skill', path: normalized, name: segments.at(-2) ?? name, modifiedAt, location }
  }
  if ((segments.includes('agents') || segments.includes('.agents')) && (lower.endsWith('.md') || lower.endsWith('.agent'))) {
    return { kind: 'agent', path: normalized, name, modifiedAt, location }
  }
  if (SITE_MARKERS.has(lowerName) || (segments.some((part) => ['site', 'sites', 'website', 'web'].includes(part)) && ['package.json', 'index.html'].includes(lowerName))) {
    return { kind: 'site', path: normalized, name, modifiedAt, location }
  }
  if ((segments.some((part) => ['docs', 'doc', 'wiki', 'documentation'].includes(part)) || ['readme.md', 'readme.mdx'].includes(lowerName)) && DOCUMENT_EXTENSIONS.has(extname(lowerName))) {
    return { kind: 'documentation', path: normalized, name, modifiedAt, location }
  }
  return null
}

/**
 * Read-only project filesystem boundary. Every public operation verifies the
 * requested project and target through `realpath`, preventing `..` traversal
 * and symlinks that lead outside an allowed project root.
 */
export class ProjectFilesystemService {
  private readonly allowedRoots: string[]
  private readonly ignoredDirectories: Set<string>
  private readonly limits: Required<Omit<ProjectFilesystemOptions, 'ignoredDirectories'>>

  constructor(allowedRoots: string[], options: ProjectFilesystemOptions = {}) {
    this.allowedRoots = [...new Set(allowedRoots.map((root) => resolve(root)))]
    this.ignoredDirectories = new Set([...DEFAULT_IGNORED_DIRECTORIES, ...(options.ignoredDirectories ?? [])])
    this.limits = {
      maxListEntries: options.maxListEntries ?? 500,
      maxReadBytes: options.maxReadBytes ?? 1_048_576,
      maxSearchFiles: options.maxSearchFiles ?? 1_000,
      maxSearchBytes: options.maxSearchBytes ?? 5 * 1_048_576,
      maxSearchResults: options.maxSearchResults ?? 200,
      maxWalkEntries: options.maxWalkEntries ?? 10_000,
    }
  }

  private async canonicalRoot(input: string): Promise<string> {
    if (!input.trim()) throw new ProjectFilesystemError('invalid_root', 'project root is required', 400)
    let candidate: string
    try {
      candidate = await realpath(resolve(input))
      if (!(await stat(candidate)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new ProjectFilesystemError('invalid_root', 'project root must identify an existing directory', 400)
    }
    const roots = await Promise.all(this.allowedRoots.map(async (root) => {
      try { return await realpath(root) } catch { return root }
    }))
    if (!roots.some((root) => isInside(candidate, root))) {
      throw new ProjectFilesystemError('root_not_allowed', 'project root is outside configured workspace roots', 403)
    }
    return candidate
  }

  private async resolvePath(rootInput: string, relativePath?: string): Promise<ResolvedProjectPath> {
    const root = await this.canonicalRoot(rootInput)
    const input = normalizeRelativePath(relativePath)
    const candidate = resolve(root, input)
    if (!isInside(candidate, root)) throw new ProjectFilesystemError('invalid_path', 'path must stay within the project root', 400)
    let resolvedPath: string
    let link: Awaited<ReturnType<typeof lstat>>
    let info: Awaited<ReturnType<typeof stat>>
    try {
      link = await lstat(candidate)
      resolvedPath = await realpath(candidate)
      if (!isInside(resolvedPath, root)) throw new ProjectFilesystemError('path_escaped', 'symlink resolves outside the project root', 403)
      info = await stat(resolvedPath)
    } catch (error) {
      if (error instanceof ProjectFilesystemError) throw error
      throw new ProjectFilesystemError('not_found', 'project path does not exist', 404)
    }
    return { root, relativePath: input.split(sep).join('/'), resolvedPath, link, info }
  }

  private shouldIgnore(name: string): boolean {
    return this.ignoredDirectories.has(name)
  }

  private shouldIgnorePath(root: string, path: string): boolean {
    const normalized = relative(root, path).split(sep).join('/').toLowerCase()
    return normalized === '.opensaddle/archive'
      || normalized.startsWith('.opensaddle/archive/')
      || normalized === '.claude/worktrees'
      || normalized.startsWith('.claude/worktrees/')
      || normalized === '.codex/worktrees'
      || normalized.startsWith('.codex/worktrees/')
  }

  private toEntry(path: string, link: Stats, info: Stats, root: string): ProjectFileEntry {
    const kind = entryKind(link)
    return {
      path: relative(root, path).split(sep).join('/'),
      name: basename(path),
      kind,
      size: kind === 'directory' ? null : Number(info.size),
      modifiedAt: Number(info.mtimeMs),
      ...(kind === 'symlink' ? { symlinkTarget: relative(root, path).split(sep).join('/') } : {}),
    }
  }

  async list(rootInput: string, options: { path?: string; limit?: number } = {}): Promise<ProjectFileList> {
    const target = await this.resolvePath(rootInput, options.path)
    if (!target.info.isDirectory()) throw new ProjectFilesystemError('not_a_directory', 'path must identify a directory', 400)
    const max = Math.min(Math.max(options.limit ?? this.limits.maxListEntries, 1), this.limits.maxListEntries)
    const rows = await readdir(target.resolvedPath, { withFileTypes: true })
    const entries: ProjectFileEntry[] = []
    for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
      if (this.shouldIgnore(row.name)) continue
      if (entries.length === max) break
      const childPath = resolve(target.resolvedPath, row.name)
      if (this.shouldIgnorePath(target.root, childPath)) continue
      try {
        const link = await lstat(childPath)
        const resolved = await realpath(childPath)
        if (!isInside(resolved, target.root)) continue
        const info = await stat(resolved)
        entries.push(this.toEntry(childPath, link, info, target.root))
      } catch {
        // A concurrent deletion or an inaccessible link must not leak a path or fail the directory listing.
      }
    }
    return { root: target.root, path: target.relativePath, entries, truncated: rows.filter((row) => !this.shouldIgnore(row.name)).length > entries.length }
  }

  async stat(rootInput: string, path: string): Promise<ProjectFileStat> {
    const target = await this.resolvePath(rootInput, path)
    return { root: target.root, ...this.toEntry(target.resolvedPath, target.link, target.info, target.root), readable: target.info.isFile() && canReadAsText(target.relativePath) }
  }

  async read(rootInput: string, path: string, options: { maxBytes?: number } = {}): Promise<ProjectFileRead> {
    const target = await this.resolvePath(rootInput, path)
    if (!target.info.isFile()) throw new ProjectFilesystemError('not_a_file', 'path must identify a regular file', 400)
    if (!canReadAsText(target.relativePath)) throw new ProjectFilesystemError('not_a_file', 'binary files cannot be read through the text endpoint', 415)
    const limit = Math.min(Math.max(options.maxBytes ?? this.limits.maxReadBytes, 1), this.limits.maxReadBytes)
    const handle = await open(target.resolvedPath, 'r')
    try {
      const bytesToRead = Math.min(Number(target.info.size), limit)
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)
      return { root: target.root, path: target.relativePath, content: buffer.subarray(0, bytesRead).toString('utf8'), bytes: bytesRead, truncated: Number(target.info.size) > bytesRead }
    } finally {
      await handle.close()
    }
  }

  async writeManagedArtifact(rootInput: string, pathInput: string, content: string): Promise<ProjectManagedArtifactWrite> {
    const root = await this.canonicalRoot(rootInput)
    const path = managedArtifactPath(pathInput)
    if (!content.trim() || content.length > 100_000 || content.includes('\0')) {
      throw new ProjectFilesystemError('invalid_query', 'managed artifact content must contain 1-100000 text characters', 400)
    }
    const target = resolve(root, path)
    const parent = dirname(target)
    await mkdir(parent, { recursive: true })
    const canonicalParent = await realpath(parent)
    if (!isInside(canonicalParent, root)) {
      throw new ProjectFilesystemError('path_escaped', 'managed artifact parent resolves outside the project root', 403)
    }
    try {
      const existing = await lstat(target)
      if (existing.isSymbolicLink()) {
        throw new ProjectFilesystemError('path_escaped', 'managed artifact cannot replace a symlink', 403)
      }
      if (!existing.isFile()) {
        throw new ProjectFilesystemError('not_a_file', 'managed artifact target must be a regular file', 400)
      }
    } catch (error) {
      if (error instanceof ProjectFilesystemError) throw error
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const temporary = resolve(canonicalParent, `.${basename(target)}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporary, target)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
    const info = await stat(target)
    return { root, path, bytes: Number(info.size), modifiedAt: Number(info.mtimeMs) }
  }

  async archiveManagedArtifact(rootInput: string, pathInput: string): Promise<ProjectManagedArtifactArchive> {
    const root = await this.canonicalRoot(rootInput)
    const path = managedArtifactPath(pathInput)
    const target = resolve(root, path)
    const existing = await lstat(target).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ProjectFilesystemError('not_found', 'managed artifact was not found', 404)
      }
      throw error
    })
    if (existing.isSymbolicLink()) {
      throw new ProjectFilesystemError('path_escaped', 'managed artifact cannot archive a symlink', 403)
    }
    if (!existing.isFile()) {
      throw new ProjectFilesystemError('not_a_file', 'managed artifact target must be a regular file', 400)
    }
    const canonicalParent = await realpath(dirname(target))
    if (!isInside(canonicalParent, root)) {
      throw new ProjectFilesystemError('path_escaped', 'managed artifact parent resolves outside the project root', 403)
    }
    const archiveDirectory = resolve(root, '.opensaddle', 'archive')
    await mkdir(archiveDirectory, { recursive: true })
    const canonicalArchive = await realpath(archiveDirectory)
    if (!isInside(canonicalArchive, root)) {
      throw new ProjectFilesystemError('path_escaped', 'managed artifact archive resolves outside the project root', 403)
    }
    const archivedAt = Date.now()
    const artifactName = path
      .replace(/^\.opensaddle\//, '')
      .replace(/\/SKILL\.md$/, '')
      .replace(/\.md$/, '')
      .replace(/\//g, '-')
    const archivedPath = `.opensaddle/archive/${archivedAt}-${artifactName}-${randomUUID().slice(0, 8)}.md`
    await rename(target, resolve(root, archivedPath))
    return { root, path, archivedPath, archivedAt }
  }

  async listManagedArchives(rootInput: string): Promise<ProjectManagedArtifactArchiveEntry[]> {
    const root = await this.canonicalRoot(rootInput)
    const archiveDirectory = resolve(root, '.opensaddle', 'archive')
    let rows: Dirent<string>[]
    try {
      const canonicalArchive = await realpath(archiveDirectory)
      if (!isInside(canonicalArchive, root)) {
        throw new ProjectFilesystemError('path_escaped', 'managed artifact archive resolves outside the project root', 403)
      }
      rows = await readdir(canonicalArchive, { withFileTypes: true })
    } catch (error) {
      if (error instanceof ProjectFilesystemError) throw error
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    const entries: ProjectManagedArtifactArchiveEntry[] = []
    for (const row of rows.sort((left, right) => right.name.localeCompare(left.name)).slice(0, 200)) {
      if (!row.isFile() || row.isSymbolicLink()) continue
      try {
        const parsed = managedArchivePath(`.opensaddle/archive/${row.name}`)
        const info = await stat(resolve(archiveDirectory, row.name))
        entries.push({ ...parsed, bytes: Number(info.size) })
      } catch (error) {
        if (error instanceof ProjectFilesystemError && error.code === 'invalid_path') continue
        throw error
      }
    }
    return entries
  }

  async restoreManagedArtifact(rootInput: string, archivePathInput: string): Promise<ProjectManagedArtifactRestore> {
    const root = await this.canonicalRoot(rootInput)
    const archive = managedArchivePath(archivePathInput)
    const source = resolve(root, archive.archivedPath)
    const sourceInfo = await lstat(source).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ProjectFilesystemError('not_found', 'archived artifact was not found', 404)
      }
      throw error
    })
    if (sourceInfo.isSymbolicLink()) {
      throw new ProjectFilesystemError('path_escaped', 'archived artifact cannot be a symlink', 403)
    }
    if (!sourceInfo.isFile()) {
      throw new ProjectFilesystemError('not_a_file', 'archived artifact must be a regular file', 400)
    }
    const sourceParent = await realpath(dirname(source))
    if (!isInside(sourceParent, root)) {
      throw new ProjectFilesystemError('path_escaped', 'managed artifact archive resolves outside the project root', 403)
    }
    const target = resolve(root, archive.originalPath)
    await mkdir(dirname(target), { recursive: true })
    const targetParent = await realpath(dirname(target))
    if (!isInside(targetParent, root)) {
      throw new ProjectFilesystemError('path_escaped', 'managed artifact parent resolves outside the project root', 403)
    }
    try {
      const existing = await lstat(target)
      if (existing.isSymbolicLink()) {
        throw new ProjectFilesystemError('path_escaped', 'managed artifact cannot replace a symlink', 403)
      }
      throw new ProjectFilesystemError('already_exists', 'restore target already exists', 409)
    } catch (error) {
      if (error instanceof ProjectFilesystemError) throw error
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    await rename(source, target)
    return {
      root,
      path: archive.originalPath,
      archivedPath: archive.archivedPath,
      restoredAt: Date.now(),
    }
  }

  private async walk(root: string, onFile: (path: string, info: Stats) => Promise<boolean>): Promise<boolean> {
    const queue = [root]
    let visited = 0
    while (queue.length > 0) {
      const directory = queue.shift()
      if (!directory) break
      let rows: Dirent<string>[]
      try { rows = await readdir(directory, { withFileTypes: true }) } catch { continue }
      for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++visited > this.limits.maxWalkEntries) return true
        if (row.isDirectory() && this.shouldIgnore(row.name)) continue
        const candidate = resolve(directory, row.name)
        if (this.shouldIgnorePath(root, candidate)) continue
        try {
          const link = await lstat(candidate)
          const resolved = await realpath(candidate)
          if (!isInside(resolved, root)) continue
          const info = await stat(resolved)
          if (info.isDirectory()) {
            // Do not descend through aliases: even an in-root symlink can create a cycle
            // or expose the same content twice in a scan.
            if (!link.isSymbolicLink()) queue.push(resolved)
          } else if (info.isFile() && await onFile(resolved, info)) {
            return true
          }
        } catch {
          // Ignore files removed during a scan and inaccessible entries.
        }
      }
    }
    return false
  }

  async search(rootInput: string, queryInput: string, options: { limit?: number } = {}): Promise<ProjectSearchResult> {
    const root = await this.canonicalRoot(rootInput)
    const query = queryInput.trim()
    if (!query || query.length > 500 || query.includes('\0')) throw new ProjectFilesystemError('invalid_query', 'query must contain 1-500 characters', 400)
    const limit = Math.min(Math.max(options.limit ?? this.limits.maxSearchResults, 1), this.limits.maxSearchResults)
    const needle = query.toLocaleLowerCase()
    let scannedFiles = 0
    let scannedBytes = 0
    let truncated = false
    const matches: ProjectSearchMatch[] = []
    const stopped = await this.walk(root, async (path, info) => {
      if (!canReadAsText(path)) return false
      if (scannedFiles >= this.limits.maxSearchFiles || scannedBytes >= this.limits.maxSearchBytes) { truncated = true; return true }
      const remaining = this.limits.maxSearchBytes - scannedBytes
      const bytes = Math.min(Number(info.size), remaining)
      if (bytes <= 0) { truncated = true; return true }
      const handle = await open(path, 'r')
      let text: string
      try {
        const buffer = Buffer.alloc(bytes)
        const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
        text = buffer.subarray(0, bytesRead).toString('utf8')
        scannedBytes += bytesRead
      } finally { await handle.close() }
      scannedFiles += 1
      if (bytes < Number(info.size)) truncated = true
      const lines = text.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? ''
        const column = line.toLocaleLowerCase().indexOf(needle)
        if (column >= 0) {
          matches.push({ path: relative(root, path).split(sep).join('/'), line: index + 1, column: column + 1, preview: line.slice(Math.max(0, column - 100), column + query.length + 140) })
          if (matches.length >= limit) { truncated = true; return true }
        }
      }
      return false
    })
    return { root, query, matches, scannedFiles, scannedBytes, truncated: truncated || stopped }
  }

  async rescan(rootInput: string): Promise<ProjectArtifactManifest> {
    const root = await this.canonicalRoot(rootInput)
    const artifacts: ProjectArtifact[] = []
    const stopped = await this.walk(root, async (path, info) => {
      const artifact = artifactFor(relative(root, path), Number(info.mtimeMs))
      if (artifact) artifacts.push(artifact)
      return false
    })
    artifacts.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path))
    const counts: Record<ProjectArtifactKind, number> = { instruction: 0, skill: 0, agent: 0, documentation: 0, site: 0 }
    for (const artifact of artifacts) counts[artifact.kind] += 1
    return { root, generatedAt: Date.now(), artifacts, counts, truncated: stopped }
  }
}
