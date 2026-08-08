import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EvidenceInspector } from '../src/features/evidence/EvidenceInspector.tsx'
import {
  EVIDENCE_SCHEMA_VERSION,
  RESOURCE_REF_SCHEMA_VERSION,
  applyEvidencePolicy,
  nextEvidenceCitationIndex,
  resourceRefKey,
  type EvidencePacket,
  type ResourceRef,
} from '../src/features/evidence/index.ts'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')

const direct: ResourceRef = {
  schemaVersion: RESOURCE_REF_SCHEMA_VERSION,
  authority: { kind: 'provider', id: 'github' },
  kind: 'commit',
  id: 'opensaddle/interface',
  version: { kind: 'revision', value: '984d98b' },
}

const derived: ResourceRef = {
  schemaVersion: RESOURCE_REF_SCHEMA_VERSION,
  authority: { kind: 'opensaddle', id: 'control-plane' },
  kind: 'report',
  id: 'verification-report',
  version: { kind: 'digest', algorithm: 'sha256', value: 'abc123digest' },
}

function packet(): EvidencePacket {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    id: 'evidence-1',
    generatedAt: NOW,
    citations: [
      {
        id: 'direct',
        source: direct,
        title: 'Integration commit',
        locator: 'src/features/evidence/contracts.ts:112',
        excerpt: '<script>not executable</script>',
        freshness: { observedAt: NOW - 1_000, freshUntil: NOW + 60_000, status: 'fresh', ageMs: 1_000 },
      },
      {
        id: 'derived',
        source: derived,
        title: 'Verification report',
        freshness: { observedAt: NOW - 120_000, freshUntil: NOW - 60_000, status: 'stale', ageMs: 120_000, staleByMs: 60_000 },
      },
    ],
    conflicts: [{ id: 'conflict-1', citationIds: ['direct', 'derived'], summary: 'Source and report disagree.' }],
    gaps: [{ id: 'gap-1', kind: 'coverage', summary: 'Runtime logs were unavailable.' }],
    lineage: [{ from: direct, to: derived, relation: 'derived_from' }],
    policyOmissions: [{ id: 'omitted-1', reason: 'provider_denied', count: 2, message: 'Evidence was omitted because its provider denied access.' }],
    errors: [{ code: 'stale_evidence', message: 'The verification snapshot is stale.', retryable: true, resource: derived }],
  }
}

test('renders versioned authority, freshness, lineage, issues, and semantic navigation', () => {
  const html = renderToStaticMarkup(React.createElement(EvidenceInspector, {
    presentation: applyEvidencePolicy(packet(), { defaultEffect: 'allow' }),
  }))

  for (const expected of [
    '<h2 id="thread-evidence-heading">Thread evidence</h2>',
    'aria-label="Versioned citations"',
    'aria-expanded="true"',
    'Provider: github',
    'revision:984d98b',
    'sha256:abc123digest',
    'Derived · cached snapshot · Stale snapshot',
    'Conflicts',
    'Evidence gaps',
    'Lineage',
    'derived from',
    'Policy omissions',
    '2 omitted',
    'Evidence errors',
  ]) assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  assert.equal(html.includes('<script>'), false)
  assert.equal(html.includes('&lt;script&gt;not executable&lt;/script&gt;'), true)
})

test('never renders denied evidence or its dependent narrative', () => {
  const raw = packet()
  raw.citations[0] = {
    ...raw.citations[0]!,
    title: 'Restricted source name',
    excerpt: 'Restricted source content',
  }
  raw.conflicts[0] = { ...raw.conflicts[0]!, summary: 'Restricted conflict detail' }
  const presentation = applyEvidencePolicy(raw, {
    defaultEffect: 'allow',
    resourceEffects: { [resourceRefKey(direct)]: 'deny' },
  })
  const html = renderToStaticMarkup(React.createElement(EvidenceInspector, { presentation }))

  for (const restricted of ['Restricted source name', 'Restricted source content', 'Restricted conflict detail']) {
    assert.equal(html.includes(restricted), false)
  }
  assert.match(html, /Policy omissions/)
  assert.match(html, /omitted/)
})

test('renders useful empty and degraded states', () => {
  const empty = applyEvidencePolicy({ ...packet(), citations: [], conflicts: [], gaps: [], lineage: [], policyOmissions: [], errors: [] }, { defaultEffect: 'allow' })
  assert.match(renderToStaticMarkup(React.createElement(EvidenceInspector, { presentation: empty })), /No versioned evidence yet/)

  const degraded = applyEvidencePolicy({ ...packet(), citations: [], conflicts: [], lineage: [] }, { defaultEffect: 'allow' })
  const html = renderToStaticMarkup(React.createElement(EvidenceInspector, { presentation: degraded }))
  assert.match(html, /Evidence gaps/)
  assert.match(html, /Evidence errors/)
  assert.doesNotMatch(html, /No versioned evidence yet/)
})

test('citation roving focus supports arrow, Home, End, and wraparound navigation', () => {
  assert.equal(nextEvidenceCitationIndex(0, 'ArrowDown', 3), 1)
  assert.equal(nextEvidenceCitationIndex(2, 'ArrowDown', 3), 0)
  assert.equal(nextEvidenceCitationIndex(0, 'ArrowUp', 3), 2)
  assert.equal(nextEvidenceCitationIndex(1, 'Home', 3), 0)
  assert.equal(nextEvidenceCitationIndex(1, 'End', 3), 2)
  assert.equal(nextEvidenceCitationIndex(0, 'ArrowDown', 0), -1)
})
