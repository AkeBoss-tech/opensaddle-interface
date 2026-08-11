import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { creationAction, isProjectDetailsValid } from '../src/features/onboarding/addProjectFlow.ts'
import { StepProgress } from '../src/ui/StepProgress.tsx'

test('cloud projects skip folder scanning before the UI review step', () => {
  assert.equal(creationAction('cloud', ''), 'create')
  assert.equal(isProjectDetailsValid('cloud', 'Research plan', ''), true)
})

test('project onboarding exposes an accessible staged review flow', () => {
  const html = renderToStaticMarkup(React.createElement(StepProgress, {
    current: 1,
    steps: [{ label: 'Location' }, { label: 'Details' }, { label: 'Review' }],
  }))
  assert.match(html, /role="progressbar"/)
  assert.match(html, /aria-label="Step 2 of 3: Details"/)
  assert.match(html, /aria-valuenow="2"/)

  const dialog = readFileSync('src/features/onboarding/AddProjectDialog.tsx', 'utf8')
  assert.match(dialog, /Review cloud project/)
  assert.match(dialog, /Continue to review/)
  assert.match(dialog, /onBack=\{\(\) => setStep\('details'\)\}/)
})

test('local projects require a folder before advancing to the scan step', () => {
  assert.equal(creationAction('local', ''), null)
  assert.equal(isProjectDetailsValid('local', 'Checkout', ''), false)
  assert.equal(creationAction('local', '/work/checkout'), 'scan')
})

test('cancelling at any step yields no entity creation action', () => {
  assert.equal(creationAction('cloud', '', true), null)
  assert.equal(creationAction('local', '/work/checkout', true), null)
})
