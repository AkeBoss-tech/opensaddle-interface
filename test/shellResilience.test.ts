import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../src/features/shell/ThreadFirstSidebar.tsx', import.meta.url), 'utf8')

test('route failures are contained inside the persistent shell', () => {
  assert.match(app, /<SurfaceErrorBoundary key=\{loc\.pathname\} onRetry=\{\(\) => nav\(0\)\}>/)
})

test('connected-local navigation exposes the active route', () => {
  const localSidebar = app.slice(app.indexOf('connectedLocal && <aside'), app.indexOf('</aside>}'))
  assert.match(localSidebar, /<NavLink to="\/start">/)
  assert.doesNotMatch(localSidebar, /<Link to=/)
})

test('the primary sidebar stays focused on immediate work', () => {
  assert.match(sidebar, />New task</)
  assert.match(sidebar, />Search</)
  assert.match(sidebar, />Work</)
  assert.match(sidebar, />Team overview</)
  assert.match(sidebar, />Recent</)
  assert.doesNotMatch(sidebar, />Work streams</)
  assert.doesNotMatch(sidebar, />Direct messages</)
  assert.doesNotMatch(sidebar, /Local projects/)
})
