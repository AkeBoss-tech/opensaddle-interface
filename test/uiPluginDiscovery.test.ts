import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { discoverUiPlugins } from '../electron/uiPluginDiscovery.ts'

test('loads only validated declarative UI plugin contributions', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'opensaddle-ui-plugin-'))
  try {
    const valid = path.join(home, '.opensaddle', 'plugins', 'example')
    const invalid = path.join(home, '.opensaddle', 'plugins', 'invalid')
    await Promise.all([mkdir(valid, { recursive: true }), mkdir(invalid, { recursive: true })])
    await writeFile(path.join(valid, 'plugin.json'), JSON.stringify({
      schemaVersion: 'opensaddle.ui-plugin.v1', id: 'example.views', name: 'Example views',
      contributions: {
        projectSorts: [{ id: 'example.cost', title: 'Cost ascending', field: 'estimatedCostUsd', direction: 'asc' }],
        projectViews: [{ id: 'example.compact', title: 'Compact', density: 'compact', showPath: false }],
      },
    }))
    await writeFile(path.join(invalid, 'plugin.json'), JSON.stringify({ schemaVersion: 'unknown', id: 'bad', contributions: { projectSorts: [] } }))
    const plugins = await discoverUiPlugins(home)
    assert.equal(plugins.length, 1)
    assert.equal(plugins[0]?.projectSorts[0]?.field, 'estimatedCostUsd')
    assert.equal(plugins[0]?.projectViews[0]?.showPath, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
