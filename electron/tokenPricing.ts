import { readFile } from 'node:fs/promises'

export interface TokenUsageMeasurement {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningTokens: number
  /** OpenAI includes cache hits in input_tokens; Anthropic reports them separately. */
  inputAccounting: 'inclusive-cache' | 'exclusive-cache'
}

export interface TokenPriceTier {
  inputUsdPerToken: number
  cachedInputUsdPerToken?: number
  cacheWriteUsdPerToken?: number
  outputUsdPerToken: number
  reasoningUsdPerToken?: number
  minPromptTokens?: number
}

export interface ModelTokenPrice {
  modelId: string
  tiers: TokenPriceTier[]
  source: 'openrouter' | 'configured-file'
  sourceUrl: string
  observedAt: number
}

export interface TokenCostRange {
  lowerUsd: number
  upperUsd: number
}

export interface PublicTokenPrice {
  modelId: string
  source: ModelTokenPrice['source']
  sourceUrl: string
  observedAt: number
  tiers: Array<{
    minPromptTokens?: number
    inputUsdPerMillion: number
    cachedInputUsdPerMillion?: number
    cacheWriteUsdPerMillion?: number
    outputUsdPerMillion: number
    reasoningUsdPerMillion?: number
  }>
}

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
let catalogPromise: Promise<Map<string, ModelTokenPrice>> | undefined

function nonNegative(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function tierFromRecord(value: unknown): TokenPriceTier | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const inputUsdPerToken = nonNegative(record.prompt)
  const outputUsdPerToken = nonNegative(record.completion)
  if (inputUsdPerToken === undefined || outputUsdPerToken === undefined) return null
  return {
    inputUsdPerToken,
    outputUsdPerToken,
    cachedInputUsdPerToken: nonNegative(record.input_cache_read),
    cacheWriteUsdPerToken: nonNegative(record.input_cache_write),
    reasoningUsdPerToken: nonNegative(record.internal_reasoning),
    minPromptTokens: nonNegative(record.min_prompt_tokens ?? record.min_context),
  }
}

export function parseOpenRouterCatalog(value: unknown, source: ModelTokenPrice['source'] = 'openrouter', observedAt = Date.now()): Map<string, ModelTokenPrice> {
  const catalog = new Map<string, ModelTokenPrice>()
  if (!value || typeof value !== 'object' || !Array.isArray((value as { data?: unknown }).data)) return catalog
  for (const item of (value as { data: unknown[] }).data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string') continue
    const rawPricing = record.pricing
    const pricingRecord = rawPricing && typeof rawPricing === 'object' && !Array.isArray(rawPricing)
      ? rawPricing as Record<string, unknown>
      : null
    const rawTiers = Array.isArray(rawPricing)
      ? rawPricing
      : [pricingRecord, ...(Array.isArray(pricingRecord?.overrides) ? pricingRecord.overrides : [])]
    const tiers = rawTiers.flatMap((tier) => {
      const parsed = tierFromRecord(tier)
      return parsed ? [parsed] : []
    }).sort((left, right) => (left.minPromptTokens ?? 0) - (right.minPromptTokens ?? 0))
    if (!tiers.length) continue
    const sourceUrl = source === 'openrouter' ? `${OPENROUTER_MODELS_URL}#${record.id}` : 'configured pricing file'
    const price: ModelTokenPrice = { modelId: record.id, tiers, source, sourceUrl, observedAt }
    catalog.set(record.id.toLowerCase(), price)
  }
  return catalog
}

function priceForTier(usage: TokenUsageMeasurement, tier: TokenPriceTier): number {
  const cachedRead = Math.min(usage.cachedInputTokens, usage.inputAccounting === 'inclusive-cache' ? usage.inputTokens : Number.MAX_SAFE_INTEGER)
  const cachedWrite = Math.min(usage.cacheWriteInputTokens, usage.inputAccounting === 'inclusive-cache' ? Math.max(usage.inputTokens - cachedRead, 0) : Number.MAX_SAFE_INTEGER)
  const uncachedInput = usage.inputAccounting === 'inclusive-cache'
    ? Math.max(usage.inputTokens - cachedRead - cachedWrite, 0)
    : usage.inputTokens
  const reasoningPricedSeparately = tier.reasoningUsdPerToken !== undefined && tier.reasoningUsdPerToken > 0
  const regularOutput = reasoningPricedSeparately ? Math.max(usage.outputTokens - usage.reasoningTokens, 0) : usage.outputTokens
  const usd = uncachedInput * tier.inputUsdPerToken
    + cachedRead * (tier.cachedInputUsdPerToken ?? tier.inputUsdPerToken)
    + cachedWrite * (tier.cacheWriteUsdPerToken ?? tier.inputUsdPerToken)
    + regularOutput * tier.outputUsdPerToken
    + (reasoningPricedSeparately ? usage.reasoningTokens * tier.reasoningUsdPerToken! : 0)
  // Keep monetary comparisons stable while retaining sub-microdollar precision.
  return Math.round(usd * 1_000_000_000_000) / 1_000_000_000_000
}

/** Returns a range when aggregate usage cannot identify which per-request context tier applied. */
export function calculateTokenCostRange(usage: TokenUsageMeasurement, price: ModelTokenPrice): TokenCostRange {
  const candidates = price.tiers.map((tier) => priceForTier(usage, tier))
  return { lowerUsd: Math.min(...candidates), upperUsd: Math.max(...candidates) }
}

export function resolveModelPrice(catalog: Map<string, ModelTokenPrice>, provider: 'openai' | 'anthropic', model: string): ModelTokenPrice | undefined {
  const normalized = model.trim().toLowerCase().replace(/^openai\//, '').replace(/^anthropic\//, '')
  const candidates = [
    `${provider}/${normalized}`,
    normalized,
    ...(normalized === 'gpt-5.6' ? ['openai/gpt-5.6-sol'] : []),
  ]
  for (const candidate of candidates) {
    const exact = catalog.get(candidate)
    if (exact) return exact
  }
  return undefined
}

export async function loadTokenPriceCatalog(): Promise<Map<string, ModelTokenPrice>> {
  if (catalogPromise) return catalogPromise
  catalogPromise = (async () => {
    const configuredFile = process.env.OPENSADDLE_MODEL_PRICING_FILE
    if (configuredFile) {
      const value = await readFile(configuredFile, 'utf8').then(JSON.parse).catch(() => null)
      return parseOpenRouterCatalog(value, 'configured-file')
    }
    if (process.env.OPENSADDLE_DISABLE_PRICE_DISCOVERY === '1') return new Map()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4_000)
    try {
      const response = await fetch(OPENROUTER_MODELS_URL, { signal: controller.signal })
      if (!response.ok) return new Map()
      return parseOpenRouterCatalog(await response.json())
    } catch {
      return new Map()
    } finally {
      clearTimeout(timeout)
    }
  })()
  return catalogPromise
}

export async function listPublicTokenPrices(): Promise<PublicTokenPrice[]> {
  const catalog = await loadTokenPriceCatalog()
  return [...catalog.values()].map((price) => ({
    modelId: price.modelId,
    source: price.source,
    sourceUrl: price.sourceUrl,
    observedAt: price.observedAt,
    tiers: price.tiers.map((tier) => ({
      ...(tier.minPromptTokens === undefined ? {} : { minPromptTokens: tier.minPromptTokens }),
      inputUsdPerMillion: tier.inputUsdPerToken * 1_000_000,
      ...(tier.cachedInputUsdPerToken === undefined ? {} : { cachedInputUsdPerMillion: tier.cachedInputUsdPerToken * 1_000_000 }),
      ...(tier.cacheWriteUsdPerToken === undefined ? {} : { cacheWriteUsdPerMillion: tier.cacheWriteUsdPerToken * 1_000_000 }),
      outputUsdPerMillion: tier.outputUsdPerToken * 1_000_000,
      ...(tier.reasoningUsdPerToken === undefined ? {} : { reasoningUsdPerMillion: tier.reasoningUsdPerToken * 1_000_000 }),
    })),
  })).sort((left, right) => left.modelId.localeCompare(right.modelId))
}

export function resetTokenPriceCatalogForTests(): void {
  catalogPromise = undefined
}
