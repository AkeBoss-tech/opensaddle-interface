import assert from 'node:assert/strict'
import test from 'node:test'
import { selectPublishFlowStep } from '../src/features/git/publishFlow.ts'
import type { GitStatusResult } from '../src/services/contracts.ts'

function status(patch: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    repository: '/repo',
    branch: 'feature',
    detached: false,
    head: 'abc123',
    upstream: 'origin/feature',
    ahead: 0,
    behind: 0,
    clean: true,
    additions: 0,
    deletions: 0,
    files: [],
    diffFiles: [],
    ...patch,
  }
}

test('publishing moves through repository, commit, push, branch, and pull request gates', () => {
  assert.equal(selectPublishFlowStep({ defaultBase: 'main' }), 'repository')
  assert.equal(selectPublishFlowStep({
    repositoryPath: '/repo',
    status: status({ clean: false, files: [{
      path: 'src/app.ts',
      index: 'M',
      worktree: '.',
      staged: true,
      modified: false,
      untracked: false,
    }] }),
    defaultBase: 'main',
  }), 'commit')
  assert.equal(selectPublishFlowStep({
    repositoryPath: '/repo',
    status: status({ ahead: 2 }),
    defaultBase: 'main',
  }), 'push')
  assert.equal(selectPublishFlowStep({
    repositoryPath: '/repo',
    status: status({ branch: 'main' }),
    defaultBase: 'main',
  }), 'branch')
  assert.equal(selectPublishFlowStep({
    repositoryPath: '/repo',
    status: status({ branch: 'feature' }),
    defaultBase: 'main',
  }), 'pull-request')
})
