import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('route failures are contained inside the persistent shell', () => {
  assert.match(app, /<SurfaceErrorBoundary key=\{loc\.pathname\} onRetry=\{\(\) => nav\(0\)\}>/)
})

test('connected-local navigation exposes the active route', () => {
  const localSidebar = app.slice(app.indexOf('connectedLocal && <aside'), app.indexOf('</aside>}'))
  assert.match(localSidebar, /<NavLink to="\/start">/)
  assert.doesNotMatch(localSidebar, /<Link to=/)
})
