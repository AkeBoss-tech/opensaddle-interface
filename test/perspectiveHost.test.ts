import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { COMPILED_BUILTIN_PERSPECTIVES } from '../src/perspectives/catalog.ts'
import { PerspectiveHost } from '../src/perspectives/PerspectiveHost.tsx'

test('capability-unavailable is truthful and distinct from permission denial', () => {
  const designer = COMPILED_BUILTIN_PERSPECTIVES.find((perspective) => perspective.id === 'opensaddle.designer')!
  const html = renderToStaticMarkup(createElement(PerspectiveHost, {
    perspective: designer,
    projectId: 'proj-eng',
    inputs: {},
  }))

  assert.match(html, /Designer is not available yet/)
  assert.match(html, /capability limitation, not a permission denial/)
  assert.match(html, /design canvas/)
  assert.doesNotMatch(html, /You do not have permission/)
})
