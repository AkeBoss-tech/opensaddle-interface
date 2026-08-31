import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateTokenCostRange, parseOpenRouterCatalog, resolveModelPrice } from '../electron/tokenPricing.ts'

test('prices uncached input, cache reads, cache writes, and output independently', () => {
  const catalog = parseOpenRouterCatalog({ data: [{
    id: 'anthropic/claude-test',
    pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' },
  }] }, 'configured-file', 123)
  const price = resolveModelPrice(catalog, 'anthropic', 'claude-test')!
  const cost = calculateTokenCostRange({ inputTokens: 100, cachedInputTokens: 200, cacheWriteInputTokens: 300, outputTokens: 400, reasoningTokens: 0, inputAccounting: 'exclusive-cache' }, price)
  assert.equal(cost.lowerUsd, 0.007485)
  assert.deepEqual(cost, { lowerUsd: cost.lowerUsd, upperUsd: cost.lowerUsd })
})

test('does not double-charge cached or reasoning tokens and returns context-tier bounds', () => {
  const catalog = parseOpenRouterCatalog({ data: [{
    id: 'openai/gpt-test',
    pricing: {
      prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000002',
      overrides: [{ min_prompt_tokens: 272000, prompt: '0.000004', completion: '0.000015', input_cache_read: '0.0000004' }],
    },
  }] }, 'configured-file', 123)
  const price = resolveModelPrice(catalog, 'openai', 'gpt-test')!
  const cost = calculateTokenCostRange({ inputTokens: 1_000, cachedInputTokens: 800, cacheWriteInputTokens: 0, outputTokens: 200, reasoningTokens: 50, inputAccounting: 'inclusive-cache' }, price)
  assert.equal(cost.lowerUsd, 0.00256)
  assert.equal(cost.upperUsd, 0.00412)
})
