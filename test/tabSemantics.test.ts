import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

for (const [name, body] of [
  ['agent library', source('src/pages/AgentsPage.tsx')],
  ['session provider', source('src/pages/SessionBridgePage.tsx')],
] as const) {
  test(`${name} tabs expose keyboard and panel relationships`, () => {
    assert.match(body, /aria-controls=/)
    assert.match(body, /role="tabpanel"/)
    assert.match(body, /tabIndex=/)
    assert.match(body, /ArrowRight/)
    assert.match(body, /ArrowLeft/)
    assert.match(body, /Home/)
    assert.match(body, /End/)
  })
}
