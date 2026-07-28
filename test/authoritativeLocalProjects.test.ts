import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuthoritativeLocalProjectClient,
  UnsupportedAuthoritativeProjectOperationError,
} from '../src/services/authoritativeLocalProjects.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

test('adapts Python project-domain files, harnesses, and rescans without using legacy endpoints', async () => {
  const paths: string[] = []
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async (input, init) => {
    const path = typeof input === 'string' ? input.replace('http://daemon.test', '') : input.toString().replace('http://daemon.test', '')
    paths.push(`${init?.method ?? 'GET'} ${path}`)
    if (path === '/api/projects' && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { project_id: 'demo', root: '/work/demo' })
      return json({ project_id: 'demo', root: '/work/demo', created_at: '2026-01-01T00:00:00Z' }, 201)
    }
    if (path === '/api/harnesses') return json({ harnesses: [{
      id: 'claude-code', display_name: 'Claude Code', installed: true, executable_path: '/bin/claude', version: '1.2.3', auth_state: 'configured',
      models: [{ id: 'claude-opus' }], capabilities: { streaming: true, tool_support: true, mcp: true, skills: true, reasoning_efforts: ['high'], context_limit: 200_000 },
    }] })
    if (path === '/api/projects/demo') return json({ project_id: 'demo', root: '/work/demo', created_at: '2026-01-01T00:00:00Z' })
    if (path === '/api/projects/demo/files?path=docs') return json({ project_id: 'demo', path: 'docs', items: [{ path: 'docs/guide.md', kind: 'file', size: 4, modified_ns: 1_700_000_000_000_000_000 }] })
    if (path === '/api/projects/demo/file?path=docs%2Fguide.md') return new Response('docs', { headers: { 'X-OpenSaddle-File-Path': 'docs/guide.md' } })
    if (path === '/api/projects/demo/rescan') return json({ project_id: 'demo', discoveries: { instructions: ['AGENTS.md'], skills: ['.codex/skills/review/SKILL.md'], documentation: ['docs/guide.md'], sites: ['sites/docs/config.yml'] } })
    return json({ detail: `unexpected path ${path}` }, 404)
  })

  const harnesses = await client.harnessCapabilities()
  assert.equal(harnesses.harnesses[0]?.id, 'claude')
  assert.equal(harnesses.harnesses[0]?.readiness, 'ready')

  assert.deepEqual(await client.registerProject('demo', '/work/demo'), { projectId: 'demo', root: '/work/demo' })
  const files = await client.listFiles('demo', { path: 'docs', limit: 1 })
  assert.equal(files.root, '/work/demo')
  assert.deepEqual(files.entries[0], { path: 'docs/guide.md', name: 'guide.md', kind: 'file', size: 4, modifiedAt: 1_700_000_000_000 })

  const read = await client.readFile('demo', 'docs/guide.md')
  assert.equal(read.content, 'docs')
  assert.equal(read.bytes, 4)

  const manifest = await client.rescan('demo')
  assert.deepEqual(manifest.counts, { instruction: 1, skill: 1, agent: 0, documentation: 1, site: 1 })
  assert.equal(paths.some((path) => path.includes('managed-artifact') || path.includes('/search')), false)
})

test('does not simulate unsupported legacy local-project features', async () => {
  const client = new AuthoritativeLocalProjectClient('http://daemon.test', () => 'local-admin', undefined, async () => json({}))
  await assert.rejects(client.localSessions('codex'), UnsupportedAuthoritativeProjectOperationError)
  await assert.rejects(client.archiveManagedArtifact('demo', '.codex/skills/review/SKILL.md'), UnsupportedAuthoritativeProjectOperationError)
  await assert.rejects(client.searchFiles('demo', 'review'), UnsupportedAuthoritativeProjectOperationError)
})
