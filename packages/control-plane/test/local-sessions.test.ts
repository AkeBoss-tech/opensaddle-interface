import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { LocalSessionDiscovery } from '../src/localSessions.js'

it('discovers Codex and Claude session metadata without returning transcript content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opensaddle-local-sessions-'))
  const codexRoot = join(root, 'codex')
  const claudeRoot = join(root, 'claude')
  await mkdir(join(codexRoot, '2026', '07', '27'), { recursive: true })
  await mkdir(join(claudeRoot, 'project'), { recursive: true })
  await writeFile(join(codexRoot, '2026', '07', '27', 'rollout-session.jsonl'), [
    JSON.stringify({
      type: 'session_meta',
      payload: {
        session_id: 'codex-session',
        cwd: '/workspace/codex',
        cli_version: '1.2.3',
        originator: 'Codex Desktop',
      },
    }),
    JSON.stringify({ type: 'response_item', payload: { role: 'user', content: 'private prompt' } }),
  ].join('\n'))
  await writeFile(join(claudeRoot, 'project', 'claude-session.jsonl'), [
    JSON.stringify({
      type: 'queue-operation',
      sessionId: 'claude-session',
    }),
    JSON.stringify({
      type: 'user',
      sessionId: 'claude-session',
      cwd: '/workspace/claude',
      version: '2.1.0',
      gitBranch: 'feature',
      message: { content: 'private prompt' },
    }),
  ].join('\n'))

  try {
    const sessions = await new LocalSessionDiscovery({
      codexRoot,
      claudeRoot,
      maxFiles: 20,
    }).list()
    assert.deepEqual(
      sessions.map(({ provider, sessionId, cwd, version, originator, branch }) => ({
        provider, sessionId, cwd, version, originator, branch,
      })).sort((a, b) => a.provider.localeCompare(b.provider)),
      [
        {
          provider: 'claude',
          sessionId: 'claude-session',
          cwd: '/workspace/claude',
          version: '2.1.0',
          originator: 'Claude Code',
          branch: 'feature',
        },
        {
          provider: 'codex',
          sessionId: 'codex-session',
          cwd: '/workspace/codex',
          version: '1.2.3',
          originator: 'Codex Desktop',
          branch: undefined,
        },
      ],
    )
    assert.equal(JSON.stringify(sessions).includes('private prompt'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
