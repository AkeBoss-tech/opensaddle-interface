import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { AuthoritativeLocalProjectClient } from '../src/services/authoritativeLocalProjects'

// LOCAL-DISCOVERY-ADMISSION-1: slow discovery cannot occupy every browser socket.
// The HTTP endpoint injects transport latency/failure; no domain authority is mocked.
test('startup discovery shares duplicate reads and leaves room for connection health', async () => {
  let active = 0, peak = 0, reads = 0, healthDuringDiscovery = false
  const server = createServer((req, res) => {
    if (req.url === '/api/health') { healthDuringDiscovery = active > 0; res.end('{}'); return }
    if (!req.url?.includes('/harnesses') && !req.url?.endsWith('/rescan')) { res.end(JSON.stringify({ root: '/tmp/project' })); return }
    active++; peak = Math.max(peak, active)
    if (req.url === '/api/harnesses') reads++
    setTimeout(() => { active--; res.setHeader('Content-Type', 'application/json'); if (req.url?.includes('/P2/')) { res.statusCode = 503; res.end('{"detail":"discovery unavailable"}') } else res.end(JSON.stringify(req.url?.includes('/harnesses') ? { harnesses: [] } : { discoveries: {} })) }, 80)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const client = new AuthoritativeLocalProjectClient(base, () => 'owner')
    const jobs = Promise.allSettled([client.harnessCapabilities(), client.harnessCapabilities(), client.refreshHarnessCapabilities(), ...Array.from({ length: 6 }, (_, i) => client.rescan('P' + i))])
    for (let i = 0; i < 100 && active === 0; i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal((await fetch(base + '/api/health')).status, 200)
    const results = await jobs
    assert.equal(peak, 1, 'discovery must not saturate browser connection slots')
    assert.equal(reads, 1, 'concurrent harness reads must share their request')
    assert.equal(healthDuringDiscovery, true)
    assert.equal(results.filter(result => result.status === 'rejected').length, 1)
    assert.equal(results.at(-1)?.status, 'fulfilled', 'a failed scan must release the queue')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
