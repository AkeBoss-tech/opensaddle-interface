import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { discoverLocalProjects } from '../electron/projectDiscovery.ts'
import { resetTokenPriceCatalogForTests } from '../electron/tokenPricing.ts'

async function json(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}

test('discovers, deduplicates, and labels Codex, Cursor, and Claude project roots', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'opensaddle-discovery-'))
  const previousPricingFile = process.env.OPENSADDLE_MODEL_PRICING_FILE
  try {
    const shared = path.join(home, 'work', 'shared')
    const cursorOnly = path.join(home, 'work', 'cursor-only')
    const claudeOnly = path.join(home, 'work', 'claude-only')
    const broad = path.join(home, 'Documents', 'CodingProjects')
    await Promise.all([shared, cursorOnly, claudeOnly, broad].map((folder) => mkdir(folder, { recursive: true })))

    await json(path.join(home, '.codex', '.codex-global-state.json'), {
      'active-workspace-roots': [shared],
      'electron-saved-workspace-roots': [broad, path.join(home, 'missing')],
      'local-projects': { one: { workspaceRoot: shared } },
    })
    const codexDatabase = new DatabaseSync(path.join(home, '.codex', 'state_5.sqlite'))
    const rollout = path.join(home, '.codex', 'sessions', 'session.jsonl')
    await mkdir(path.dirname(rollout), { recursive: true })
    await writeFile(rollout, `${JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1_000, cached_input_tokens: 800, output_tokens: 200, reasoning_output_tokens: 50 } } } })}\n`)
    codexDatabase.exec('CREATE TABLE threads (cwd TEXT, rollout_path TEXT, model TEXT, tokens_used INTEGER, recency_at_ms INTEGER, updated_at INTEGER)')
    codexDatabase.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)').run(shared, rollout, 'gpt-test', 1_200, 50_000, 0)
    codexDatabase.close()
    await json(path.join(home, '.claude.json'), { projects: {
      [shared]: { lastSessionModified: 60_000, lastTotalInputTokens: 200, lastTotalOutputTokens: 300, lastCost: 0.004 },
      [claudeOnly]: {},
      [home]: {},
    } })
    const pricingFile = path.join(home, 'pricing.json')
    await json(pricingFile, { data: [{ id: 'openai/gpt-test', pricing: { prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000002' } }] })
    process.env.OPENSADDLE_MODEL_PRICING_FILE = pricingFile
    resetTokenPriceCatalogForTests()
    await json(path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage', 'one', 'workspace.json'), {
      folder: pathToFileURL(shared).toString(),
    })
    await json(path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage', 'two', 'workspace.json'), {
      folder: pathToFileURL(cursorOnly).toString(),
    })
    await json(path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage', 'remote', 'workspace.json'), {
      folder: 'vscode-remote://example/workspace',
    })

    const projects = await discoverLocalProjects(home)
    const [canonicalClaude, canonicalCursor, canonicalShared] = await Promise.all([claudeOnly, cursorOnly, shared].map((folder) => realpath(folder)))
    assert.deepEqual(projects.map((project) => project.rootPath).sort(), [canonicalClaude, canonicalCursor, canonicalShared].sort())
    assert.deepEqual(projects.find((project) => project.rootPath === canonicalShared)?.sources, ['codex', 'cursor', 'claude'])
    assert.equal(projects.find((project) => project.rootPath === canonicalShared)?.tokenUsage, 1_700)
    assert.equal(projects.find((project) => project.rootPath === canonicalShared)?.estimatedCostUsd, 0.00656)
    assert.equal(projects.find((project) => project.rootPath === canonicalShared)?.estimatedCostUpperBoundUsd, 0.00656)
    assert.equal(projects.find((project) => project.rootPath === canonicalShared)?.costUnpricedTokens, 0)
    assert.deepEqual(projects.find((project) => project.rootPath === canonicalShared)?.tokenUsageSources, ['codex-sessions', 'claude-last-session'])
    const analytics = projects.find((project) => project.rootPath === canonicalShared)?.usageAnalytics
    assert.equal(analytics?.sessions, 2)
    assert.deepEqual(analytics?.models.map(({ label, tokens, sessions }) => ({ label, tokens, sessions })), [
      { label: 'gpt-test', tokens: 1_200, sessions: 1 },
      { label: 'Unknown Claude model', tokens: 500, sessions: 1 },
    ])
    assert.deepEqual(analytics?.harnesses.map(({ label, tokens, sessions }) => ({ label, tokens, sessions })), [
      { label: 'Codex', tokens: 1_200, sessions: 1 },
      { label: 'Claude Code', tokens: 500, sessions: 1 },
    ])
    assert.deepEqual(analytics?.tokenBreakdown, { uncachedInputTokens: 400, cachedInputTokens: 800, cacheWriteInputTokens: 0, outputTokens: 450, reasoningTokens: 50, unclassifiedTokens: 0 })
    assert.deepEqual(analytics?.daily, [{ day: '1970-01-01', tokens: 1_700, sessions: 2, costLowerUsd: 0.00656, costUpperUsd: 0.00656 }])
    assert.deepEqual(analytics?.buckets.map((bucket) => ({ model: bucket.modelLabel, harness: bucket.harnessLabel, tokens: bucket.tokens, cached: bucket.tokenBreakdown.cachedInputTokens, cost: bucket.costLowerUsd })), [
      { model: 'gpt-test', harness: 'Codex', tokens: 1_200, cached: 800, cost: 0.00256 },
      { model: 'Unknown Claude model', harness: 'Claude Code', tokens: 500, cached: 0, cost: 0.004 },
    ])
    assert.equal(new Set(analytics?.buckets.map((bucket) => bucket.sessionKey)).size, 2)
    assert.ok((projects.find((project) => project.rootPath === canonicalShared)?.lastSeenAt ?? 0) >= 60_000)
    assert.deepEqual(projects.find((project) => project.rootPath === canonicalCursor)?.sources, ['cursor'])
    assert.equal(projects.find((project) => project.rootPath === canonicalCursor)?.tokenUsage, null)
    assert.ok(projects.every((project) => project.id.startsWith('discovered-')))
  } finally {
    if (previousPricingFile === undefined) delete process.env.OPENSADDLE_MODEL_PRICING_FILE
    else process.env.OPENSADDLE_MODEL_PRICING_FILE = previousPricingFile
    resetTokenPriceCatalogForTests()
    await rm(home, { recursive: true, force: true })
  }
})

test('indexes complete Claude session history and Cursor session metadata without inventing Cursor tokens', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'opensaddle-session-history-'))
  const previousPricingFile = process.env.OPENSADDLE_MODEL_PRICING_FILE
  try {
    const claudeProject = path.join(home, 'work', 'claude-history')
    const cursorProject = path.join(home, 'work', 'cursor-history')
    await Promise.all([claudeProject, cursorProject].map((folder) => mkdir(folder, { recursive: true })))
    await json(path.join(home, '.claude.json'), { projects: {
      [claudeProject]: { lastSessionModified: 99_000, lastTotalInputTokens: 999, lastTotalOutputTokens: 999 },
    } })
    const claudeSessions = path.join(home, '.claude', 'projects', 'claude-history')
    await mkdir(claudeSessions, { recursive: true })
    const claudeEvent = (sessionId: string, timestamp: string, input: number, cached: number, output: number) => JSON.stringify({
      type: 'assistant', uuid: `${sessionId}-event`, sessionId, cwd: claudeProject, timestamp,
      message: { model: 'claude-opus-test', usage: { input_tokens: input, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: output } },
    })
    await Promise.all([
      writeFile(path.join(claudeSessions, 'session-one.jsonl'), `${claudeEvent('one', '2026-08-20T12:00:00.000Z', 10, 90, 20)}\n`),
      writeFile(path.join(claudeSessions, 'session-two.jsonl'), `${claudeEvent('two', '2026-08-21T12:00:00.000Z', 20, 180, 40)}\n`),
    ])
    const pricingFile = path.join(home, 'pricing.json')
    await json(pricingFile, { data: [{ id: 'anthropic/claude-opus-test', pricing: { prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000002' } }] })
    process.env.OPENSADDLE_MODEL_PRICING_FILE = pricingFile
    resetTokenPriceCatalogForTests()

    const cursorStorage = path.join(home, 'Library', 'Application Support', 'Cursor', 'User')
    await json(path.join(cursorStorage, 'workspaceStorage', 'cursor-workspace', 'workspace.json'), { folder: pathToFileURL(cursorProject).toString() })
    const cursorDatabasePath = path.join(cursorStorage, 'globalStorage', 'state.vscdb')
    await mkdir(path.dirname(cursorDatabasePath), { recursive: true })
    const cursorDatabase = new DatabaseSync(cursorDatabasePath)
    cursorDatabase.exec('CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, recency INTEGER, checkpointAt INTEGER, value TEXT)')
    cursorDatabase.exec('CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)')
    const insertHeader = cursorDatabase.prepare('INSERT INTO composerHeaders VALUES (?, ?, ?, ?, 0, 0, ?, NULL, ?)')
    const insertData = cursorDatabase.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)')
    const header = (id: string, createdAt: number) => JSON.stringify({ composerId: id, createdAt, isDraft: false, workspaceIdentifier: { uri: { fsPath: cursorProject } } })
    insertHeader.run('cursor-one', 'cursor-workspace', 1_700_000_000_000, 1_700_000_010_000, 1_700_000_010_000, header('cursor-one', 1_700_000_000_000))
    insertHeader.run('cursor-two', 'cursor-workspace', 1_700_086_400_000, 1_700_086_410_000, 1_700_086_410_000, header('cursor-two', 1_700_086_400_000))
    insertData.run('composerData:cursor-one', JSON.stringify({ modelConfig: { modelName: 'cursor-model' }, usageData: { 'cursor-model': { costInCents: 259, amount: 1 } } }))
    insertData.run('composerData:cursor-two', JSON.stringify({ modelConfig: { modelName: 'cursor-model' }, usageData: {} }))
    cursorDatabase.close()

    const projects = await discoverLocalProjects(home)
    const [canonicalClaude, canonicalCursor] = await Promise.all([claudeProject, cursorProject].map((folder) => realpath(folder)))
    const claude = projects.find((project) => project.rootPath === canonicalClaude)
    assert.equal(claude?.usageAnalytics.sessions, 2)
    assert.equal(claude?.tokenUsage, 360)
    assert.deepEqual(claude?.tokenUsageSources, ['claude-sessions'])
    assert.equal(claude?.usageAnalytics.buckets.length, 2)
    assert.equal(new Set(claude?.usageAnalytics.buckets.map((bucket) => bucket.sessionKey)).size, 2)
    assert.equal(claude?.usageAnalytics.tokenBreakdown.cachedInputTokens, 270)

    const cursor = projects.find((project) => project.rootPath === canonicalCursor)
    assert.equal(cursor?.usageAnalytics.sessions, 2)
    assert.equal(cursor?.tokenUsage, null)
    assert.deepEqual(cursor?.tokenUsageSources, [])
    assert.equal(cursor?.estimatedCostUsd, 2.59)
    assert.deepEqual(cursor?.costPricingSources, ['cursor-reported'])
    assert.deepEqual(cursor?.usageAnalytics.harnesses.map(({ label, sessions, tokens }) => ({ label, sessions, tokens })), [{ label: 'Cursor', sessions: 2, tokens: 0 }])
    assert.ok(cursor?.usageAnalytics.buckets.every((bucket) => bucket.tokenMeasurement === 'unavailable'))
  } finally {
    if (previousPricingFile === undefined) delete process.env.OPENSADDLE_MODEL_PRICING_FILE
    else process.env.OPENSADDLE_MODEL_PRICING_FILE = previousPricingFile
    resetTokenPriceCatalogForTests()
    await rm(home, { recursive: true, force: true })
  }
})
