import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EVIDENCE_SCHEMA_VERSION,
  RESOURCE_REF_SCHEMA_VERSION,
  adaptOperationPresentation,
  adaptRunEvidencePacket,
  applyEvidencePolicy,
  evaluateFreshness,
  parseResourceVersion,
  presentAuthority,
  resourceRefKey,
  type EvidencePacket,
  type ResourceRef,
} from '../src/features/evidence/index.ts'
import type { AgentRunBlock, ProjectSource } from '../src/types/index.ts'
import type { SessionEvent } from '../src/services/contracts.ts'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')

const sourceRef: ResourceRef = {
  schemaVersion: RESOURCE_REF_SCHEMA_VERSION,
  authority: { kind: 'connector', id: 'drive' },
  kind: 'document',
  id: 'secret-roadmap',
  version: { kind: 'digest', algorithm: 'sha256', value: 'abc123' },
}

function run(overrides: Partial<AgentRunBlock> = {}): AgentRunBlock {
  return {
    id: 'run-1',
    kind: 'research',
    title: 'Research',
    model: 'gpt',
    harness: 'research',
    runtime: 'local',
    statusText: 'Running',
    done: false,
    tools: [],
    plan: [],
    artifacts: [],
    ...overrides,
  }
}

function packet(): EvidencePacket {
  const otherRef: ResourceRef = {
    ...sourceRef,
    id: 'public-brief',
    version: { kind: 'revision', value: '42' },
  }
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    id: 'packet-1',
    generatedAt: NOW,
    citations: [
      {
        id: 'restricted-citation',
        source: sourceRef,
        title: 'Secret acquisition roadmap',
        locator: 'Highly Restricted/Acquisition.pdf#page=4',
        excerpt: 'Acquire Hidden Company for $9B',
        freshness: { observedAt: NOW - 1_000, status: 'fresh' },
      },
      {
        id: 'public-citation',
        source: otherRef,
        title: 'Public brief',
        excerpt: 'Safe public evidence',
        freshness: { observedAt: NOW - 1_000, status: 'fresh' },
      },
    ],
    conflicts: [{
      id: 'secret-conflict',
      citationIds: ['restricted-citation', 'public-citation'],
      summary: 'Secret deal value conflicts with public guidance',
    }],
    gaps: [{
      id: 'secret-gap',
      kind: 'coverage',
      summary: 'Secret appendix is missing',
      source: sourceRef,
    }],
    lineage: [{ from: sourceRef, to: otherRef, relation: 'quoted_from' }],
    policyOmissions: [],
    errors: [{ code: 'version_conflict', message: 'Secret version changed', retryable: true, resource: sourceRef }],
  }
}

test('parses only explicit, exact source versions and digests', () => {
  assert.deepEqual(parseResourceVersion('revision:main@abc123'), { kind: 'revision', value: 'main@abc123' })
  assert.deepEqual(parseResourceVersion('sha256:ABC_def-123'), { kind: 'digest', algorithm: 'sha256', value: 'ABC_def-123' })
  assert.deepEqual(parseResourceVersion('timestamp:2026-08-07T10:30:00-04:00'), {
    kind: 'timestamp',
    value: '2026-08-07T14:30:00.000Z',
  })
  assert.equal(parseResourceVersion('main'), undefined)
  assert.equal(parseResourceVersion('sha256:'), undefined)
  assert.equal(parseResourceVersion('timestamp:not-a-date'), undefined)
})

test('freshness evaluation is deterministic at its boundary', () => {
  assert.deepEqual(evaluateFreshness({ observedAt: NOW - 10, freshUntil: NOW }, NOW), {
    observedAt: NOW - 10,
    freshUntil: NOW,
    status: 'fresh',
    ageMs: 10,
  })
  assert.deepEqual(evaluateFreshness({ observedAt: NOW - 100, freshUntil: NOW - 25 }, NOW), {
    observedAt: NOW - 100,
    freshUntil: NOW - 25,
    status: 'stale',
    ageMs: 100,
    staleByMs: 25,
  })
  assert.equal(evaluateFreshness({ observedAt: NOW - 100 }, NOW).status, 'unknown')
})

test('authority presentation and resource keys preserve authority qualification', () => {
  assert.deepEqual(presentAuthority(sourceRef.authority), {
    label: 'drive',
    badge: { label: 'Connector', tone: 'neutral' },
    description: 'Data observed through a connected service',
  })
  assert.notEqual(
    resourceRefKey(sourceRef),
    resourceRefKey({ ...sourceRef, authority: { kind: 'provider', id: 'drive' } }),
  )
})

test('adapts durable run sources and warning gaps without inventing source versions', () => {
  const projectSource: ProjectSource = {
    id: 'source-1',
    projectId: 'project-1',
    kind: 'drive',
    name: 'Product brief',
    externalId: 'drive-doc-1',
    status: 'connected',
    lastSyncAt: NOW - 1_000,
  }
  const warning: SessionEvent = {
    event_id: 'event-1',
    session_id: 'session-1',
    run_id: 'run-1',
    sequence: 1,
    timestamp: new Date(NOW).toISOString(),
    type: 'warning',
    payload: { evidenceGap: { kind: 'coverage', summary: 'Only one quarter was available.' } },
  }
  const adapted = adaptRunEvidencePacket({
    run: run({ sources: [
      { id: 'source-1', kind: 'connector', label: 'Product brief' },
      { id: 'unversioned', kind: 'file', label: 'Loose note' },
    ] }),
    projectSources: [projectSource],
    events: [warning],
    generatedAt: NOW,
    freshnessWindowMs: 500,
  })

  assert.equal(adapted.schemaVersion, EVIDENCE_SCHEMA_VERSION)
  assert.equal(adapted.citations.length, 1)
  assert.deepEqual(adapted.citations[0]?.source.version, {
    kind: 'timestamp',
    value: new Date(NOW - 1_000).toISOString(),
  })
  assert.equal(adapted.citations[0]?.freshness.status, 'stale')
  assert.deepEqual(adapted.gaps.map((gap) => gap.kind), ['missing_version', 'coverage'])
  assert.equal(adapted.errors[0]?.code, 'stale_evidence')
})

test('policy projection drops denied evidence and every dependent leak', () => {
  const presentation = applyEvidencePolicy(packet(), {
    defaultEffect: 'allow',
    citationEffects: { 'restricted-citation': 'deny' },
  })
  const serialized = JSON.stringify(presentation)

  assert.equal(presentation.citations.length, 1)
  assert.equal(presentation.conflicts.length, 0)
  assert.equal(presentation.gaps.length, 0)
  assert.equal(presentation.lineage.length, 0)
  assert.equal(presentation.errors.length, 0)
  assert.deepEqual(presentation.omissions, [{
    id: 'omission-1',
    reason: 'policy_denied',
    count: 5,
    message: 'Evidence was omitted by policy.',
  }])
  for (const secret of ['secret-roadmap', 'Secret acquisition', 'Acquisition.pdf', 'Hidden Company', '$9B', 'Secret deal', 'Secret appendix', 'Secret version']) {
    assert.equal(serialized.includes(secret), false, `presentation leaked ${secret}`)
  }
})

test('redaction emits an opaque placeholder and a non-leaking omission', () => {
  const presentation = applyEvidencePolicy(packet(), {
    defaultEffect: 'allow',
    resourceEffects: { [resourceRefKey(sourceRef)]: 'redact' },
    denialReason: 'provider_denied',
  })
  assert.deepEqual(presentation.citations[0], {
    id: 'redacted-1',
    visibility: 'redacted',
    title: 'Restricted evidence',
    authority: {
      label: 'Restricted',
      badge: { label: 'Restricted', tone: 'warning' },
      description: 'Evidence details are unavailable under the active policy',
    },
  })
  assert.equal(presentation.omissions[0]?.reason, 'redacted')
  assert.equal(JSON.stringify(presentation).includes('secret-roadmap'), false)
})

test('deny-by-default also removes unqualified narrative evidence', () => {
  const raw = packet()
  raw.citations = []
  raw.conflicts = [{ id: 'unqualified', citationIds: [], summary: 'Unqualified restricted conflict' }]
  raw.gaps = [{ id: 'unqualified', kind: 'coverage', summary: 'Unqualified restricted gap' }]
  raw.errors = [{ code: 'policy_denied', message: 'Unqualified restricted error', retryable: false }]
  const presentation = applyEvidencePolicy(raw, { defaultEffect: 'deny' })

  assert.equal(presentation.conflicts.length, 0)
  assert.equal(presentation.gaps.length, 0)
  assert.equal(presentation.errors.length, 0)
  assert.equal(JSON.stringify(presentation).includes('Unqualified restricted'), false)
  assert.equal(presentation.omissions[0]?.count, 3)
})

test('operation state, phase, blocker, and outcome remain orthogonal', () => {
  const presentation = adaptOperationPresentation(run({
    statusText: 'Approval required during verification',
    inputRequest: { kind: 'approval', prompt: 'Allow check?' },
  }), undefined, [{
    event_id: 'verify-1',
    session_id: 'session-1',
    run_id: 'run-1',
    sequence: 2,
    timestamp: new Date(NOW).toISOString(),
    type: 'verification.started',
    payload: {},
  }])

  assert.deepEqual({
    state: presentation.state,
    phase: presentation.phase,
    blocker: presentation.blocker,
    outcome: presentation.outcome,
    error: presentation.error?.code,
  }, {
    state: 'waiting',
    phase: 'verification',
    blocker: 'approval_required',
    outcome: 'pending',
    error: 'approval_required',
  })
})
