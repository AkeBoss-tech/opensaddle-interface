/** SCOPED-RENDERER-TRANSPORT-1: production client against the real Core fixture.
 * Usage: node --import tsx scripts/prove-scoped-renderers-live.ts STATE RECEIPT
 * Changes only the disposable fixture's selections and enablements. No UI claim.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RemoteMalleableShellClient } from '../src/services/remoteMalleableShell'
const [state, receipt] = process.argv.slice(2)
assert.ok(state && receipt)
const fixture = JSON.parse(readFileSync(join(state, 'fixture.json'), 'utf8'))
assert.equal(new URL(fixture.base_url).hostname, '127.0.0.1')
let actor = 'owner'
const owner = new RemoteMalleableShellClient(fixture.base_url, () => actor, readFileSync(join(state, 'owner.token'), 'utf8')).scopedRenderers
assert.ok(owner, 'production shell must expose scoped renderer lifecycle')
const member = new RemoteMalleableShellClient(fixture.base_url, () => 'member', readFileSync(join(state, 'member.token'), 'utf8')).scopedRenderers
const outsider = new RemoteMalleableShellClient(fixture.base_url, () => 'outsider', readFileSync(join(state, 'outsider.token'), 'utf8')).scopedRenderers
const checks: string[] = []
for (const scope of [{ kind: 'user', id: 'owner' }, { kind: 'team', id: fixture.team_id }] as const) {
  let environment = await owner.environment(scope)
  assert.equal(environment.revision, 0)
  const catalog = await owner.candidates(scope)
  assert.equal(catalog.activation_supported, false)
  assert.equal(catalog.items.length, 1)
  const candidate = catalog.items[0]
  assert.equal(candidate.package_id, 'dev.opensaddle.' + scope.kind)
  const ref = { package_id: candidate.package_id, version: candidate.package_version, manifest_digest: candidate.manifest_digest, application_id: candidate.application_id }
  const enabled = await owner.enable(scope, ref)
  environment = await owner.select(scope, 0, ref, 'Verify scoped transport')
  assert.equal(environment.revision, 1)
  const content = { ...ref, environment_revision: environment.revision, environment_digest: environment.definition_digest, content_digest: candidate.content_digest }
  assert.match(await (await owner.content(scope, content)).text(), /Scoped transport fixture/)
  await assert.rejects(owner.content(scope, { ...content, environment_digest: '0'.repeat(64) }), /changed/)
  await assert.rejects(owner.select(scope, 0, null, 'Stale revision'), /conflict/)
  const host = await owner.createHost(scope, { ...content, host_id: 'desktop:transport-proof', instance_id: 'main', generation: 1 })
  assert.deepEqual(host.scope, scope)
  assert.equal((await owner.report(scope, host, { sequence: 1, state: 'loading' })).semantic_correctness, 'not_verified')
  await assert.rejects(owner.report(scope, host, { sequence: 1, state: 'ready' }), /stale/)
  assert.equal((await owner.report(scope, host, { sequence: 2, state: 'ready' })).state, 'ready')
  if (scope.kind === 'team') {
    assert.equal((await member.environment(scope)).revision, 1)
    await assert.rejects(member.select(scope, 1, null, 'Member cannot replace Team view'), /manager_required/)
    await assert.rejects(outsider.environment(scope), /not_found/)
    await assert.rejects(member.report(scope, host, { sequence: 3, state: 'ready' }), /stale/)
    const memberHost = await member.createHost(scope, { ...content, host_id: 'desktop:member', instance_id: 'main', generation: 1 })
    assert.equal((await member.report(scope, memberHost, { sequence: 1, state: 'ready' })).state, 'ready')
    checks.push('Team member can host selected view; manager-only selection; outsiders and cross-subject reports denied')
  }
  const pending = owner.environment(scope); actor = 'outsider'
  await assert.rejects(pending, /account changed/); actor = 'owner'
  await owner.disable(scope, ref.package_id, enabled.revision)
  await assert.rejects(owner.content(scope, content), /unavailable/)
  await assert.rejects(owner.report(scope, host, { sequence: 3, state: 'ready' }), /unavailable/)
  const restored = await owner.select(scope, 1, null, 'Restore built-in after disablement')
  assert.deepEqual(restored.definition.applications, [])
  checks.push(`${scope.kind}: signed discovery, exact enable/select/content, host sequence, account fence, disable and fallback`)
}
await assert.rejects(owner.environment({ kind: 'user', id: 'member' }), /account mismatch/)
writeFileSync(receipt, JSON.stringify({ invariant: 'SCOPED-RENDERER-TRANSPORT-1', passed: true, checks, projects_created: false, visual_verification: false, executable_plugin_mounted: false }, null, 2) + '\n')
console.log(JSON.stringify({ passed: true, checks }))
