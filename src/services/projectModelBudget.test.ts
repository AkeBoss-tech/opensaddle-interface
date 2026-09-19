import assert from 'node:assert/strict'
import test from 'node:test'
import { initServices } from './index'
import { ProjectModelBudgetClient, ProjectModelBudgetConflict, ProjectModelBudgetDenied } from './projectModelBudget'

const status = (projectId = 'p', revision = 1) => ({
  schema_version: 'opensaddle.project-model-budget.v1', project_id: projectId, scope: 'hosted_model_routes_only',
  viewer_role: 'owner', can_manage: true, state: 'configured', max_reserved_cost_microunits: 20,
  reserved_cost_microunits: 6, revision, configured_by: 'alice', updated_at: '2026-09-19T00:00:00Z',
  recent_changes: [{ revision, previous_max_reserved_cost_microunits: null, max_reserved_cost_microunits: 20,
    configured_by: 'alice', recorded_at: '2026-09-19T00:00:00Z' }],
})

test('PROJECT-MODEL-BUDGET-UI-1: exact revision PUT and Project/identity binding at HTTP client boundary', async t => {
  let identity = 'alice'
  const requests: Array<{ url: string; init: RequestInit }> = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init })
    return Response.json(status())
  })
  const client = new ProjectModelBudgetClient('https://core.example', () => identity, 'operator-token')
  assert.equal((await client.status('p')).reserved_cost_microunits, 6)
  await client.configure('p', 20, 1)
  assert.equal(requests[1].url, 'https://core.example/api/v2/projects/p/model-budget')
  assert.equal(requests[1].init.method, 'PUT')
  assert.deepEqual(JSON.parse(String(requests[1].init.body)), { max_reserved_cost_microunits: 20, expected_revision: 1 })
  assert.equal((requests[1].init.headers as Record<string, string>).Authorization, 'Bearer operator-token')
  assert.throws(() => client.configure('p', Number.MAX_SAFE_INTEGER + 1, 1), /safe interface integer/)
  assert.equal(requests.length, 2)
  t.mock.method(globalThis, 'fetch', async () => Response.json(status('other')))
  await assert.rejects(client.status('p'), /authority changed/)
  t.mock.method(globalThis, 'fetch', async () => { identity = 'bob'; return Response.json(status()) })
  await assert.rejects(client.status('p'), ProjectModelBudgetDenied)
})

test('conflict, permission denial, and oversized Core amounts fail closed without parsing error bodies', async t => {
  const client = new ProjectModelBudgetClient('https://core.example', () => 'alice')
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'private' }, { status: 409 }))
  await assert.rejects(client.configure('p', 10, 1), ProjectModelBudgetConflict)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'private' }, { status: 403 }))
  await assert.rejects(client.status('p'), ProjectModelBudgetDenied)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...status(), reserved_cost_microunits: '9223372036854775807' }))
  await assert.rejects(client.status('p'), /safe interface integer/)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...status(), can_manage: false }))
  await assert.rejects(client.status('p'), /authority/)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...status(), viewer_role: 'auditor', can_manage: false }))
  assert.equal((await client.status('p')).can_manage, false)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...status(), recent_changes: [] }))
  await assert.rejects(client.status('p'), /response/)
})


test('budget UI is negotiated only for the exact hosted route contract and authenticated subject', async t => {
  let capability: unknown, subject: string | undefined = 'owner'
  t.mock.method(globalThis, 'fetch', async (input: string) => new URL(input).pathname === '/api/v2/capabilities'
    ? Response.json({ authenticated_subject: subject, project_model_budget_v1: capability })
    : Response.json({}, { status: 404 }))
  const create = () => initServices({ getGrants: () => [], setGrants: () => {}, currentUserId: 'cached-other', getCurrentUserId: () => 'cached-other', connection: { id: 'fixture', name: 'Fixture', mode: 'remote', baseUrl: 'https://core.example', token: 'session', allowMockFallback: false } })
  const good = { available: true, scope: 'hosted_model_routes_only', configured_per_project: true }
  for (const invalid of [undefined, { ...good, available: false }, { ...good, scope: 'all_provider_spending' }, { ...good, configured_per_project: false }]) {
    capability = invalid; assert.equal((await create()).projectModelBudget, undefined)
  }
  capability = good
  assert.equal((await create()).projectModelBudget?.identity(), 'owner')
  subject = undefined
  assert.equal((await create()).projectModelBudget, undefined)
})
