import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { it } from 'node:test'
import { applyDiffHunk, captureDiffFromSnapshot, captureWorktreeSnapshot, rejectDiffHunk } from '../src/diffCapture.js'

const exec = promisify(execFile)

async function git(repository: string, ...args: string[]): Promise<void> {
  await exec('git', args, { cwd: repository })
}

it('captures only changes made after the run baseline in an already-dirty worktree', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'opensaddle-run-diff-'))
  try {
    await git(repository, 'init', '-q')
    await git(repository, 'config', 'user.name', 'OpenSaddle Test')
    await git(repository, 'config', 'user.email', 'test@opensaddle.local')
    await writeFile(join(repository, 'existing.txt'), 'committed\n')
    await writeFile(join(repository, 'run.txt'), 'before\n')
    await git(repository, 'add', '.')
    await git(repository, 'commit', '-qm', 'initial')

    await writeFile(join(repository, 'existing.txt'), 'pre-existing user change\n')
    await writeFile(join(repository, 'untracked-before.txt'), 'user draft\n')
    const baseline = await captureWorktreeSnapshot(repository)

    await writeFile(join(repository, 'run.txt'), 'after agent\n')
    await writeFile(join(repository, 'created-by-agent.txt'), 'new\n')
    const files = await captureDiffFromSnapshot(repository, baseline)

    assert.deepEqual(files.map((file) => file.path).sort(), ['created-by-agent.txt', 'run.txt'])
    assert.match(files.find((file) => file.path === 'run.txt')?.patch ?? '', /after agent/)
    assert.doesNotMatch(files.map((file) => file.patch).join('\n'), /pre-existing user change|user draft/)
    assert.equal(await readFile(join(repository, 'existing.txt'), 'utf8'), 'pre-existing user change\n')
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})

it('reverts one reviewed hunk without discarding other run changes', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'opensaddle-hunk-review-'))
  try {
    await git(repository, 'init', '-q')
    await git(repository, 'config', 'user.name', 'OpenSaddle Test')
    await git(repository, 'config', 'user.email', 'test@opensaddle.local')
    const original = Array.from({ length: 32 }, (_, index) => `line ${index + 1}`)
    await writeFile(join(repository, 'review.txt'), `${original.join('\n')}\n`)
    await git(repository, 'add', '.')
    await git(repository, 'commit', '-qm', 'initial')

    const baseline = await captureWorktreeSnapshot(repository)
    const changed = [...original]
    changed[1] = 'agent changed line 2'
    changed[27] = 'agent changed line 28'
    await writeFile(join(repository, 'review.txt'), `${changed.join('\n')}\n`)
    const files = await captureDiffFromSnapshot(repository, baseline)
    const reviewFile = files.find((file) => file.path === 'review.txt')

    assert.ok(reviewFile)
    assert.equal(reviewFile.patch.split('\n').filter((line) => line.startsWith('@@')).length, 2)
    await rejectDiffHunk(repository, files, 'review.txt', 0)
    const afterFirstRejection = await readFile(join(repository, 'review.txt'), 'utf8')
    assert.match(afterFirstRejection, /line 2/)
    assert.doesNotMatch(afterFirstRejection, /^agent changed line 2$/m)
    assert.match(afterFirstRejection, /^agent changed line 28$/m)

    await rejectDiffHunk(repository, files, 'review.txt', 1)
    assert.equal(await readFile(join(repository, 'review.txt'), 'utf8'), `${original.join('\n')}\n`)
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})

it('promotes selected review hunks without applying unaccepted changes', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'opensaddle-hunk-promotion-'))
  try {
    await git(repository, 'init', '-q')
    await git(repository, 'config', 'user.name', 'OpenSaddle Test')
    await git(repository, 'config', 'user.email', 'test@opensaddle.local')
    const original = Array.from({ length: 32 }, (_, index) => `line ${index + 1}`)
    await writeFile(join(repository, 'review.txt'), `${original.join('\n')}\n`)
    await git(repository, 'add', '.')
    await git(repository, 'commit', '-qm', 'initial')

    const baseline = await captureWorktreeSnapshot(repository)
    const changed = [...original]
    changed[1] = 'agent changed line 2'
    changed[27] = 'agent changed line 28'
    await writeFile(join(repository, 'review.txt'), `${changed.join('\n')}\n`)
    const files = await captureDiffFromSnapshot(repository, baseline)

    await writeFile(join(repository, 'review.txt'), `${original.join('\n')}\n`)
    await applyDiffHunk(repository, files, 'review.txt', 0)
    const afterFirstAcceptance = await readFile(join(repository, 'review.txt'), 'utf8')
    assert.match(afterFirstAcceptance, /^agent changed line 2$/m)
    assert.doesNotMatch(afterFirstAcceptance, /^agent changed line 28$/m)

    await applyDiffHunk(repository, files, 'review.txt', 1)
    assert.equal(await readFile(join(repository, 'review.txt'), 'utf8'), `${changed.join('\n')}\n`)
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})
