import { RemoteJourneyClient } from '../../../../src/services/remoteJourney.ts'
import assert from 'node:assert/strict'
const nativeFetch = globalThis.fetch
const base = process.env.OPENSADDLE_CAPACITY_FIXTURE_URL ?? 'http://127.0.0.1:8878'
const project = 'interface-capacity'
const runId = process.env.OPENSADDLE_CAPACITY_FIXTURE_RUN_ID ?? 'run_e347e532b4e3475ba06837a6911dc4b4'
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  const subject = headers.get('X-OpenSaddle-User')
  headers.delete('X-OpenSaddle-User')
  headers.set('x-opensaddle-subject', subject ?? '')
  headers.set('x-opensaddle-roles', subject === 'interface-owner' ? 'owner' : 'member')
  return nativeFetch(input, { ...init, headers })
}) as typeof fetch
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  const owner = new RemoteJourneyClient(base, () => 'interface-owner', undefined, true)
  const member = new RemoteJourneyClient(base, () => 'interface-member', undefined, true)
  let limitsReduced = false
  try {
    const before = await (owner as any).capacity(project)
    const memberRead = await (member as any).capacity(project)
    let memberConfigureDenied = false
    try { await member.configureCapacity(project, { cpuMillicores: 500, memoryMiB: 256, maxConcurrency: 1 }) } catch { memberConfigureDenied = true }
    assert.equal(memberConfigureDenied, true)
    assert.deepEqual(before.usage, { cpuMillicores: 1000, memoryMiB: 512, concurrency: 1 })
    assert.equal(before.reservationCount, 1)
    assert.deepEqual(memberRead.limits, before.limits)
    await owner.configureCapacity(project, { cpuMillicores: 500, memoryMiB: 256, maxConcurrency: 1 })
    limitsReduced = true
    const reduced = await (owner as any).capacity(project)
    assert.equal(reduced.state, 'overcommitted')
    assert.equal(reduced.admissionState, 'blocked')
    assert.equal(reduced.reservationCount, 1)
    assert.deepEqual(reduced.available, { cpuMillicores: 0, memoryMiB: 0, concurrency: 0 })
    await owner.configureCapacity(project, { cpuMillicores: 2000, memoryMiB: 1024, maxConcurrency: 2 })
    limitsReduced = false
    const restored = await (owner as any).capacity(project)
    assert.equal(restored.state, 'configured')
    assert.equal(restored.reservationCount, 1)
    await owner.cancel(runId)
    let released = await (owner as any).capacity(project)
    for (let attempt = 0; attempt < 15 && released.reservationCount !== 0; attempt++) { await sleep(1000); released = await (owner as any).capacity(project) }
    assert.deepEqual(released.usage, { cpuMillicores: 0, memoryMiB: 0, concurrency: 0 })
    assert.equal(released.reservationCount, 0)
    console.log(JSON.stringify({actualHttp:true,project,runId,before:{state:before.state,admission:before.admissionState,usage:before.usage,reservations:before.reservationCount},memberRead:{limits:memberRead.limits,reservations:memberRead.reservationCount},memberConfigureDenied,reduced:{state:reduced.state,admission:reduced.admissionState,usage:reduced.usage,available:reduced.available,reservations:reduced.reservationCount,projectExcess:reduced.overcommit?.project},restored:{state:restored.state,admission:restored.admissionState,usage:restored.usage,reservations:restored.reservationCount},released:{state:released.state,admission:released.admissionState,usage:released.usage,reservations:released.reservationCount,recentReleases:released.recentReleaseCount}}))
  } finally {
    if (limitsReduced) await owner.configureCapacity(project, { cpuMillicores: 2000, memoryMiB: 1024, maxConcurrency: 2 })
    globalThis.fetch = nativeFetch
  }
}
void main().catch(reason => { console.error(reason); process.exitCode = 1 })
