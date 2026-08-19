import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/pages/StartPage.tsx', import.meta.url), 'utf8')

test('Start does not dispatch a prompt before the runtime is ready', () => {
  assert.match(source, /!destinationProject \|\| !runtimeReady/)
  assert.match(source, /disabled=\{!prompt\.trim\(\) \|\| !runtimeReady\}/)
  assert.match(source, /Preparing workspace…/)
})
