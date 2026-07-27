import { spawn } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/

export class GitWorkspaceError extends Error {
  constructor(
    readonly code: 'invalid_repo' | 'repo_not_allowed' | 'not_a_repository' | 'invalid_git_input' | 'git_failed' | 'git_timeout',
    message: string,
    readonly statusCode: number,
    readonly detail?: string,
  ) {
    super(message)
  }
}

interface GitResult {
  stdout: string
  stderr: string
}

export interface GitFileStatus {
  path: string
  originalPath?: string
  index: string
  worktree: string
  staged: boolean
  modified: boolean
  untracked: boolean
}

export interface GitDiffFile {
  path: string
  additions: number | null
  deletions: number | null
  binary: boolean
}

export interface GitStatus {
  repository: string
  branch: string | null
  detached: boolean
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  clean: boolean
  additions: number
  deletions: number
  files: GitFileStatus[]
  diffFiles: GitDiffFile[]
}

export interface GitComparison {
  repository: string
  base: string
  head: string
  mergeBase: string
  additions: number
  deletions: number
  files: GitDiffFile[]
  patch: string
  truncated: boolean
}

export interface GitPullRequest {
  repository: string
  number: number
  url: string
  title: string
  state: string
  base: string
  head: string
}

function inside(candidate: string, root: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function validateRef(value: string, label: string): string {
  if (!SAFE_REF.test(value) || value.includes('..') || value.endsWith('/') || value.includes('//')) {
    throw new GitWorkspaceError('invalid_git_input', `${label} is not a safe Git ref`, 400)
  }
  return value
}

function validateRemote(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)) {
    throw new GitWorkspaceError('invalid_git_input', 'remote is not a safe Git remote name', 400)
  }
  return value
}

function validateRelativePath(value: string): string {
  if (!value || value.length > 2_000 || value.includes('\0') || isAbsolute(value)) {
    throw new GitWorkspaceError('invalid_git_input', 'paths must be repository-relative and at most 2000 characters', 400)
  }
  const normalized = relative('.', resolve('.', value))
  if (normalized === '..' || normalized.startsWith('../') || isAbsolute(normalized)) {
    throw new GitWorkspaceError('invalid_git_input', `path escapes the repository: ${value}`, 400)
  }
  return value
}

function parseNumstat(output: string): GitDiffFile[] {
  if (!output) return []
  return output.split('\0').flatMap((row) => {
    if (!row) return []
    const [added, deleted, path] = row.split('\t')
    if (added === undefined || deleted === undefined || path === undefined) return []
    const binary = added === '-' || deleted === '-'
    return [{
      path,
      additions: binary ? null : Number(added),
      deletions: binary ? null : Number(deleted),
      binary,
    }]
  })
}

function totals(files: GitDiffFile[]): { additions: number; deletions: number } {
  return files.reduce((result, file) => ({
    additions: result.additions + (file.additions ?? 0),
    deletions: result.deletions + (file.deletions ?? 0),
  }), { additions: 0, deletions: 0 })
}

function safeGitDetail(value: string): string {
  return value.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[redacted]@')
}

function parseStatus(output: string): Omit<GitStatus, 'repository' | 'additions' | 'deletions' | 'diffFiles'> {
  let branch: string | null = null
  let head: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const files: GitFileStatus[] = []
  const rows = output.split('\0')
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) continue
    if (row.startsWith('# branch.head ')) {
      const value = row.slice('# branch.head '.length)
      branch = value === '(detached)' ? null : value
      continue
    }
    if (row.startsWith('# branch.oid ')) {
      const value = row.slice('# branch.oid '.length)
      head = value === '(initial)' ? null : value
      continue
    }
    if (row.startsWith('# branch.upstream ')) {
      upstream = row.slice('# branch.upstream '.length)
      continue
    }
    if (row.startsWith('# branch.ab ')) {
      const match = /^\# branch\.ab \+(\d+) -(\d+)$/.exec(row)
      ahead = Number(match?.[1] ?? 0)
      behind = Number(match?.[2] ?? 0)
      continue
    }
    const kind = row[0]
    if (kind === '?' || kind === '!') {
      const path = row.slice(2)
      files.push({
        path,
        index: kind,
        worktree: kind,
        staged: false,
        modified: kind === '?',
        untracked: kind === '?',
      })
      continue
    }
    if (kind !== '1' && kind !== '2' && kind !== 'u') continue
    const parts = row.split(' ')
    const xy = parts[1] ?? '..'
    const pathIndex = kind === '1' ? 8 : kind === '2' ? 9 : 10
    const path = parts.slice(pathIndex).join(' ')
    const originalPath = kind === '2' ? rows[index + 1] : undefined
    if (kind === '2') index += 1
    files.push({
      path,
      originalPath,
      index: xy[0] ?? '.',
      worktree: xy[1] ?? '.',
      staged: xy[0] !== '.',
      modified: xy[0] !== '.' || xy[1] !== '.',
      untracked: false,
    })
  }
  return {
    branch,
    detached: branch === null && head !== null,
    head,
    upstream,
    ahead,
    behind,
    clean: files.length === 0,
    files,
  }
}

async function runProgram(
  executable: string,
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<GitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  return await new Promise<GitResult>((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
      },
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    let settled = false
    const finish = (error?: Error, result?: GitResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolveResult(result ?? { stdout: '', stderr: '' })
    }
    const append = (target: Buffer[], chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxOutputBytes) {
        child.kill('SIGKILL')
        finish(new GitWorkspaceError('git_failed', 'Git output exceeded the safety limit', 413))
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => append(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => append(stderr, chunk))
    child.on('error', (error) => finish(new GitWorkspaceError('git_failed', `${executable} could not be started`, 500, error.message)))
    child.on('close', (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }
      if (code === 0) finish(undefined, result)
      else finish(new GitWorkspaceError(
        'git_failed',
        'Git command failed',
        409,
        safeGitDetail(result.stderr.trim() || result.stdout.trim()),
      ))
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new GitWorkspaceError('git_timeout', 'Git command timed out', 504))
    }, timeoutMs)
    timer.unref()
  })
}

async function runGit(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<GitResult> {
  return await runProgram('git', cwd, args, options)
}

export class GitWorkspaceService {
  private readonly roots: string[]

  constructor(
    roots: string[],
    private readonly additionalRoots: () => string[] = () => [],
    private readonly githubCli = 'gh',
  ) {
    this.roots = [...new Set(roots.map((root) => resolve(root)))]
  }

  private async canonicalAllowedPath(input: string): Promise<string> {
    if (!input.trim()) throw new GitWorkspaceError('invalid_repo', 'repo is required', 400)
    let candidate: string
    try {
      candidate = await realpath(resolve(input))
      if (!(await stat(candidate)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new GitWorkspaceError('invalid_repo', 'repo must identify an existing directory', 400)
    }
    const roots = await Promise.all([...this.roots, ...this.additionalRoots().map((root) => resolve(root))].map(async (root) => {
      try {
        return await realpath(root)
      } catch {
        return root
      }
    }))
    if (!roots.some((root) => inside(candidate, root))) {
      throw new GitWorkspaceError('repo_not_allowed', 'repo is outside the configured workspace roots', 403)
    }
    return candidate
  }

  async resolveRepository(input: string): Promise<string> {
    const candidate = await this.canonicalAllowedPath(input)
    let repository: string
    try {
      repository = (await runGit(candidate, ['rev-parse', '--show-toplevel'])).stdout.trim()
    } catch (error) {
      if (error instanceof GitWorkspaceError) {
        throw new GitWorkspaceError('not_a_repository', 'repo is not inside a Git working tree', 400, error.detail)
      }
      throw error
    }
    return await this.canonicalAllowedPath(repository)
  }

  async status(input: string): Promise<GitStatus> {
    const repository = await this.resolveRepository(input)
    const hasHead = await runGit(repository, ['rev-parse', '--verify', 'HEAD'])
      .then(() => true)
      .catch((error) => {
        if (error instanceof GitWorkspaceError && error.statusCode === 409) return false
        throw error
      })
    const [statusResult, diffResult] = await Promise.all([
      runGit(repository, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']),
      hasHead
        ? runGit(repository, ['diff', '--numstat', '-z', 'HEAD', '--'])
        : runGit(repository, ['diff', '--cached', '--numstat', '-z', '--']),
    ])
    const diffFiles = parseNumstat(diffResult.stdout)
    return {
      repository,
      ...parseStatus(statusResult.stdout),
      ...totals(diffFiles),
      diffFiles,
    }
  }

  async compare(input: string, baseInput: string, headInput = 'HEAD'): Promise<GitComparison> {
    const repository = await this.resolveRepository(input)
    const base = validateRef(baseInput, 'base')
    const head = validateRef(headInput, 'head')
    await Promise.all([
      runGit(repository, ['rev-parse', '--verify', `${base}^{commit}`]),
      runGit(repository, ['rev-parse', '--verify', `${head}^{commit}`]),
    ])
    const range = `${base}...${head}`
    let patchTruncated = false
    const [mergeBaseResult, numstatResult, patchResult] = await Promise.all([
      runGit(repository, ['merge-base', base, head]),
      runGit(repository, ['diff', '--numstat', '-z', '--find-renames', range, '--']),
      runGit(repository, ['diff', '--no-ext-diff', '--unified=3', '--find-renames', range, '--'], {
        maxOutputBytes: MAX_OUTPUT_BYTES + 1,
      }).catch((error) => {
        if (error instanceof GitWorkspaceError && error.statusCode === 413) {
          patchTruncated = true
          return { stdout: '', stderr: '' }
        }
        throw error
      }),
    ])
    const files = parseNumstat(numstatResult.stdout)
    const patch = patchResult.stdout.slice(0, MAX_OUTPUT_BYTES)
    return {
      repository,
      base,
      head,
      mergeBase: mergeBaseResult.stdout.trim(),
      ...totals(files),
      files,
      patch,
      truncated: patchTruncated || Buffer.byteLength(patchResult.stdout) > MAX_OUTPUT_BYTES,
    }
  }

  async createBranch(
    input: string,
    branchInput: string,
    startPointInput?: string,
  ): Promise<{ repository: string; branch: string; startPoint: string; summary: string }> {
    const repository = await this.resolveRepository(input)
    const branch = validateRef(branchInput, 'branch')
    const startPoint = validateRef(startPointInput ?? 'HEAD', 'start point')
    const result = await runGit(repository, ['switch', '-c', branch, startPoint])
    return {
      repository,
      branch,
      startPoint,
      summary: safeGitDetail([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')),
    }
  }

  async commit(
    input: string,
    message: string,
    options: { paths?: string[]; includeAll?: boolean } = {},
  ): Promise<{ repository: string; commit: string; summary: string }> {
    const repository = await this.resolveRepository(input)
    const trimmed = message.trim()
    if (!trimmed || trimmed.length > 10_000 || trimmed.includes('\0')) {
      throw new GitWorkspaceError('invalid_git_input', 'message must contain 1-10000 characters', 400)
    }
    if (options.includeAll && options.paths?.length) {
      throw new GitWorkspaceError('invalid_git_input', 'include_all and paths cannot be combined', 400)
    }
    if (options.paths && options.paths.length > 500) {
      throw new GitWorkspaceError('invalid_git_input', 'paths cannot contain more than 500 entries', 400)
    }
    if (options.paths?.length) {
      const paths = options.paths.map(validateRelativePath)
      await runGit(repository, ['add', '--', ...paths])
    } else if (options.includeAll) {
      await runGit(repository, ['add', '--all', '--', '.'])
    }
    const result = await runGit(repository, ['commit', '--no-verify', '--no-gpg-sign', '-m', trimmed], { timeoutMs: 60_000 })
    const commit = (await runGit(repository, ['rev-parse', 'HEAD'])).stdout.trim()
    return { repository, commit, summary: result.stdout.trim() }
  }

  async push(
    input: string,
    remoteInput = 'origin',
    branchInput?: string,
  ): Promise<{ repository: string; remote: string; branch: string; summary: string }> {
    const repository = await this.resolveRepository(input)
    const remote = validateRemote(remoteInput)
    const currentBranch = (await runGit(repository, ['branch', '--show-current'])).stdout.trim()
    if (!branchInput && !currentBranch) {
      throw new GitWorkspaceError('invalid_git_input', 'branch is required while HEAD is detached', 400)
    }
    const branch = validateRef(branchInput ?? currentBranch, 'branch')
    const result = await runGit(
      repository,
      ['push', '--no-verify', '--porcelain', remote, `${branch}:${branch}`],
      { timeoutMs: 120_000 },
    )
    return {
      repository,
      remote,
      branch,
      summary: safeGitDetail([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')),
    }
  }

  async createPullRequest(
    input: string,
    options: { title: string; body: string; base: string; head?: string; draft?: boolean },
  ): Promise<GitPullRequest> {
    const repository = await this.resolveRepository(input)
    const title = options.title.trim()
    const body = options.body.trim()
    if (!title || title.length > 500 || title.includes('\0')) {
      throw new GitWorkspaceError('invalid_git_input', 'title must contain 1-500 characters', 400)
    }
    if (body.length > 50_000 || body.includes('\0')) {
      throw new GitWorkspaceError('invalid_git_input', 'body must contain at most 50000 characters', 400)
    }
    const base = validateRef(options.base, 'base')
    const currentBranch = (await runGit(repository, ['branch', '--show-current'])).stdout.trim()
    const head = validateRef(options.head ?? currentBranch, 'head')
    if (base === head) {
      throw new GitWorkspaceError('invalid_git_input', 'head must differ from base', 400)
    }
    const createArgs = [
      'pr', 'create',
      '--base', base,
      '--head', head,
      '--title', title,
      '--body', body,
      ...(options.draft ? ['--draft'] : []),
    ]
    const created = await runProgram(this.githubCli, repository, createArgs, { timeoutMs: 120_000 })
    const url = /https:\/\/[^\s]+\/pull\/\d+/.exec(`${created.stdout}\n${created.stderr}`)?.[0]
    if (!url) {
      throw new GitWorkspaceError('git_failed', 'GitHub CLI did not return a pull request URL', 502)
    }
    const viewed = await runProgram(this.githubCli, repository, [
      'pr', 'view', url,
      '--json', 'number,url,title,state,baseRefName,headRefName',
    ], { timeoutMs: 30_000 })
    let detail: {
      number?: unknown
      url?: unknown
      title?: unknown
      state?: unknown
      baseRefName?: unknown
      headRefName?: unknown
    }
    try {
      detail = JSON.parse(viewed.stdout) as typeof detail
    } catch {
      throw new GitWorkspaceError('git_failed', 'GitHub CLI returned invalid pull request details', 502)
    }
    if (
      typeof detail.number !== 'number'
      || typeof detail.url !== 'string'
      || typeof detail.title !== 'string'
      || typeof detail.state !== 'string'
      || typeof detail.baseRefName !== 'string'
      || typeof detail.headRefName !== 'string'
    ) {
      throw new GitWorkspaceError('git_failed', 'GitHub CLI returned incomplete pull request details', 502)
    }
    return {
      repository,
      number: detail.number,
      url: detail.url,
      title: detail.title,
      state: detail.state,
      base: detail.baseRefName,
      head: detail.headRefName,
    }
  }
}
