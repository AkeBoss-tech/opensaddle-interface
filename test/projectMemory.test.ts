import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuthoritativeLocalProjectClient } from '../src/services/authoritativeLocalProjects.ts'
import { ScaffoldProposal } from '../src/features/onboarding/ScaffoldProposal.tsx'
import { ProjectMemoryPanel } from '../src/features/memory/ProjectMemoryPanel.tsx'
import { managedMemoryProjectId, waitForMemoryOperation } from '../src/features/memory/projectMemory.ts'
import { KrailClient } from '../src/services/krailClient.ts'
import { SessionBridgeClient } from '../src/services/sessionBridgeClient.ts'
import type { LocalProjectClient, ProjectMemoryOperation } from '../src/services/contracts.ts'
import type { WorkspaceProposal } from '../src/types/index.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

const operation: ProjectMemoryOperation = {
  operationId: 'op-1', projectId: 'demo', kind: 'initialize', stage: 'initializing', status: 'running',
  createdAt: '2026-08-10T10:00:00Z', updatedAt: '2026-08-10T10:00:00Z', retryable: true,
}

test('authoritative project client maps every managed memory endpoint without writing files directly', async () => {
  const calls: Array<{ path: string; method: string; body?: unknown }> = []
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async (input, init) => {
    const path = input.toString().replace('http://daemon.test', '')
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (path.endsWith('/memory')) return json({ project_id: 'demo', binding: { enabled: false }, provider: { provider: 'krail', detected: false, inspection_mode: 'read_only', root: '/work/demo', status: 'not_configured', runtime: { installed: true, cli_available: true }, capabilities: [] } })
    if (path.endsWith('/memory/init/plan')) return json({ contract_version: 'krail.admin.v1', operation: 'init_plan', operation_id: 'plan-1', status: 'planned', result: { plan: { effects: [], plan_digest: 'sha256:plan' } } })
    if (path.endsWith('/memory/init')) return json({ contract_version: 'krail.admin.v1', operation: 'init', operation_id: 'op-1', status: 'succeeded', result: { status: 'applied' } })
    if (path.endsWith('/memory/doctor')) return json({ contract_version: 'krail.admin.v1', operation: 'doctor', operation_id: 'doctor-1', status: 'succeeded', result: { report: { ok: true, checks: [] } } })
    if (path.endsWith('/memory/reindex')) return json({ contract_version: 'krail.admin.v1', operation: 'reindex', operation_id: 'index-1', status: 'succeeded', result: { status: 'applied' } })
    if (path.endsWith('/memory/operations/op-1')) return json({ contract_version: 'krail.admin.v1', operation: 'init', operation_id: 'op-1', status: 'succeeded', result: { status: 'applied' } })
    if (path.endsWith('/memory/context-brief')) return json({ projectId: 'demo', query: 'why', summary: 'Because', evidence: [], gaps: [], truncated: false, maxItems: 4, maxTotalBytes: 2048 })
    if (path.endsWith('/memory/candidates')) return json({ candidates: [{ candidateId: 'candidate-1', kind: 'claim', title: 'Claim', summary: 'Review me', status: 'candidate', sourceIds: [], createdAt: 'now' }] })
    if (path.endsWith('/memory/candidates/candidate-1/promote')) return json({ candidateId: 'candidate-1', kind: 'claim', title: 'Claim', summary: 'Review me', status: 'promoted', sourceIds: [], createdAt: 'now' })
    return json({ detail: 'unexpected' }, 404)
  })

  assert.equal((await client.memoryStatus('demo')).authority, 'backend')
  assert.equal((await client.memoryInitPlan('demo', { root: '/work/demo' })).planId, 'plan-1')
  await client.memoryInitApply('demo', 'plan-1')
  await client.memoryDoctor('demo')
  await client.memoryReindex('demo')
  await client.memoryOperation('demo', 'op-1')
  await client.memoryContextBrief('demo', { query: 'why', maxItems: 4, maxTotalBytes: 2048 })
  assert.equal((await client.memoryCandidates('demo'))[0]?.candidateId, 'candidate-1')
  await client.reviewMemoryCandidate('demo', { candidateId: 'candidate-1', decision: 'promote', reason: 'Verified' })

  const applyBody = calls.find((call) => call.path.endsWith('/memory/init'))?.body as Record<string, unknown>
  assert.equal(applyBody.plan_id, 'plan-1')
  assert.equal(typeof applyBody.idempotency_key, 'string')
  assert.deepEqual(calls.find((call) => call.path.endsWith('/memory/context-brief'))?.body, { query: 'why', max_items: 4, max_total_bytes: 2048 })
  assert.equal(calls.some((call) => call.path.includes('/file')), false)
})

test('memory status falls back to legacy read-only discovery only on a missing managed route', async () => {
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async (input) => {
    const path = input.toString()
    if (path.endsWith('/memory') || path.endsWith('/memory/status')) return json({ detail: 'missing' }, 404)
    return json({ projectId: 'demo', provider: 'krail', detected: false, inspectionMode: 'read_only', root: '/work/demo', status: 'not_configured', runtime: { installed: false, cliAvailable: false }, capabilities: [] })
  })
  const status = await client.knowledgeStatus('demo')
  assert.equal(status.authority, 'backend')
  assert.equal(status.inspectionMode, 'read_only')
})

test('onboarding proposal previews exact managed-memory effects and progress', () => {
  const proposal: WorkspaceProposal = {
    id: 'proposal', folderPath: '/work/demo', label: 'demo', memberAnalysis: { source: 'git log', reason: 'No authors.' }, notes: [],
    channels: [], members: [], agents: [], connectors: [], permissions: [],
  }
  const html = renderToStaticMarkup(React.createElement(ScaffoldProposal, {
    proposal, creating: true, onCreate: () => {}, memory: { loading: false, error: null, stage: 'indexing', plan: {
      projectId: managedMemoryProjectId('/work/demo'), planId: 'plan-1', state: 'not_configured', root: '/work/demo', summary: 'Initialize KRAIL memory', warnings: ['Large source'], canApply: true,
      effects: [{ id: 'manifest', kind: 'create', target: 'rail.yaml', description: 'Create the managed manifest' }, { id: 'index', kind: 'index', target: 'docs/', description: 'Index documentation' }],
    } },
  }))
  assert.match(html, /Project Memory/)
  assert.match(html, /rail\.yaml/)
  assert.match(html, /Index documentation/)
  assert.match(html, /registering → initializing memory → indexing → ready/)
  assert.match(html, /current: indexing/)
  assert.match(html, /Creating…/)
})

test('operation polling exposes retryable failures and succeeds after indexing', async () => {
  let polls = 0
  const successful = { memoryOperation: async () => {
    polls += 1
    return polls === 1 ? { ...operation, stage: 'indexing' as const } : { ...operation, stage: 'ready' as const, status: 'succeeded' as const }
  } } as LocalProjectClient
  const stages: string[] = []
  const result = await waitForMemoryOperation(successful, 'demo', operation, { intervalMs: 0, onUpdate: (value) => stages.push(value.stage) })
  assert.equal(result.status, 'succeeded')
  assert.deepEqual(stages, ['initializing', 'indexing', 'ready'])

  const failing = { memoryOperation: async () => ({ ...operation, stage: 'failed' as const, status: 'failed' as const, error: 'index unavailable', retryable: true }) } as LocalProjectClient
  await assert.rejects(waitForMemoryOperation(failing, 'demo', operation, { intervalMs: 0 }), (error: Error & { retryable?: boolean }) => error.message === 'index unavailable' && error.retryable === true)
})

test('memory panel has an honest unavailable state and session bridge keeps a narrow compatibility alias', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectMemoryPanel, { projectId: 'demo', notify: () => {} }))
  assert.match(html, /Project Memory unavailable/)
  assert.equal(KrailClient, SessionBridgeClient)
  assert.equal(existsSync('packages/krail'), false)
  assert.equal(existsSync('packages/session-bridge'), true)
  assert.equal(readFileSync('packages/session-bridge/package.json', 'utf8').includes('@opensaddle/session-bridge'), true)
  assert.equal(readFileSync('src/pages/ProjectPage.tsx', 'utf8').includes('data.knowledge'), false)
})
