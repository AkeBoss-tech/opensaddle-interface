import assert from 'node:assert/strict'
import test from 'node:test'
import { projectProjectionCatalog, sortDiscoveredProjects } from '../src/extensions/viewPlugins.ts'
import type { DiscoveredLocalProject, DiscoveredUiPlugin } from '../src/types/index.ts'

function project(name: string, tokens: number | null, cost: number | null): DiscoveredLocalProject {
  return { id: name, name, rootPath: `/${name}`, sources: ['codex'], lastSeenAt: 1, tokenUsage: tokens, tokenUsageSources: tokens ? ['codex-sessions'] : [], estimatedCostUsd: cost, estimatedCostUpperBoundUsd: cost, costPricedTokens: tokens ?? 0, costUnpricedTokens: 0, costPricingSources: cost === null ? [] : ['openrouter-live'], costPricingObservedAt: cost === null ? null : 1, usageAnalytics: { sessions: 0, models: [], harnesses: [], daily: [], buckets: [], tokenBreakdown: { uncachedInputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningTokens: 0, unclassifiedTokens: 0 } } }
}

test('compiles declarative project sort and view contributions without executable plugin code', () => {
  const plugin: DiscoveredUiPlugin = {
    id: 'example.ui', name: 'Example', sourcePath: '/example/plugin.json',
    projectSorts: [{ id: 'example.cost-low', title: 'Lowest cost', field: 'estimatedCostUsd', direction: 'asc', missing: 'last' }],
    projectViews: [{ id: 'example.focus', title: 'Focus', density: 'compact', showPath: false, showUsage: true, showSources: false }],
  }
  const catalog = projectProjectionCatalog([plugin])
  assert.ok(catalog.sorts.some((sort) => sort.id === 'opensaddle.estimated-cost'))
  assert.ok(catalog.views.some((view) => view.id === 'example.focus'))
  const sorter = catalog.sorts.find((sort) => sort.id === 'example.cost-low')!
  assert.deepEqual(sortDiscoveredProjects([project('large', 20, 20), project('unknown', null, null), project('small', 2, 2)], sorter).map((item) => item.name), ['small', 'large', 'unknown'])
})
