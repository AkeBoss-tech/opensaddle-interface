import {
  EVIDENCE_SCHEMA_VERSION,
  RESOURCE_REF_SCHEMA_VERSION,
  resourceRefKey,
  type EvidencePacket,
  type EvidencePolicy,
  type ResourceRef,
} from '../../src/features/evidence/index.ts'

export const PHASE1_GOLDEN_NOW = Date.parse('2026-08-07T12:00:00.000Z')

export const directSource: ResourceRef = {
  schemaVersion: RESOURCE_REF_SCHEMA_VERSION,
  authority: { kind: 'provider', id: 'github' },
  kind: 'commit',
  id: 'AkeBoss-tech/opensaddle-interface',
  version: { kind: 'revision', value: '59b2549' },
}

export const derivedSource: ResourceRef = {
  schemaVersion: RESOURCE_REF_SCHEMA_VERSION,
  authority: { kind: 'opensaddle', id: 'control-plane' },
  kind: 'verification_report',
  id: 'phase-1-verification',
  version: { kind: 'digest', algorithm: 'sha256', value: 'golden-visible-digest' },
}

export const restrictedSource: ResourceRef = {
  schemaVersion: RESOURCE_REF_SCHEMA_VERSION,
  authority: { kind: 'connector', id: 'restricted-drive' },
  kind: 'document',
  id: 'never-present-secret-id',
  version: { kind: 'digest', algorithm: 'sha256', value: 'never-present-secret-digest' },
}

export const phase1EvidencePacket: EvidencePacket = {
  schemaVersion: EVIDENCE_SCHEMA_VERSION,
  id: 'phase-1-golden-packet-v1',
  generatedAt: PHASE1_GOLDEN_NOW,
  citations: [
    {
      id: 'integration-commit',
      source: directSource,
      title: 'Reviewed Interface Phase 1 integration',
      locator: 'src/features/evidence/contracts.ts',
      excerpt: 'Versioned evidence remains read-only in the existing Thread.',
      freshness: {
        observedAt: PHASE1_GOLDEN_NOW - 1_000,
        freshUntil: PHASE1_GOLDEN_NOW + 60_000,
        status: 'fresh',
        ageMs: 1_000,
      },
    },
    {
      id: 'verification-report',
      source: derivedSource,
      title: 'Deterministic verification report',
      freshness: {
        observedAt: PHASE1_GOLDEN_NOW - 120_000,
        freshUntil: PHASE1_GOLDEN_NOW - 60_000,
        status: 'stale',
        ageMs: 120_000,
        staleByMs: 60_000,
      },
    },
    {
      id: 'never-present-secret-citation',
      source: restrictedSource,
      title: 'Never present secret title',
      locator: 'Never present secret locator',
      excerpt: 'Never present secret content',
      freshness: { status: 'unknown' },
    },
  ],
  conflicts: [
    {
      id: 'visible-conflict',
      citationIds: ['integration-commit', 'verification-report'],
      summary: 'The fresh source and stale verification snapshot disagree.',
    },
    {
      id: 'never-present-secret-conflict',
      citationIds: ['never-present-secret-citation'],
      summary: 'Never present secret conflict detail',
    },
  ],
  gaps: [
    { id: 'visible-gap', kind: 'coverage', summary: 'Reconnect timing still needs live observation.' },
    { id: 'never-present-secret-gap', kind: 'missing_content', summary: 'Never present secret gap detail', source: restrictedSource },
  ],
  lineage: [
    { from: directSource, to: derivedSource, relation: 'derived_from' },
    { from: restrictedSource, to: derivedSource, relation: 'derived_from' },
  ],
  policyOmissions: [],
  errors: [
    { code: 'stale_evidence', message: 'The verification snapshot is stale.', retryable: true, resource: derivedSource },
    { code: 'provider_denied', message: 'Never present secret error detail', retryable: false, resource: restrictedSource },
  ],
}

export const phase1EvidencePolicy: EvidencePolicy = {
  defaultEffect: 'allow',
  resourceEffects: { [resourceRefKey(restrictedSource)]: 'deny' },
  denialReason: 'provider_denied',
}
