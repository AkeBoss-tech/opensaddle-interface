import assert from 'node:assert/strict'
import test from 'node:test'
import { scaffoldApply } from '../src/features/onboarding/scaffoldApply.ts'
import type { WorkspaceProposal } from '../src/types/index.ts'

const proposal: WorkspaceProposal = {
  id: 'proposal', folderPath: '/work/acme', label: 'acme', memberAnalysis: { source: 'git log', reason: 'Git log was read.' }, notes: [],
  channels: [{ id: 'channel', label: 'api', provenance: 'api/ · 2 commits', recommended: true, kind: 'directory' }],
  members: [{ id: 'member', label: 'Ada', name: 'Ada Lovelace', email: 'ada@example.test', commitCount: 2, provenance: 'git log', recommended: true, deselectable: true }],
  agents: [{ id: 'agent', label: 'claude agent', harness: 'claude', triggerPath: '.claude/', provenance: 'Detected .claude/', recommended: true }],
  permissions: [{ id: 'permission', label: 'Read repository', scope: 'repository-read', provenance: 'Git remote detected', recommended: true, needsApproval: false }],
}

test('selecting a subset yields only the selected entities', () => {
  const result = scaffoldApply(proposal, new Set(['channel', 'agent']), '/elsewhere/acme')
  assert.deepEqual(result.channels, [{ id: 'channel', title: 'api' }])
  assert.equal(result.members.length, 0)
  assert.equal(result.agents.length, 1)
  assert.equal(result.permissions.length, 0)
})

test('selecting nothing yields no created entities', () => {
  const result = scaffoldApply(proposal, new Set(), '/work/acme')
  assert.deepEqual(result.channels, [])
  assert.deepEqual(result.members, [])
  assert.deepEqual(result.agents, [])
  assert.deepEqual(result.permissions, [])
})

test('created team is folder-backed with the requested root path', () => {
  const result = scaffoldApply(proposal, new Set(['channel']), '/elsewhere/acme')
  assert.equal(result.project.workspaceKind, 'local')
  assert.equal(result.project.local.rootPath, '/elsewhere/acme')
  assert.equal(result.project.local.importedFrom, 'folder')
})
