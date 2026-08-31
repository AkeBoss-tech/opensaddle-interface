import path from 'node:path'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { calculateTokenCostRange, loadTokenPriceCatalog, resolveModelPrice, type ModelTokenPrice, type TokenUsageMeasurement } from './tokenPricing.js'

export type ProjectDiscoverySource = 'codex' | 'cursor' | 'claude'

export interface DiscoveredLocalProject {
  id: string
  rootPath: string
  name: string
  sources: ProjectDiscoverySource[]
  lastSeenAt: number
  tokenUsage: number | null
  tokenUsageSources: Array<'codex-sessions' | 'claude-sessions' | 'claude-last-session'>
  estimatedCostUsd: number | null
  estimatedCostUpperBoundUsd: number | null
  costPricedTokens: number
  costUnpricedTokens: number
  costPricingSources: Array<'openrouter-live' | 'configured-pricing' | 'claude-reported' | 'cursor-reported'>
  costPricingObservedAt: number | null
  usageAnalytics: ProjectUsageAnalytics
}

interface UsageDimension { key: string; label: string; tokens: number; sessions: number }
interface DailyTokenUsage { day: string; tokens: number; sessions: number; costLowerUsd: number; costUpperUsd: number }
interface TokenBreakdown { uncachedInputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number; outputTokens: number; reasoningTokens: number; unclassifiedTokens: number }
interface ProjectUsageAnalytics { sessions: number; models: UsageDimension[]; harnesses: UsageDimension[]; daily: DailyTokenUsage[]; tokenBreakdown: TokenBreakdown; buckets: UsageBucket[] }
interface UsageBucket { day: string; sessionKey: string; modelKey: string; modelLabel: string; harnessKey: string; harnessLabel: string; sessions: number; tokens: number; costLowerUsd: number; costUpperUsd: number; tokenMeasurement: 'measured' | 'unavailable'; costMeasurement: 'estimated' | 'reported' | 'unavailable'; tokenBreakdown: TokenBreakdown }

const SOURCE_ORDER: ProjectDiscoverySource[] = ['codex', 'cursor', 'claude']

async function readJson(file: string): Promise<unknown> {
  const metadata = await stat(file).catch(() => null)
  if (!metadata?.isFile() || metadata.size > 16 * 1024 * 1024) return null
  return readFile(file, 'utf8').then((text) => JSON.parse(text) as unknown).catch(() => null)
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(strings)
  return []
}

function excludedRoot(rootPath: string, home: string): boolean {
  const broadRoots = new Set([
    home,
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
    path.join(home, 'Documents', 'CodingProjects'),
  ])
  const normalized = rootPath.replaceAll('\\', '/')
  const temporary = normalized.startsWith('/private/tmp/') || normalized.startsWith('/var/folders/')
  return broadRoots.has(rootPath)
    || (temporary && !rootPath.startsWith(home))
    || normalized.includes('/.opensaddle/workspaces/')
    || normalized.includes('/Library/Application Support/opensaddle-desktop/control-plane/workspaces/')
    || path.basename(rootPath).toLowerCase() === 'untitled'
}

async function codexRoots(home: string): Promise<Array<{ root: string; seenAt: number }>> {
  const stateFile = path.join(home, '.codex', '.codex-global-state.json')
  const value = await readJson(stateFile)
  if (!value || typeof value !== 'object') return []
  const state = value as Record<string, unknown>
  const roots = [
    ...strings(state['active-workspace-roots']),
    ...strings(state['electron-saved-workspace-roots']),
    ...strings(state['local-projects']),
  ]
  return roots.filter((root) => path.isAbsolute(root)).map((root) => ({ root, seenAt: 0 }))
}

async function claudeRoots(home: string): Promise<Array<{ root: string; seenAt: number }>> {
  const stateFile = path.join(home, '.claude.json')
  const value = await readJson(stateFile)
  if (!value || typeof value !== 'object') return []
  const projects = (value as Record<string, unknown>).projects
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return []
  return Object.entries(projects as Record<string, unknown>)
    .filter(([root]) => path.isAbsolute(root))
    .map(([root, project]) => {
      const record = project && typeof project === 'object' && !Array.isArray(project)
        ? project as Record<string, unknown>
        : {}
      const lastSessionModified = Number(record.lastSessionModified)
      return { root, seenAt: Number.isFinite(lastSessionModified) ? lastSessionModified : 0 }
    })
}

interface ProjectUsage {
  root: string
  seenAt: number
  tokens: number
  source: 'codex-sessions' | 'claude-sessions' | 'claude-last-session' | 'cursor-sessions'
  costLowerUsd: number
  costUpperUsd: number
  pricedTokens: number
  costPricingSources: Set<'openrouter-live' | 'configured-pricing' | 'claude-reported' | 'cursor-reported'>
  costPricingObservedAt: number
  sessions: number
  models: Map<string, UsageDimension>
  daily: Map<string, DailyTokenUsage>
  tokenBreakdown: TokenBreakdown
  buckets: UsageBucket[]
}

function finiteMetric(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function usageMeasurement(value: unknown, inputAccounting: TokenUsageMeasurement['inputAccounting']): TokenUsageMeasurement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const inputTokens = finiteMetric(record.input_tokens ?? record.inputTokens)
  const outputTokens = finiteMetric(record.output_tokens ?? record.outputTokens)
  if (!inputTokens && !outputTokens) return null
  return {
    inputTokens,
    cachedInputTokens: finiteMetric(record.cached_input_tokens ?? record.cachedInputTokens ?? record.cache_read_input_tokens),
    cacheWriteInputTokens: finiteMetric(record.cache_write_input_tokens ?? record.cacheCreationInputTokens ?? record.cache_creation_input_tokens),
    outputTokens,
    reasoningTokens: finiteMetric(record.reasoning_output_tokens ?? record.reasoningTokens),
    inputAccounting,
  }
}

function emptyTokenBreakdown(): TokenBreakdown {
  return { uncachedInputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningTokens: 0, unclassifiedTokens: 0 }
}

function tokenBreakdown(measurement: TokenUsageMeasurement | null, reportedTotal: number): TokenBreakdown {
  if (!measurement) return { ...emptyTokenBreakdown(), unclassifiedTokens: reportedTotal }
  const cachedInputTokens = Math.min(measurement.cachedInputTokens, measurement.inputAccounting === 'inclusive-cache' ? measurement.inputTokens : Number.MAX_SAFE_INTEGER)
  const cacheWriteInputTokens = Math.min(measurement.cacheWriteInputTokens, measurement.inputAccounting === 'inclusive-cache' ? Math.max(measurement.inputTokens - cachedInputTokens, 0) : Number.MAX_SAFE_INTEGER)
  const uncachedInputTokens = measurement.inputAccounting === 'inclusive-cache'
    ? Math.max(measurement.inputTokens - cachedInputTokens - cacheWriteInputTokens, 0)
    : measurement.inputTokens
  const reasoningTokens = Math.min(measurement.reasoningTokens, measurement.outputTokens)
  const outputTokens = Math.max(measurement.outputTokens - reasoningTokens, 0)
  const classified = uncachedInputTokens + cachedInputTokens + cacheWriteInputTokens + outputTokens + reasoningTokens
  return { uncachedInputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens, reasoningTokens, unclassifiedTokens: Math.max(reportedTotal - classified, 0) }
}

function addBreakdown(target: TokenBreakdown, value: TokenBreakdown): void {
  for (const key of Object.keys(target) as Array<keyof TokenBreakdown>) target[key] += value[key]
}

function addDimension(target: Map<string, UsageDimension>, key: string, label: string, tokens: number, sessions = 1): void {
  const current = target.get(key) ?? { key, label, tokens: 0, sessions: 0 }
  current.tokens += tokens
  current.sessions += sessions
  target.set(key, current)
}

function dayFor(timestamp: number): string | null {
  if (!timestamp) return null
  try { return new Date(timestamp).toISOString().slice(0, 10) } catch { return null }
}

function addDaily(target: Map<string, DailyTokenUsage>, timestamp: number, tokens: number, costLowerUsd: number, costUpperUsd: number): void {
  const day = dayFor(timestamp)
  if (!day) return
  const current = target.get(day) ?? { day, tokens: 0, sessions: 0, costLowerUsd: 0, costUpperUsd: 0 }
  current.tokens += tokens
  current.sessions += 1
  current.costLowerUsd += costLowerUsd
  current.costUpperUsd += costUpperUsd
  target.set(day, current)
}

function addBucket(target: UsageBucket[], value: UsageBucket): void {
  target.push(value)
}

function emptyProjectUsage(root: string, source: ProjectUsage['source']): ProjectUsage {
  return {
    root, seenAt: 0, tokens: 0, source, costLowerUsd: 0, costUpperUsd: 0, pricedTokens: 0,
    costPricingSources: new Set(), costPricingObservedAt: 0, sessions: 0, models: new Map(), daily: new Map(), tokenBreakdown: emptyTokenBreakdown(), buckets: [],
  }
}

async function lastCodexUsage(file: string): Promise<TokenUsageMeasurement | null> {
  const metadata = await stat(file).catch(() => null)
  if (!metadata?.isFile() || metadata.size <= 0) return null
  const handle = await open(file, 'r').catch(() => null)
  if (!handle) return null
  try {
    const length = Math.min(metadata.size, 256 * 1024)
    const buffer = Buffer.allocUnsafe(length)
    await handle.read(buffer, 0, length, metadata.size - length)
    const lines = buffer.toString('utf8').split('\n')
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]
      if (!line?.includes('"token_count"') || !line.includes('"total_token_usage"')) continue
      try {
        const event = JSON.parse(line) as { payload?: { info?: { total_token_usage?: unknown } } }
        const usage = usageMeasurement(event.payload?.info?.total_token_usage, 'inclusive-cache')
        if (usage) return usage
      } catch { /* The tail can begin halfway through one JSON line. */ }
    }
    return null
  } finally {
    await handle.close()
  }
}

function sourceForPrice(price: ModelTokenPrice): 'openrouter-live' | 'configured-pricing' {
  return price.source === 'openrouter' ? 'openrouter-live' : 'configured-pricing'
}

async function codexUsage(home: string, catalog: Map<string, ModelTokenPrice>): Promise<ProjectUsage[]> {
  const databasePath = path.join(home, '.codex', 'state_5.sqlite')
  if (!(await stat(databasePath).catch(() => null))?.isFile()) return []
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const rows = database.prepare(`
        SELECT cwd AS root, rollout_path AS rolloutPath, model, tokens_used AS tokens,
          CASE WHEN recency_at_ms > 0 THEN recency_at_ms ELSE updated_at * 1000 END AS seenAt
        FROM threads
        WHERE cwd <> ''
      `).all() as Array<{ root?: unknown; rolloutPath?: unknown; model?: unknown; tokens?: unknown; seenAt?: unknown }>
      const projects = new Map<string, ProjectUsage>()
      const batchSize = 48
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const measuredRows = await Promise.all(rows.slice(offset, offset + batchSize).map(async (row) => ({
          row,
          measurement: typeof row.rolloutPath === 'string' ? await lastCodexUsage(row.rolloutPath) : null,
        })))
        for (const { row, measurement } of measuredRows) {
          if (typeof row.root !== 'string' || !path.isAbsolute(row.root)) continue
        const tokens = finiteMetric(row.tokens)
        const seenAt = finiteMetric(row.seenAt)
        const current = projects.get(row.root) ?? emptyProjectUsage(row.root, 'codex-sessions')
        current.tokens += tokens
        current.sessions += 1
        current.seenAt = Math.max(current.seenAt, seenAt)
        const model = typeof row.model === 'string' && row.model.trim() ? row.model.trim() : 'Unknown Codex model'
        const modelKey = `codex:${model.toLowerCase()}`
        addDimension(current.models, modelKey, model, tokens)
        addBreakdown(current.tokenBreakdown, tokenBreakdown(measurement, tokens))
        const price = typeof row.model === 'string' ? resolveModelPrice(catalog, 'openai', row.model) : undefined
        let lower = 0
        let upper = 0
        if (price && measurement) {
          const cost = calculateTokenCostRange(measurement, price)
          lower = cost.lowerUsd
          upper = cost.upperUsd
          current.costLowerUsd += lower
          current.costUpperUsd += upper
          current.pricedTokens += tokens
          current.costPricingSources.add(sourceForPrice(price))
          current.costPricingObservedAt = Math.max(current.costPricingObservedAt, price.observedAt)
        }
        addDaily(current.daily, seenAt, tokens, lower, upper)
        const day = dayFor(seenAt)
        const sessionKey = createHash('sha256').update(typeof row.rolloutPath === 'string' ? row.rolloutPath : `${row.root}:${seenAt}:${model}`).digest('hex').slice(0, 16)
        if (day) addBucket(current.buckets, {
          day, sessionKey, modelKey, modelLabel: model, harnessKey: 'codex-sessions', harnessLabel: 'Codex', sessions: 1, tokens,
          costLowerUsd: lower, costUpperUsd: upper, tokenMeasurement: measurement ? 'measured' : 'unavailable',
          costMeasurement: price && measurement ? 'estimated' : 'unavailable', tokenBreakdown: tokenBreakdown(measurement, tokens),
        })
        projects.set(row.root, current)
        }
      }
      return [...projects.values()]
    } finally {
      database.close()
    }
  } catch {
    return []
  }
}

async function claudeLatestUsage(home: string, catalog: Map<string, ModelTokenPrice>): Promise<ProjectUsage[]> {
  const value = await readJson(path.join(home, '.claude.json'))
  if (!value || typeof value !== 'object') return []
  const projects = (value as Record<string, unknown>).projects
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return []
  return Object.entries(projects as Record<string, unknown>).flatMap(([root, project]) => {
    if (!path.isAbsolute(root) || !project || typeof project !== 'object' || Array.isArray(project)) return []
    const record = project as Record<string, unknown>
    const measurement = usageMeasurement({
      inputTokens: record.lastTotalInputTokens,
      outputTokens: record.lastTotalOutputTokens,
      cacheCreationInputTokens: record.lastTotalCacheCreationInputTokens,
      cache_read_input_tokens: record.lastTotalCacheReadInputTokens,
    }, 'exclusive-cache')
    const tokens = measurement
      ? measurement.inputTokens + measurement.cachedInputTokens + measurement.cacheWriteInputTokens + measurement.outputTokens
      : 0
    let costLowerUsd = 0
    let costUpperUsd = 0
    let pricedTokens = 0
    const costPricingSources = new Set<'openrouter-live' | 'configured-pricing' | 'claude-reported' | 'cursor-reported'>()
    const models = new Map<string, UsageDimension>()
    const modelMeasurements = record.lastModelUsage && typeof record.lastModelUsage === 'object' && !Array.isArray(record.lastModelUsage)
      ? Object.entries(record.lastModelUsage as Record<string, unknown>).flatMap(([model, rawUsage]) => {
        const modelMeasurement = usageMeasurement(rawUsage, 'exclusive-cache')
        if (!modelMeasurement) return []
        const modelTokens = modelMeasurement.inputTokens + modelMeasurement.cachedInputTokens + modelMeasurement.cacheWriteInputTokens + modelMeasurement.outputTokens
        return [{ model, modelMeasurement, modelTokens }]
      })
      : []
    for (const row of modelMeasurements) addDimension(models, `claude:${row.model.toLowerCase()}`, row.model, row.modelTokens)
    const reportedCost = finiteMetric(record.lastCost)
    let costPricingObservedAt = 0
    if (reportedCost > 0) {
      costLowerUsd = reportedCost
      costUpperUsd = reportedCost
      pricedTokens = tokens
      costPricingSources.add('claude-reported')
      costPricingObservedAt = finiteMetric(record.lastSessionModified)
    } else if (measurement) {
      for (const { model, modelMeasurement, modelTokens } of modelMeasurements) {
        const price = resolveModelPrice(catalog, 'anthropic', model)
        if (!price) continue
        const cost = calculateTokenCostRange(modelMeasurement, price)
        costLowerUsd += cost.lowerUsd
        costUpperUsd += cost.upperUsd
        pricedTokens += modelTokens
        costPricingSources.add(sourceForPrice(price))
        costPricingObservedAt = Math.max(costPricingObservedAt, price.observedAt)
      }
    }
    if (!models.size && tokens) addDimension(models, 'claude:unknown', 'Unknown Claude model', tokens)
    const seenAt = finiteMetric(record.lastSessionModified)
    const daily = new Map<string, DailyTokenUsage>()
    if (tokens) addDaily(daily, seenAt, tokens, costLowerUsd, costUpperUsd)
    const buckets: UsageBucket[] = []
    const day = dayFor(seenAt)
    const sessionKey = createHash('sha256').update(`claude:${root}:${seenAt}`).digest('hex').slice(0, 16)
    if (day && modelMeasurements.length) {
      const modelTotal = modelMeasurements.reduce((sum, row) => sum + row.modelTokens, 0)
      for (const { model, modelMeasurement, modelTokens } of modelMeasurements) {
        const share = modelTotal ? modelTokens / modelTotal : 0
        const price = resolveModelPrice(catalog, 'anthropic', model)
        const calculated = reportedCost === 0 && price ? calculateTokenCostRange(modelMeasurement, price) : null
        addBucket(buckets, {
          day, sessionKey, modelKey: `claude:${model.toLowerCase()}`, modelLabel: model, harnessKey: 'claude-last-session', harnessLabel: 'Claude Code', sessions: 1, tokens: modelTokens,
          costLowerUsd: reportedCost > 0 ? reportedCost * share : calculated?.lowerUsd ?? 0,
          costUpperUsd: reportedCost > 0 ? reportedCost * share : calculated?.upperUsd ?? 0,
          tokenMeasurement: 'measured', costMeasurement: reportedCost > 0 ? 'reported' : calculated ? 'estimated' : 'unavailable',
          tokenBreakdown: tokenBreakdown(modelMeasurement, modelTokens),
        })
      }
    } else if (day && tokens) {
      addBucket(buckets, {
        day, sessionKey, modelKey: 'claude:unknown', modelLabel: 'Unknown Claude model', harnessKey: 'claude-last-session', harnessLabel: 'Claude Code', sessions: 1, tokens,
        costLowerUsd, costUpperUsd, tokenMeasurement: 'measured', costMeasurement: reportedCost > 0 ? 'reported' : costLowerUsd > 0 ? 'estimated' : 'unavailable', tokenBreakdown: tokenBreakdown(measurement, tokens),
      })
    }
    return [{
      root, tokens, seenAt, source: 'claude-last-session' as const, costLowerUsd, costUpperUsd, pricedTokens, costPricingSources, costPricingObservedAt,
      sessions: tokens ? 1 : 0, models, daily, tokenBreakdown: tokenBreakdown(measurement, tokens), buckets,
    }]
  })
}

async function filesNamedJsonl(root: string): Promise<string[]> {
  const files: string[] = []
  const queue = [root]
  while (queue.length) {
    const directory = queue.pop()!
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory()) queue.push(candidate)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(candidate)
    }
  }
  return files
}

interface ClaudeSessionAccumulator {
  usage: ProjectUsage
  modelsSeen: Set<string>
  daysSeen: Set<string>
  buckets: Map<string, UsageBucket>
}

async function claudeSessionUsage(file: string, catalog: Map<string, ModelTokenPrice>): Promise<ProjectUsage[]> {
  const metadata = await stat(file).catch(() => null)
  if (!metadata?.isFile() || metadata.size <= 0) return []
  const sessions = new Map<string, ClaudeSessionAccumulator>()
  const seenEvents = new Set<string>()
  const fallbackTimestamp = metadata.mtimeMs
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        const message = event.message && typeof event.message === 'object' && !Array.isArray(event.message) ? event.message as Record<string, unknown> : null
        const measurement = usageMeasurement(message?.usage, 'exclusive-cache')
        const root = typeof event.cwd === 'string' && path.isAbsolute(event.cwd) ? event.cwd : null
        if (!measurement || !root) continue
        const eventId = typeof event.uuid === 'string' ? event.uuid : ''
        if (eventId && seenEvents.has(eventId)) continue
        if (eventId) seenEvents.add(eventId)
        const timestamp = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : fallbackTimestamp
        const seenAt = Number.isFinite(timestamp) ? timestamp : fallbackTimestamp
        const day = dayFor(seenAt)
        if (!day) continue
        const model = typeof message?.model === 'string' && message.model.trim() ? message.model.trim() : 'Unknown Claude model'
        const modelKey = `claude:${model.toLowerCase()}`
        const tokens = measurement.inputTokens + measurement.cachedInputTokens + measurement.cacheWriteInputTokens + measurement.outputTokens
        const price = model === 'Unknown Claude model' ? undefined : resolveModelPrice(catalog, 'anthropic', model)
        const cost = price ? calculateTokenCostRange(measurement, price) : null
        const accumulator = sessions.get(root) ?? {
          usage: emptyProjectUsage(root, 'claude-sessions'), modelsSeen: new Set<string>(), daysSeen: new Set<string>(), buckets: new Map<string, UsageBucket>(),
        }
        const current = accumulator.usage
        current.tokens += tokens
        current.seenAt = Math.max(current.seenAt, seenAt)
        addDimension(current.models, modelKey, model, tokens, 0)
        accumulator.modelsSeen.add(modelKey)
        addBreakdown(current.tokenBreakdown, tokenBreakdown(measurement, tokens))
        const lower = cost?.lowerUsd ?? 0
        const upper = cost?.upperUsd ?? 0
        current.costLowerUsd += lower
        current.costUpperUsd += upper
        if (cost && price) {
          current.pricedTokens += tokens
          current.costPricingSources.add(sourceForPrice(price))
          current.costPricingObservedAt = Math.max(current.costPricingObservedAt, price.observedAt)
        }
        const daily = current.daily.get(day) ?? { day, tokens: 0, sessions: 0, costLowerUsd: 0, costUpperUsd: 0 }
        daily.tokens += tokens
        daily.costLowerUsd += lower
        daily.costUpperUsd += upper
        current.daily.set(day, daily)
        accumulator.daysSeen.add(day)
        const bucketKey = `${day}:${modelKey}`
        const bucket = accumulator.buckets.get(bucketKey) ?? {
          day,
          sessionKey: createHash('sha256').update(`claude:${file}:${root}`).digest('hex').slice(0, 16),
          modelKey,
          modelLabel: model,
          harnessKey: 'claude-sessions',
          harnessLabel: 'Claude Code',
          sessions: 1,
          tokens: 0,
          costLowerUsd: 0,
          costUpperUsd: 0,
          tokenMeasurement: 'measured' as const,
          costMeasurement: cost ? 'estimated' as const : 'unavailable' as const,
          tokenBreakdown: emptyTokenBreakdown(),
        }
        bucket.tokens += tokens
        bucket.costLowerUsd += lower
        bucket.costUpperUsd += upper
        addBreakdown(bucket.tokenBreakdown, tokenBreakdown(measurement, tokens))
        accumulator.buckets.set(bucketKey, bucket)
        sessions.set(root, accumulator)
      } catch { /* Session records may be concurrently appended or use an older schema. */ }
    }
  } finally {
    lines.close()
  }
  return [...sessions.values()].map((accumulator) => {
    accumulator.usage.sessions = accumulator.usage.tokens > 0 ? 1 : 0
    accumulator.modelsSeen.forEach((key) => {
      const model = accumulator.usage.models.get(key)
      if (model) model.sessions += 1
    })
    accumulator.daysSeen.forEach((day) => {
      const daily = accumulator.usage.daily.get(day)
      if (daily) daily.sessions = 1
    })
    accumulator.usage.buckets = [...accumulator.buckets.values()]
    return accumulator.usage
  })
}

async function claudeUsage(home: string, catalog: Map<string, ModelTokenPrice>): Promise<ProjectUsage[]> {
  const files = await filesNamedJsonl(path.join(home, '.claude', 'projects'))
  const history = (await Promise.all(files.map((file) => claudeSessionUsage(file, catalog)))).flat()
  const fallback = await claudeLatestUsage(home, catalog)
  if (!history.length) return fallback
  const historyRoots = history.map((item) => item.root)
  return [...history, ...fallback.filter((item) => !historyRoots.some((root) => isWithin(root, item.root) || isWithin(item.root, root)))]
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function cursorWorkspaces(home: string): Promise<Map<string, { root: string; seenAt: number }>> {
  const storage = path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage')
  const directories = await readdir(storage, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(directories.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const workspaceFile = path.join(storage, entry.name, 'workspace.json')
    const [value, metadata] = await Promise.all([readJson(workspaceFile), stat(workspaceFile).catch(() => null)])
    if (!value || typeof value !== 'object') return null
    const locator = (value as Record<string, unknown>).folder ?? (value as Record<string, unknown>).workspace
    if (typeof locator !== 'string' || !locator.startsWith('file:')) return null
    try { return { id: entry.name, root: fileURLToPath(locator), seenAt: metadata?.mtimeMs ?? 0 } } catch { return null }
  }))
  return new Map(candidates.filter((candidate): candidate is { id: string; root: string; seenAt: number } => Boolean(candidate)).map((candidate) => [candidate.id, { root: candidate.root, seenAt: candidate.seenAt }]))
}

async function cursorRoots(home: string): Promise<Array<{ root: string; seenAt: number }>> {
  return [...(await cursorWorkspaces(home)).values()]
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  try { return recordValue(JSON.parse(value)) } catch { return null }
}

function cursorRoot(header: Record<string, unknown>): string | null {
  const workspace = recordValue(header.workspaceIdentifier)
  const uri = recordValue(workspace?.uri)
  const direct = uri?.fsPath
  if (typeof direct === 'string' && path.isAbsolute(direct)) return direct
  const repositories = Array.isArray(header.trackedGitRepos) ? header.trackedGitRepos : []
  for (const candidate of repositories) {
    const repoPath = recordValue(candidate)?.repoPath
    if (typeof repoPath === 'string' && path.isAbsolute(repoPath)) return repoPath
  }
  return null
}

function cursorModels(data: Record<string, unknown> | null): Array<{ key: string; label: string; costUsd: number }> {
  const reported = recordValue(data?.usageData)
  const reportedModels = reported ? Object.entries(reported).flatMap(([model, raw]) => {
    const costInCents = finiteMetric(recordValue(raw)?.costInCents)
    return [{ key: `cursor:${model.toLowerCase()}`, label: model, costUsd: costInCents / 100 }]
  }) : []
  if (reportedModels.length) return reportedModels
  const config = recordValue(data?.modelConfig)
  const selected = Array.isArray(config?.selectedModels) ? config.selectedModels : []
  const selectedModel = selected.map((item) => recordValue(item)?.modelId).find((item): item is string => typeof item === 'string' && item !== 'default')
  const configured = selectedModel ?? (typeof config?.modelName === 'string' && config.modelName !== 'default' ? config.modelName : null)
  const label = configured ?? 'Unknown Cursor model'
  return [{ key: `cursor:${label.toLowerCase()}`, label, costUsd: 0 }]
}

async function cursorUsage(home: string): Promise<ProjectUsage[]> {
  const databasePath = path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
  if (!(await stat(databasePath).catch(() => null))?.isFile()) return []
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const rows = database.prepare(`
        SELECT h.composerId, h.workspaceId, h.createdAt, h.lastUpdatedAt, h.value AS header, d.value AS data
        FROM composerHeaders h
        LEFT JOIN cursorDiskKV d ON d.key = 'composerData:' || h.composerId
        WHERE h.composerId <> 'empty-state-draft'
      `).all() as Array<{ composerId?: unknown; workspaceId?: unknown; createdAt?: unknown; lastUpdatedAt?: unknown; header?: unknown; data?: unknown }>
      const workspaces = await cursorWorkspaces(home)
      const projects = new Map<string, ProjectUsage>()
      for (const row of rows) {
        if (typeof row.composerId !== 'string' || typeof row.header !== 'string') continue
        const header = parseJsonRecord(row.header)
        if (!header || header.isDraft === true) continue
        const root = cursorRoot(header) ?? (typeof row.workspaceId === 'string' ? workspaces.get(row.workspaceId)?.root ?? null : null)
        if (!root) continue
        const data = parseJsonRecord(row.data)
        const models = cursorModels(data)
        const createdAt = finiteMetric(row.createdAt)
        const seenAt = Math.max(createdAt, finiteMetric(row.lastUpdatedAt))
        const day = dayFor(createdAt || seenAt)
        if (!day) continue
        const current = projects.get(root) ?? emptyProjectUsage(root, 'cursor-sessions')
        current.sessions += 1
        current.seenAt = Math.max(current.seenAt, seenAt)
        const reportedCost = models.reduce((sum, model) => sum + model.costUsd, 0)
        current.costLowerUsd += reportedCost
        current.costUpperUsd += reportedCost
        if (reportedCost > 0) {
          current.costPricingSources.add('cursor-reported')
          current.costPricingObservedAt = Math.max(current.costPricingObservedAt, seenAt)
        }
        addDaily(current.daily, createdAt || seenAt, 0, reportedCost, reportedCost)
        const sessionKey = createHash('sha256').update(`cursor:${row.composerId}:${root}`).digest('hex').slice(0, 16)
        for (const model of models) {
          addDimension(current.models, model.key, model.label, 0)
          addBucket(current.buckets, {
            day, sessionKey, modelKey: model.key, modelLabel: model.label, harnessKey: 'cursor-sessions', harnessLabel: 'Cursor', sessions: 1, tokens: 0,
            costLowerUsd: model.costUsd, costUpperUsd: model.costUsd, tokenMeasurement: 'unavailable', costMeasurement: model.costUsd > 0 ? 'reported' : 'unavailable', tokenBreakdown: emptyTokenBreakdown(),
          })
        }
        projects.set(root, current)
      }
      return [...projects.values()]
    } finally {
      database.close()
    }
  } catch {
    return []
  }
}

/** Reads local indexes plus usage metadata; prompts, responses, and project bodies are never returned. */
export async function discoverLocalProjects(home = homedir()): Promise<DiscoveredLocalProject[]> {
  const catalog = await loadTokenPriceCatalog()
  const canonicalHome = await realpath(home).catch(() => home)
  const sources = await Promise.all([
    codexRoots(home).then((items) => ({ source: 'codex' as const, items })),
    cursorRoots(home).then((items) => ({ source: 'cursor' as const, items })),
    claudeRoots(home).then((items) => ({ source: 'claude' as const, items })),
  ])
  const discovered = new Map<string, { rootPath: string; sources: Set<ProjectDiscoverySource>; lastSeenAt: number; tokenUsage: number; tokenUsageSources: Set<'codex-sessions' | 'claude-sessions' | 'claude-last-session'>; costLowerUsd: number; costUpperUsd: number; costPricedTokens: number; costPricingSources: Set<'openrouter-live' | 'configured-pricing' | 'claude-reported' | 'cursor-reported'>; costPricingObservedAt: number; sessions: number; models: Map<string, UsageDimension>; harnesses: Map<string, UsageDimension>; daily: Map<string, DailyTokenUsage>; tokenBreakdown: TokenBreakdown; buckets: UsageBucket[] }>()
  for (const group of sources) {
    for (const candidate of group.items) {
      const rootPath = await realpath(candidate.root).catch(() => null)
      if (!rootPath || excludedRoot(rootPath, canonicalHome)) continue
      const metadata = await stat(rootPath).catch(() => null)
      if (!metadata?.isDirectory()) continue
      const current = discovered.get(rootPath) ?? { rootPath, sources: new Set<ProjectDiscoverySource>(), lastSeenAt: 0, tokenUsage: 0, tokenUsageSources: new Set<'codex-sessions' | 'claude-sessions' | 'claude-last-session'>(), costLowerUsd: 0, costUpperUsd: 0, costPricedTokens: 0, costPricingSources: new Set<'openrouter-live' | 'configured-pricing' | 'claude-reported' | 'cursor-reported'>(), costPricingObservedAt: 0, sessions: 0, models: new Map<string, UsageDimension>(), harnesses: new Map<string, UsageDimension>(), daily: new Map<string, DailyTokenUsage>(), tokenBreakdown: emptyTokenBreakdown(), buckets: [] }
      current.sources.add(group.source)
      current.lastSeenAt = Math.max(current.lastSeenAt, candidate.seenAt)
      discovered.set(rootPath, current)
    }
  }
  const usage = await Promise.all([codexUsage(home, catalog), claudeUsage(home, catalog), cursorUsage(home)]).then((groups) => groups.flat())
  for (const metric of usage) {
    const metricRoot = await realpath(metric.root).catch(() => null)
    if (!metricRoot) continue
    const project = [...discovered.values()]
      .filter((candidate) => isWithin(metricRoot, candidate.rootPath))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)[0]
    if (!project) continue
    project.lastSeenAt = Math.max(project.lastSeenAt, metric.seenAt)
    if (metric.tokens > 0) {
      project.tokenUsage += metric.tokens
      if (metric.source !== 'cursor-sessions') project.tokenUsageSources.add(metric.source)
    }
    project.costLowerUsd += metric.costLowerUsd
    project.costUpperUsd += metric.costUpperUsd
    project.costPricedTokens += metric.pricedTokens
    metric.costPricingSources.forEach((source) => project.costPricingSources.add(source))
    project.costPricingObservedAt = Math.max(project.costPricingObservedAt, metric.costPricingObservedAt)
    project.sessions += metric.sessions
    metric.models.forEach((dimension) => addDimension(project.models, dimension.key, dimension.label, dimension.tokens, dimension.sessions))
    const harnessLabel = metric.source === 'codex-sessions' ? 'Codex' : metric.source === 'cursor-sessions' ? 'Cursor' : 'Claude Code'
    addDimension(project.harnesses, metric.source, harnessLabel, metric.tokens, metric.sessions)
    metric.daily.forEach((day) => {
      const current = project.daily.get(day.day) ?? { day: day.day, tokens: 0, sessions: 0, costLowerUsd: 0, costUpperUsd: 0 }
      current.tokens += day.tokens
      current.sessions += day.sessions
      current.costLowerUsd += day.costLowerUsd
      current.costUpperUsd += day.costUpperUsd
      project.daily.set(day.day, current)
    })
    addBreakdown(project.tokenBreakdown, metric.tokenBreakdown)
    project.buckets.push(...metric.buckets)
  }
  return [...discovered.values()].map((candidate) => ({
    id: `discovered-${createHash('sha256').update(candidate.rootPath).digest('hex').slice(0, 16)}`,
    rootPath: candidate.rootPath,
    name: path.basename(candidate.rootPath),
    sources: SOURCE_ORDER.filter((source) => candidate.sources.has(source)),
    lastSeenAt: candidate.lastSeenAt,
    tokenUsage: candidate.tokenUsage || null,
    tokenUsageSources: [...candidate.tokenUsageSources],
    estimatedCostUsd: candidate.costLowerUsd > 0 ? candidate.costLowerUsd : null,
    estimatedCostUpperBoundUsd: candidate.costUpperUsd > 0 ? candidate.costUpperUsd : null,
    costPricedTokens: candidate.costPricedTokens,
    costUnpricedTokens: Math.max(candidate.tokenUsage - candidate.costPricedTokens, 0),
    costPricingSources: [...candidate.costPricingSources],
    costPricingObservedAt: candidate.costPricingObservedAt || null,
    usageAnalytics: {
      sessions: candidate.sessions,
      models: [...candidate.models.values()].sort((left, right) => right.tokens - left.tokens),
      harnesses: [...candidate.harnesses.values()].sort((left, right) => right.tokens - left.tokens),
      daily: [...candidate.daily.values()].sort((left, right) => left.day.localeCompare(right.day)),
      tokenBreakdown: candidate.tokenBreakdown,
      buckets: candidate.buckets.sort((left, right) => left.day.localeCompare(right.day) || left.modelLabel.localeCompare(right.modelLabel)),
    },
  })).sort((left, right) => right.lastSeenAt - left.lastSeenAt || left.name.localeCompare(right.name))
}
