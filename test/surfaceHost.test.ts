import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { SurfaceErrorBoundary } from '../src/ui/SurfaceHost.tsx'

test('a throwing surface renders the host recovery state', () => {
  const boundary = new SurfaceErrorBoundary({ children: createElement('div'), onRetry: () => undefined })
  boundary.state = SurfaceErrorBoundary.getDerivedStateFromError(new Error('surface failed'))

  const recovery = boundary.render()

  assert.equal(recovery.props.role, 'alert')
  assert.match(JSON.stringify(recovery.props.children), /This view could not load/)
})
