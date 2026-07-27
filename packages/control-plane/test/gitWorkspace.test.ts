import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { GitWorkspaceError, GitWorkspaceService } from '../src/gitWorkspace.js'

const exec = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })).stdout.trim()
}

async function repository(): Promise<{ root: string; repo: string; service: GitWorkspaceService }> {
  const root = await mkdtemp(join(tmpdir(), 'opensaddle-git-'))
  const repo = join(root, 'repo')
  await mkdir(repo)
  await git(repo, 'init', '--initial-branch=main')
  await git(repo, 'config', 'user.name', 'OpenSaddle Test')
  await git(repo, 'config', 'user.email', 'opensaddle@example.test')
  await writeFile(join(repo, 'README.md'), 'one\n')
  await git(repo, 'add', 'README.md')
  await git(repo, 'commit', '-m', 'Initial')
  return { root, repo, service: new GitWorkspaceService([root]) }
}

test('reports branch, worktree changes, and numstat totals', async () => {
  const fixture = await repository()
  try {
    await writeFile(join(fixture.repo, 'README.md'), 'one\ntwo\n')
    await writeFile(join(fixture.repo, 'new file.txt'), 'new\n')
    const result = await fixture.service.status(fixture.repo)
    assert.equal(result.repository, await realpath(fixture.repo))
    assert.equal(result.branch, 'main')
    assert.equal(result.detached, false)
    assert.equal(result.clean, false)
    assert.equal(result.additions, 1)
    assert.equal(result.deletions, 0)
    assert.equal(result.files.some((file) => file.path === 'README.md' && file.modified), true)
    assert.equal(result.files.some((file) => file.path === 'new file.txt' && file.untracked), true)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('compares commits using validated refs and returns a bounded patch', async () => {
  const fixture = await repository()
  try {
    await git(fixture.repo, 'checkout', '-b', 'feature')
    await writeFile(join(fixture.repo, 'README.md'), 'one\ntwo\n')
    await git(fixture.repo, 'add', 'README.md')
    await git(fixture.repo, 'commit', '-m', 'Feature')
    const result = await fixture.service.compare(fixture.repo, 'main', 'feature')
    assert.equal(result.base, 'main')
    assert.equal(result.head, 'feature')
    assert.equal(result.additions, 1)
    assert.equal(result.deletions, 0)
    assert.equal(result.files[0]?.path, 'README.md')
    assert.match(result.patch, /\+two/)
    assert.equal(result.truncated, false)
    await assert.rejects(
      fixture.service.compare(fixture.repo, '--output=/tmp/unsafe', 'feature'),
      (error: unknown) => error instanceof GitWorkspaceError && error.code === 'invalid_git_input',
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('commits selected paths and pushes an explicit branch to a named remote', async () => {
  const fixture = await repository()
  const remote = join(fixture.root, 'remote.git')
  try {
    await git(fixture.root, 'init', '--bare', remote)
    await git(fixture.repo, 'remote', 'add', 'origin', remote)
    await writeFile(join(fixture.repo, 'README.md'), 'committed\n')
    await writeFile(join(fixture.repo, 'not-committed.txt'), 'left behind\n')
    const commit = await fixture.service.commit(fixture.repo, 'Selected change', { paths: ['README.md'] })
    assert.match(commit.commit, /^[0-9a-f]{40}$/)
    assert.equal(await git(fixture.repo, 'show', '--format=', '--name-only', 'HEAD'), 'README.md')
    const status = await fixture.service.status(fixture.repo)
    assert.equal(status.files.some((file) => file.path === 'not-committed.txt' && file.untracked), true)

    const pushed = await fixture.service.push(fixture.repo, 'origin', 'main')
    assert.equal(pushed.remote, 'origin')
    assert.equal(pushed.branch, 'main')
    assert.equal(await git(remote, 'rev-parse', 'refs/heads/main'), commit.commit)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('rejects repositories outside configured roots and escaping commit paths', async () => {
  const fixture = await repository()
  const outside = await repository()
  try {
    await assert.rejects(
      fixture.service.status(outside.repo),
      (error: unknown) => error instanceof GitWorkspaceError && error.code === 'repo_not_allowed',
    )
    await assert.rejects(
      fixture.service.commit(fixture.repo, 'unsafe', { paths: ['../outside.txt'] }),
      (error: unknown) => error instanceof GitWorkspaceError && error.code === 'invalid_git_input',
    )
  } finally {
    await Promise.all([
      rm(fixture.root, { recursive: true, force: true }),
      rm(outside.root, { recursive: true, force: true }),
    ])
  }
})
