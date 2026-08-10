import type { ContextBriefProjection } from '../domain'

const SHA256 = /^sha256:[a-f0-9]{64}$/
const OPAQUE_OMISSION = 'Additional evidence may exist but is not visible in this authorization context.'

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function array(value: unknown, label: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${label} must be a bounded list`)
  return value
}

function digest(value: unknown, label: string): string {
  const result = string(value, label)
  if (!SHA256.test(result)) throw new Error(`${label} must be a sha256 digest`)
  return result
}

export interface ContextResourcePresentation {
  issuer: string
  resourceId: string
  resourceType: string
  version: string
  digest: string
  source: { sourceId: string; origin: string; version: string; digest: string }
}

function uri(value: unknown, label: string): string {
  const result = string(value, label)
  try { new URL(result) } catch { throw new Error(`${label} must be an absolute URI`) }
  return result
}

function wireDigest(value: unknown, label: string): string {
  const source = object(value, label)
  if (source.algorithm !== 'sha-256') throw new Error(`${label} uses an unsupported algorithm`)
  const result = string(source.value, `${label}.value`)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${label} must be an exact sha-256 digest`)
  return result
}

function resource(value: unknown): ContextResourcePresentation {
  const source = object(value, 'context resource')
  const sourceVersion = object(source.source, 'context resource source')
  return {
    issuer: uri(source.issuer, 'context resource issuer'),
    resourceId: string(source.resource_id, 'context resource id'),
    resourceType: string(source.resource_type, 'context resource type'),
    version: string(source.version, 'context resource version'),
    digest: wireDigest(source.digest, 'context resource digest'),
    source: {
      sourceId: string(sourceVersion.source_id, 'context resource source id'),
      origin: uri(sourceVersion.origin, 'context resource source origin'),
      version: string(sourceVersion.version, 'context resource source version'),
      digest: wireDigest(sourceVersion.digest, 'context resource source digest'),
    },
  }
}

export interface ContextFreshnessPresentation {
  source: ContextResourcePresentation
  status: 'fresh' | 'stale' | 'unknown'
  basis: string
  processingVersion: string
}

export interface ContextConflictPresentation {
  basis: string
  sources: readonly [ContextResourcePresentation, ContextResourcePresentation]
  processingVersion: string
}

export interface ContextGapPresentation {
  code: string
  message: string
}

export interface ContextAssertionPresentation {
  id: string
  text: string
  locator: string
  source: ContextResourcePresentation
}

export interface ContextEvidencePresentation {
  id: string
  relation: 'direct' | 'derived_from'
  locator: string
  source: ContextResourcePresentation
  excerptDigest: string
  recordDigest: string
}

export interface ContextBriefPresentation {
  schemaVersion: 'krail.context-brief.v1'
  briefDigest: string
  evaluatedAt: string
  repository: ContextResourcePresentation
  issue: ContextResourcePresentation
  assertions: ContextAssertionPresentation[]
  freshness: ContextFreshnessPresentation[]
  conflicts: ContextConflictPresentation[]
  gaps: ContextGapPresentation[]
  evidence: ContextEvidencePresentation[]
  omissions: string[]
  truncated: boolean
  processingVersions: Array<{ component: string; version: string }>
}

function locator(value: unknown): string {
  const source = object(value, 'citation.locator')
  if (source.kind === 'fragment') return `fragment:${string(source.value, 'citation.locator.value')}`
  if (
    source.kind === 'span'
    && (source.unit === 'bytes' || source.unit === 'unicode_codepoints' || source.unit === 'lines')
    && Number.isInteger(source.start)
    && Number.isInteger(source.end)
  ) return `${source.unit}:${String(source.start)}-${String(source.end)}`
  throw new Error('citation.locator is unsupported')
}

/**
 * Shapes an already-authorized KRAIL projection into bounded text-only UI data.
 * Provider content and omission cardinality are deliberately not exposed.
 */
export function presentContextBrief(value: ContextBriefProjection): ContextBriefPresentation {
  const source = object(value, 'context brief')
  if (source.schema_version !== 'krail.context-brief.v1') throw new Error('context brief schema is unsupported')
  const evidencePacket = object(source.evidence, 'context brief evidence')
  const authorization = object(evidencePacket.authorization, 'context brief evidence authorization')
  if (authorization.shape !== 'authorized_projection') throw new Error('context brief is not an authorized projection')

  const omissions = array(source.omissions, 'context brief omissions', 1).map((item) => {
    const omission = object(item, 'context brief omission')
    if (omission.reason !== 'authorization-policy' || omission.disclosure !== OPAQUE_OMISSION) {
      throw new Error('context brief omission is not opaque')
    }
    return OPAQUE_OMISSION
  })
  const omittedCount = authorization.omitted_count
  if (typeof omittedCount === 'number' && omittedCount > 0 && omissions.length === 0) omissions.push(OPAQUE_OMISSION)

  const results = array(evidencePacket.results, 'context brief evidence results', 100)
  const evidence = results.flatMap((item, resultIndex) => {
    const result = object(item, `context brief evidence result ${resultIndex}`)
    return array(result.citations, `context brief evidence citations ${resultIndex}`, 50).map((citationValue, citationIndex) => {
      const citation = object(citationValue, `context brief citation ${resultIndex}.${citationIndex}`)
      if (citation.relation !== 'direct' && citation.relation !== 'derived_from') throw new Error('citation relation is unsupported')
      return {
        id: string(citation.evidence_id, 'citation.evidence_id'),
        relation: citation.relation,
        locator: locator(citation.locator),
        source: resource(citation.resource),
        excerptDigest: `sha256:${wireDigest(citation.excerpt_digest, 'citation.excerpt_digest')}`,
        recordDigest: `sha256:${wireDigest(citation.record_digest, 'citation.record_digest')}`,
      } satisfies ContextEvidencePresentation
    })
  }).slice(0, 256)

  return {
    schemaVersion: 'krail.context-brief.v1',
    briefDigest: digest(source.brief_digest, 'context brief digest'),
    evaluatedAt: string(source.evaluated_at, 'context brief evaluated_at'),
    repository: resource(source.repository),
    issue: resource(source.issue),
    assertions: array(source.assertions, 'context brief assertions', 32).map((item) => {
      const assertion = object(item, 'context assertion')
      return {
        id: digest(assertion.assertion_id, 'context assertion id'),
        text: string(assertion.text, 'context assertion text'),
        locator: string(assertion.locator, 'context assertion locator'),
        source: resource(assertion.source),
      }
    }),
    freshness: array(source.freshness, 'context brief freshness', 32).map((item) => {
      const freshness = object(item, 'context freshness')
      if (freshness.status !== 'fresh' && freshness.status !== 'stale' && freshness.status !== 'unknown') throw new Error('freshness status is unsupported')
      return {
        source: resource(freshness.source),
        status: freshness.status,
        basis: string(freshness.basis, 'context freshness basis'),
        processingVersion: string(freshness.processing_version, 'context freshness processing version'),
      }
    }),
    conflicts: array(source.conflicts, 'context brief conflicts', 32).map((item) => {
      const conflict = object(item, 'context conflict')
      const sources = array(conflict.sources, 'context conflict sources', 2)
      if (sources.length !== 2) throw new Error('context conflict requires two sources')
      return {
        basis: string(conflict.basis, 'context conflict basis'),
        sources: [resource(sources[0]), resource(sources[1])],
        processingVersion: string(conflict.processing_version, 'context conflict processing version'),
      }
    }),
    gaps: array(source.gaps, 'context brief gaps', 32).map((item) => {
      const gap = object(item, 'context gap')
      return { code: string(gap.code, 'context gap code'), message: string(gap.message, 'context gap message') }
    }),
    evidence,
    omissions,
    truncated: source.truncated === true,
    processingVersions: array(source.processing_versions, 'context brief processing versions', 16).map((item) => {
      const version = object(item, 'context processing version')
      return { component: string(version.component, 'context processing component'), version: string(version.version, 'context processing version') }
    }),
  }
}

export function shortDigest(value: string): string {
  const plain = value.startsWith('sha256:') ? value.slice(7) : value
  return `${plain.slice(0, 10)}…${plain.slice(-8)}`
}

export function evidenceAnchor(id: string): string {
  return `context-evidence-${encodeURIComponent(id)}`
}
