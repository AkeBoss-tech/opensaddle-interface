import {
  InvestigationClientError,
  adaptInvestigationProjection,
  type CreateInvestigationInput,
  type InvestigationFailureCode,
  type InvestigationProjection,
  type InvestigationResourceRef,
  type ReconcileInvestigationInput,
  type SavePlanDraftInput,
} from '../domain'
import type { InvestigationTransport } from './transport'

type Fetch = typeof globalThis.fetch

function wireRef(ref: InvestigationResourceRef) {
  return {
    issuer: ref.issuer,
    resource_id: ref.resourceId,
    resource_type: ref.resourceType,
    version: ref.version,
    digest: ref.digest,
    source: {
      source_id: ref.source.sourceId,
      origin: ref.source.origin,
      version: ref.source.version,
      digest: ref.source.digest,
    },
  }
}

function failureCode(value: unknown, status: number): InvestigationFailureCode {
  const supported = new Set<InvestigationFailureCode>([
    'policy_denied', 'approval_required', 'stale_evidence', 'version_conflict',
    'provider_unavailable', 'invalid_evidence', 'cancelled', 'redacted', 'unavailable',
  ])
  if (typeof value === 'string' && supported.has(value as InvestigationFailureCode)) return value as InvestigationFailureCode
  if (status === 404 || status === 403) return 'redacted'
  if (status === 409) return 'version_conflict'
  return 'unavailable'
}

export class HttpInvestigationTransport implements InvestigationTransport {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string
  private readonly fetcher: Fetch

  constructor(
    baseUrl: string,
    getUserId: () => string,
    token?: string,
    fetcher: Fetch = globalThis.fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getUserId = getUserId
    this.token = token
    this.fetcher = fetcher
  }

  private headers(json = false): Record<string, string> {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      'X-OpenSaddle-User': this.getUserId(),
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<InvestigationProjection> {
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers: { ...this.headers(init.body !== undefined), ...init.headers } })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new InvestigationClientError({ code: 'unavailable', message: 'OpenSaddle investigation service is unavailable', retryable: true })
    }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok) {
      const detail = body?.detail
      const structured = typeof detail === 'object' && detail !== null ? detail as Record<string, unknown> : body
      const message = typeof structured?.message === 'string'
        ? structured.message
        : typeof detail === 'string' ? detail : 'Investigation request failed'
      throw new InvestigationClientError({
        code: failureCode(structured?.code, response.status),
        message: response.status === 404 || response.status === 403 ? 'Investigation is unavailable or restricted' : message,
        retryable: typeof structured?.retryable === 'boolean' ? structured.retryable : response.status >= 500,
      }, response.status)
    }
    try {
      return adaptInvestigationProjection(body)
    } catch {
      throw new InvestigationClientError({ code: 'invalid_evidence', message: 'OpenSaddle returned an invalid investigation projection', retryable: false }, response.status)
    }
  }

  create(input: CreateInvestigationInput, signal?: AbortSignal) {
    return this.request('/api/v2/grounded-investigations', { method: 'POST', signal, body: JSON.stringify({
      project_id: input.projectId,
      repository: wireRef(input.repository),
      issue: wireRef(input.issue),
      query: input.query ?? null,
      evaluated_at: input.evaluatedAt,
    }) })
  }

  get(investigationId: string, signal?: AbortSignal) {
    return this.request(`/api/v2/grounded-investigations/${encodeURIComponent(investigationId)}`, { signal })
  }

  retry(investigationId: string, signal?: AbortSignal) {
    return this.request(`/api/v2/grounded-investigations/${encodeURIComponent(investigationId)}/retry`, { method: 'POST', signal })
  }

  cancel(investigationId: string, signal?: AbortSignal) {
    return this.request(`/api/v2/grounded-investigations/${encodeURIComponent(investigationId)}/cancel`, { method: 'POST', signal })
  }

  reconcile(investigationId: string, input: ReconcileInvestigationInput, signal?: AbortSignal) {
    return this.request(`/api/v2/grounded-investigations/${encodeURIComponent(investigationId)}/reconcile`, { method: 'POST', signal, body: JSON.stringify({
      repository: wireRef(input.repository), issue: wireRef(input.issue), query: input.query ?? null, evaluated_at: input.evaluatedAt,
    }) })
  }

  savePlan(investigationId: string, input: SavePlanDraftInput, signal?: AbortSignal) {
    return this.request(`/api/v2/grounded-investigations/${encodeURIComponent(investigationId)}/plan-draft`, { method: 'PUT', signal, body: JSON.stringify({
      expected_version: input.expectedVersion,
      title: input.title,
      objective: input.objective,
      steps: input.steps,
      assumptions: input.assumptions,
      registered_action_id: input.registeredActionId,
      registered_action_version: input.registeredActionVersion,
      expires_in_seconds: input.expiresInSeconds,
      cost_estimate: input.costEstimate,
    }) })
  }
}
