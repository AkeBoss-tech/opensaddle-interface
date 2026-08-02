import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveWorkspaceProposal } from '../src/services/workspaceScaffold.ts'
import type { WorkspaceScanSnapshot } from '../src/types/index.ts'

function snapshot(overrides: Partial<WorkspaceScanSnapshot> = {}): WorkspaceScanSnapshot {
  return {
    folderPath: '/projects/acme', folderName: 'acme', directories: [], configPaths: [],
    packageScripts: [], makefile: null, envExamplePaths: [],
    git: { readable: true, branches: [], commitCount: 0, authors: [], hasRemote: false },
    ...overrides,
  }
}

test('non-git scans propose directory channels, no members, and explain why', () => {
  const proposal = deriveWorkspaceProposal(snapshot({
    directories: ['api', 'web'],
    git: { readable: false, reason: 'No readable git history was found for this folder.', branches: [], commitCount: 0, authors: [], hasRemote: false },
  }))

  assert.deepEqual(proposal.channels.map((channel) => channel.label), ['api', 'web'])
  assert.equal(proposal.members.length, 0)
  assert.match(proposal.memberAnalysis.reason, /No readable git history/)
})

test('skips common generated and dependency directories', () => {
  const proposal = deriveWorkspaceProposal(snapshot({
    directories: ['src', 'node_modules', 'dist', 'build', '.git', 'coverage', 'vendor', 'target', '.venv', '__pycache__'],
  }))

  assert.deepEqual(proposal.channels.map((channel) => channel.label), ['src'])
})

test('collapses same-name git identities and sums their commits', () => {
  const proposal = deriveWorkspaceProposal(snapshot({
    git: {
      readable: true, branches: [], commitCount: 5, hasRemote: false,
      authors: [
        { name: 'Ada Lovelace', email: 'ada@work.test', commitCount: 2 },
        { name: 'Ada Lovelace', email: 'ada@personal.test', commitCount: 3 },
      ],
    },
  }))

  assert.equal(proposal.members.length, 1)
  assert.equal(proposal.members[0]?.commitCount, 5)
  assert.equal(proposal.members[0]?.deselectable, true)
  assert.match(proposal.members[0]?.provenance ?? '', /git log/)
})

test('deploy or publish package scripts require workspace-write approval', () => {
  const proposal = deriveWorkspaceProposal(snapshot({ packageScripts: ['deploy: npm publish'] }))

  assert.deepEqual(proposal.permissions.find((permission) => permission.scope === 'workspace-write'), {
    id: 'permission-workspace-write', label: 'Deploy or publish', scope: 'workspace-write',
    provenance: 'Deploy or publish command detected in package.json or Makefile', recommended: false, needsApproval: true,
  })
})

test('.env.example requires secret-handling approval', () => {
  const proposal = deriveWorkspaceProposal(snapshot({ envExamplePaths: ['.env.example'] }))

  assert.equal(proposal.permissions.find((permission) => permission.scope === 'secret-handling')?.needsApproval, true)
})
