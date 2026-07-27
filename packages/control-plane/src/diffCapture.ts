import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export interface CapturedDiffFile {
  path: string
  add: number
  del: number
  patch: string
}

async function git(
  workspacePath: string,
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: workspacePath,
      env: env ? { ...process.env, ...env } : undefined,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `git exited ${code}`)))
    if (input) child.stdin.end(input)
    else child.stdin.end()
  })
}

function parseDiff(output: string): CapturedDiffFile[] {
  if (!output.trim()) return []
  return output
    .split(/(?=^diff --git )/m)
    .filter((patch) => patch.startsWith('diff --git '))
    .map((patch) => {
      const path = /^\+\+\+ b\/(.+)$/m.exec(patch)?.[1]
        ?? /^diff --git a\/(.+?) b\//m.exec(patch)?.[1]
        ?? 'unknown'
      const lines = patch.split('\n')
      return {
        path,
        add: lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
        del: lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length,
        patch,
      }
    })
}

/**
 * Materialize the current visible worktree as a Git tree without changing the
 * user's real index. This lets a run diff against its exact starting state,
 * even when the project was already dirty before the agent began.
 */
export async function captureWorktreeSnapshot(workspacePath: string): Promise<string> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'opensaddle-index-'))
  const indexPath = join(temporaryDirectory, 'index')
  const env = { GIT_INDEX_FILE: indexPath }
  try {
    try {
      await git(workspacePath, ['rev-parse', '--verify', 'HEAD'])
      await git(workspacePath, ['read-tree', 'HEAD'], undefined, env)
    } catch {
      await git(workspacePath, ['read-tree', '--empty'], undefined, env)
    }
    await git(workspacePath, ['add', '-A', '--', '.'], undefined, env)
    return (await git(workspacePath, ['write-tree'], undefined, env)).trim()
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function captureDiffFromSnapshot(
  workspacePath: string,
  baselineTree: string,
): Promise<CapturedDiffFile[]> {
  if (!/^[0-9a-f]{40,64}$/i.test(baselineTree)) throw new Error('Invalid run baseline')
  const currentTree = await captureWorktreeSnapshot(workspacePath)
  const output = await git(workspacePath, [
    'diff',
    '--no-ext-diff',
    '--unified=3',
    baselineTree,
    currentTree,
    '--',
    '.',
  ])
  return parseDiff(output)
}

export async function captureDiff(workspacePath: string): Promise<CapturedDiffFile[]> {
  let output = ''
  try {
    output = await git(workspacePath, ['diff', '--no-ext-diff', '--unified=3', '--', '.'])
  } catch {
    return []
  }
  const tracked = parseDiff(output)
  let untrackedNames: string[] = []
  try {
    untrackedNames = (await git(workspacePath, ['ls-files', '--others', '--exclude-standard', '-z']))
      .split('\0')
      .filter(Boolean)
  } catch {
    return tracked
  }
  const untracked = await Promise.all(untrackedNames.map(async (path): Promise<CapturedDiffFile | undefined> => {
    try {
      const content = await readFile(resolve(workspacePath, path), 'utf8')
      if (content.includes('\0') || content.length > 1_000_000) return undefined
      const lines = content.replace(/\n$/, '').split('\n')
      const patch = [
        `diff --git a/${path} b/${path}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${path}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`),
        '',
      ].join('\n')
      return { path, add: lines.length, del: 0, patch }
    } catch {
      return undefined
    }
  }))
  return [...tracked, ...untracked.filter((file): file is CapturedDiffFile => Boolean(file))]
}

function selectedDiffHunk(
  files: CapturedDiffFile[],
  filePath: string,
  hunkIndex: number,
): string {
  const file = files.find((candidate) => candidate.path === filePath)
  if (!file) throw new Error('Diff file not found')
  const lines = file.patch.split('\n')
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'))
  if (firstHunk < 0) throw new Error('Diff has no hunks')
  // A captured diff's `index old..new` header describes the whole-file
  // transition. After one hunk is reverted that blob identity is intentionally
  // no longer true, which would prevent resolving a second independent hunk.
  // Per-hunk review relies on contextual patch lines instead.
  const headers = lines.slice(0, firstHunk).filter((line) => !line.startsWith('index '))
  const starts = lines
    .map((line, index) => line.startsWith('@@') ? index : -1)
    .filter((index) => index >= 0)
  const start = starts[hunkIndex]
  if (start === undefined) throw new Error('Diff hunk not found')
  const end = starts[hunkIndex + 1] ?? lines.length
  const hunk = lines.slice(start, end)
  while (hunk.at(-1) === '') hunk.pop()
  return [...headers, ...hunk, ''].join('\n')
}

export async function applyDiffHunk(
  workspacePath: string,
  files: CapturedDiffFile[],
  filePath: string,
  hunkIndex: number,
): Promise<void> {
  await git(workspacePath, ['apply', '--recount', '-'], selectedDiffHunk(files, filePath, hunkIndex))
}

export async function rejectDiffHunk(
  workspacePath: string,
  files: CapturedDiffFile[],
  filePath: string,
  hunkIndex: number,
): Promise<void> {
  await git(workspacePath, ['apply', '--reverse', '--recount', '-'], selectedDiffHunk(files, filePath, hunkIndex))
}
