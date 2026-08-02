import assert from 'node:assert/strict'
import test from 'node:test'
import { scaffoldApply } from '../src/features/onboarding/scaffoldApply.ts'
import type { WorkspaceProposal } from '../src/types/index.ts'

const proposal: WorkspaceProposal = {
  id: 'proposal', folderPath: '/work/acme', label: 'acme', memberAnalysis: { source: 'git log', reason: 'Git log was read.' }, notes: [],
  channels: [{ id: 'channel', label: 'api', provenance: 'api/ · 2 commits', recommended: true, kind: 'directory' }],
  members: [{ id: 'member', label: 'Ada', name: 'Ada Lovelace', email: 'ada@example.test', commitCount: 2, provenance: 'git log', recommended: true, deselectable: true }],
  agents: [{ id: 'agent', label: 'claude agent', harness: 'claude', triggerPath: '.claude/', provenance: 'Detected .claude/', recommended: true }],
  connectors: [{
    id: 'connector-supabase', label: 'Supabase', provenance: 'Dependency matching @supabase/* detected in package.json', recommended: true, status: 'detected',
    scopes: [{ id: 'connector-supabase-read', name: 'Read project data', description: 'Read data.', needsApproval: false }, { id: 'connector-supabase-write', name: 'Modify project data', description: 'Write data.', needsApproval: true }],
  }],
  permissions: [{ id: 'permission', label: 'Read repository', scope: 'repository-read', provenance: 'Git remote detected', recommended: true, needsApproval: false }],
}

test('selecting a subset yields only the selected entities', () => {
  const result = scaffoldApply(proposal, new Set(['channel', 'agent']), '/elsewhere/acme')
  assert.deepEqual(result.channels, [{ id: 'channel', title: 'api' }])
  assert.equal(result.members.length, 0)
  assert.equal(result.agents.length, 1)
  assert.equal(result.permissionGrants.length, 0)
})

test('selecting nothing yields no created entities', () => {
  const result = scaffoldApply(proposal, new Set(), '/work/acme')
  assert.deepEqual(result.channels, [])
  assert.deepEqual(result.members, [])
  assert.deepEqual(result.agents, [])
  assert.deepEqual(result.connectors, [])
  assert.deepEqual(result.permissionGrants, [])
})

test('created team is folder-backed with the requested root path', () => {
  const result = scaffoldApply(proposal, new Set(['channel']), '/elsewhere/acme')
  assert.equal(result.project.workspaceKind, 'local')
  assert.equal(result.project.local.rootPath, '/elsewhere/acme')
  assert.equal(result.project.local.importedFrom, 'folder')
})

test('a selected custom item survives scaffoldApply and remains marked custom', () => {
  const customProposal: WorkspaceProposal = {
    ...proposal,
    channels: [{ id: 'custom-channel', label: 'Marketing', provenance: 'Added by you', recommended: true, custom: true, kind: 'custom' }],
  }
  const result = scaffoldApply(customProposal, new Set(['custom-channel']), '/work/acme')
  assert.deepEqual(result.channels, [{ id: 'custom-channel', title: 'Marketing', custom: true }])
})

test('unselected connector scopes yield no connector grants', () => {
  const result = scaffoldApply(proposal, new Set(['connector-supabase']), '/work/acme')
  assert.deepEqual(result.connectors, [])
  assert.deepEqual(result.permissionGrants, [])
})

test('an unconfigured connector yields no grants', () => {
  const unconfigured = {
    ...proposal,
    connectors: [{
      id: 'connector-github', label: 'GitHub', recommended: false, status: 'unconfigured' as const,
      provenance: 'No evidence was found in the repo; configure this connector before use.', scopes: [],
    }],
  }
  const result = scaffoldApply(unconfigured, new Set(['connector-github']), '/work/acme')
  assert.deepEqual(result.connectors, [])
  assert.deepEqual(result.permissionGrants, [])
})
