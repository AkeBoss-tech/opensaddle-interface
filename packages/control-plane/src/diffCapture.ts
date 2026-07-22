import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface CapturedDiffFile {
  path: string
  add: number
  del: number
  patch: string
}

async function git(workspacePath: string, args: string[], input?: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('git', args, { cwd: workspacePath, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
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

export async function captureDiff(workspacePath: string): Promise<CapturedDiffFile[]> {
  let output = ''
  try {
    output = await git(workspacePath, ['diff', '--no-ext-diff', '--unified=3', '--', '.'])
  } catch {
    return []
  }
  if (!output.trim()) return []
  const tracked = output
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

export async function rejectDiffHunk(
  workspacePath: string,
  files: CapturedDiffFile[],
  filePath: string,
  hunkIndex: number,
): Promise<void> {
  const file = files.find((candidate) => candidate.path === filePath)
  if (!file) throw new Error('Diff file not found')
  const lines = file.patch.split('\n')
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'))
  if (firstHunk < 0) throw new Error('Diff has no hunks')
  const headers = lines.slice(0, firstHunk)
  const starts = lines
    .map((line, index) => line.startsWith('@@') ? index : -1)
    .filter((index) => index >= 0)
  const start = starts[hunkIndex]
  if (start === undefined) throw new Error('Diff hunk not found')
  const end = starts[hunkIndex + 1] ?? lines.length
  const patch = [...headers, ...lines.slice(start, end), ''].join('\n')
  await git(workspacePath, ['apply', '--reverse', '--recount', '-'], patch)
}
