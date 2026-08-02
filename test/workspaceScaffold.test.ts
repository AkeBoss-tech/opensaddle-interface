import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveWorkspaceProposal } from '../src/services/workspaceScaffold.ts'
import type { WorkspaceScanSnapshot } from '../src/types/index.ts'

function snapshot(overrides: Partial<WorkspaceScanSnapshot> = {}): WorkspaceScanSnapshot {
  return {
    folderPath: '/projects/acme', folderName: 'acme', directories: [], configPaths: [],
    packageScripts: [], dependencyNames: [], makefile: null, envExamplePaths: [], envExampleVariableNames: [], connectorPaths: [],
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

test('a folder with no connector evidence proposes no detected connectors', () => {
  const proposal = deriveWorkspaceProposal(snapshot())
  assert.deepEqual(proposal.connectors.filter((connector) => connector.status === 'detected'), [])
})

test('a Supabase dependency proposes a detected Supabase connector', () => {
  const proposal = deriveWorkspaceProposal(snapshot({ dependencyNames: ['@supabase/supabase-js'] }))
  assert.equal(proposal.connectors[0]?.label, 'Supabase')
  assert.equal(proposal.connectors[0]?.status, 'detected')
  assert.match(proposal.connectors[0]?.provenance ?? '', /@supabase/)
})

test('production-shaped connector scopes require approval', () => {
  const proposal = deriveWorkspaceProposal(snapshot({ connectorPaths: ['vercel.json'] }))
  const deployScope = proposal.connectors.find((connector) => connector.label === 'Vercel')?.scopes.find((scope) => scope.name === 'Deploy project')
  assert.equal(deployScope?.needsApproval, true)
})

test('drops branches that have been quiet for months and caps the rest', () => {
  const day = 24 * 60 * 60 * 1000
  const scannedAt = 1_800_000_000_000
  const names = Array.from({ length: 40 }, (_, index) => `branch-${index}`)
  const branchActivity: Record<string, number> = {}
  names.forEach((name, index) => {
    // First 20 are recent, the rest are a year stale.
    branchActivity[name] = scannedAt - (index < 20 ? index * day : 365 * day)
  })

  const proposal = deriveWorkspaceProposal({
    scannedAt,
    folderPath: '/repo', folderName: 'repo', directories: [], configPaths: [],
    connectorPaths: [], dependencyNames: [], packageScripts: [], makefile: null,
    envExamplePaths: [], envExampleVariableNames: [],
    git: {
      readable: true, branches: names, branchActivity, commitCount: 1,
      authors: [], hasRemote: false,
    },
  } as never)

  const branches = proposal.channels.filter((channel) => channel.kind === 'branch')
  assert.equal(branches.length, 10, 'stale branches dropped and the rest capped')
  assert.ok(branches.every((branch) => !branch.recommended), 'branch channels are never pre-checked')
  assert.ok(branches.every((branch) => Number(branch.label.split('-')[1]) < 20), 'only recent branches survive')
})
