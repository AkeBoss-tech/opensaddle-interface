import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSeedData } from '../src/data/seed.ts'
import { EvidenceInspector } from '../src/features/evidence/EvidenceInspector.tsx'
import { applyEvidencePolicy } from '../src/features/evidence/index.ts'
import {
  phase1EvidencePacket,
  phase1EvidencePolicy,
} from './fixtures/phase1Evidence.ts'

test('golden read-only Thread journey renders authority, freshness, conflict, gap, and opaque omission states', () => {
  const presentation = applyEvidencePolicy(phase1EvidencePacket, phase1EvidencePolicy)
  const html = renderToStaticMarkup(React.createElement(EvidenceInspector, { presentation }))

  for (const visible of [
    'opensaddle.evidence/v1',
    'Provider: github',
    'revision:59b2549',
    'sha256:golden-visible-digest',
    'Fresh snapshot',
    'Stale snapshot',
    'The fresh source and stale verification snapshot disagree.',
    'Reconnect timing still needs live observation.',
    'derived from',
    'Evidence omitted',
    'Evidence was omitted because its provider denied access.',
  ]) assert.ok(html.includes(visible), `golden journey omitted ${visible}`)

  const serializedPresentation = JSON.stringify(presentation)
  for (const secret of [
    'never-present-secret-id',
    'never-present-secret-digest',
    'never-present-secret-citation',
    'Never present secret title',
    'Never present secret locator',
    'Never present secret content',
    'Never present secret conflict detail',
    'Never present secret gap detail',
    'Never present secret error detail',
  ]) assert.equal(serializedPresentation.includes(secret), false, `presentation leaked ${secret}`)

  const omission = presentation.omissions[0] as unknown as Record<string, unknown>
  assert.deepEqual(Object.keys(omission).sort(), ['message', 'reason'])
  assert.equal('count' in omission, false)
  assert.equal('id' in omission, false)
})

test('golden evidence projection does not enter or mutate the monolithic workspace blob', () => {
  const workspace = createSeedData()
  const before = JSON.stringify(workspace)
  const presentation = applyEvidencePolicy(phase1EvidencePacket, phase1EvidencePolicy)

  assert.equal(JSON.stringify(workspace), before)
  assert.equal(JSON.stringify(workspace).includes(phase1EvidencePacket.id), false)
  assert.equal(JSON.stringify(workspace).includes('golden-visible-digest'), false)
  assert.equal(JSON.stringify(presentation).includes(phase1EvidencePacket.id), true)
})
