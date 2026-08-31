import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { registerSurface } from '../src/surfaces/registry.ts'
import { SurfaceErrorBoundary, SurfaceHost } from '../src/ui/SurfaceHost.tsx'

const ProtectedFixture = (() => createElement('div', null, 'SENSITIVE:project-data')) as ComponentType<Record<string, never>>

registerSurface({
  id: 'protected-surface-host-fixture',
  inputs: [],
  Component: ProtectedFixture,
  permission: { resourceKind: 'project', action: 'read' },
})

test('a throwing surface renders the host recovery state', () => {
  const boundary = new SurfaceErrorBoundary({ children: createElement('div'), onRetry: () => undefined })
  boundary.state = SurfaceErrorBoundary.getDerivedStateFromError(new Error('surface failed'))

  const recovery = boundary.render()

  assert.equal(recovery.props.role, 'alert')
  assert.match(JSON.stringify(recovery.props.children), /This view could not load/)
})

test('a protected surface never renders project data before permission is verified', () => {
  const markup = renderToStaticMarkup(createElement(SurfaceHost, {
    surfaceId: 'protected-surface-host-fixture',
    projectId: 'project-private',
    inputs: {},
  }))

  assert.match(markup, /Checking access/)
  assert.doesNotMatch(markup, /SENSITIVE:project-data/)
})
