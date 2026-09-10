import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sidebar = readFileSync(new URL('../src/features/shell/ThreadFirstSidebar.tsx', import.meta.url), 'utf8')

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
