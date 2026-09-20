import type { CodingResult } from './codingResultReview'
import type { FactoryRunBinding } from './factoryCoding'

type Json = Record<string, unknown>
const record = (value: unknown): Json => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Factory execution response is invalid')
  return value as Json
}
const id = (value: unknown, pattern: RegExp): string => {
  if (typeof value !== 'string' || !pattern.test(value)) throw Error('Factory execution identity is invalid')
  return value
}
const sha = (value: unknown) => id(value, /^[a-f0-9]{64}$/)
const cleanName = (value: unknown, max: number): string => {
  if (typeof value !== 'string' || !value || value.length > max || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw Error('Factory identity is invalid')
  return value
}
const runId = (value: unknown) => id(value, /^run_[0-9a-f]{32}$/)
const artifactId = (value: unknown) => id(value, /^art_[A-Za-z0-9]+$/)
const reviewId = (value: unknown) => id(value, /^review_[0-9a-f]{32}$/)

export interface FactoryExecution {
  executionId: string; projectId: string; factoryId: string; factoryVersion: number
  compileDigest: string; requestedBy: string; state: 'awaiting_a' | 'awaiting_b' | 'completed'
  aRunId: string; bRunId: string | null; aArtifactId: string | null; aArtifactDigest: string | null
}

export class FactoryExecutionClient {
  private readonly baseUrl: string
  private readonly user: () => string
  private readonly token?: string
  private readonly storage?: Storage
  constructor(baseUrl: string, user: () => string, token?: string,
    storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage) {
    this.baseUrl = baseUrl;this.user = user;this.token = token;this.storage = storage
  }
  identity() { return this.user() }
  private async request(executionId: string, action?: 'advance' | 'accept', body?: Json): Promise<Json> {
    const actor = this.user()
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v2/factory-executions/${encodeURIComponent(executionId)}${action ? `/${action}` : ''}`,
      { method: action ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'X-OpenSaddle-User': actor, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) })
    if (actor !== this.user()) throw Error('Factory account changed; reload before continuing')
    if (response.status === 409) throw Error('Factory execution or exact review changed. Refresh and inspect the current evidence.')
    if (response.status === 401 || response.status === 403) throw Error('Factory execution authority is unavailable; refresh Project access.')
    if (response.status === 404) throw Error('Factory execution is unavailable in this Project.')
    if (!response.ok) throw Error(`Factory execution outcome is unconfirmed (${response.status}). Refresh before retrying.`)
    const payload = record(await response.json())
    if (actor !== this.user()) throw Error('Factory account changed; reload before continuing')
    return payload
  }
  private parse(value: unknown, projectId: string, executionId: string): FactoryExecution {
    const row = record(value)
    if (row.project_id !== projectId || row.execution_id !== executionId || !['awaiting_a','awaiting_b','completed'].includes(String(row.state))) throw Error('Factory execution Project or cursor identity changed')
    const state = row.state as FactoryExecution['state']
    const bRunId = row.b_run_id === null ? null : runId(row.b_run_id)
    if ((state === 'awaiting_a') !== (bRunId === null)) throw Error('Factory execution step cursor is invalid')
    if (!Number.isSafeInteger(row.factory_version) || Number(row.factory_version) < 1) throw Error('Factory version is invalid')
    return { executionId, projectId, state, factoryId: id(row.factory_id, /^factory_[A-Za-z0-9_-]{1,192}$/),
      factoryVersion: Number(row.factory_version), compileDigest: sha(row.compile_digest),
      requestedBy: cleanName(row.requested_by, 512),
      aRunId: runId(row.a_run_id), bRunId,
      aArtifactId: row.a_artifact_id === null ? null : artifactId(row.a_artifact_id),
      aArtifactDigest: row.a_artifact_digest === null ? null : sha(row.a_artifact_digest) }
  }
  read(projectId: string, executionId: string) {
    id(executionId, /^fexec_[0-9a-f]{32}$/)
    return this.request(executionId).then(value => this.parse(value, projectId, executionId))
  }
  async binding(cursor: FactoryExecution): Promise<FactoryRunBinding> {
    const actor = this.user()
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v2/runs/${encodeURIComponent(cursor.bRunId ?? '')}`,
      { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'X-OpenSaddle-User': actor, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) } })
    if (actor !== this.user()) throw Error('Factory account changed; reload before continuing')
    if (!response.ok) throw Error(`Factory second Run is unavailable (${response.status})`)
    const run = record(await response.json())
    if (actor !== this.user() || run.project_id !== cursor.projectId || run.run_id !== cursor.bRunId) throw Error('Factory second Run identity changed')
    const binding = record(record(record(run.policy).obligations).factory_binding)
    if (binding.execution_scope !== 'two_step_coding_prepared_goal' || binding.factory_id !== cursor.factoryId || binding.factory_version !== cursor.factoryVersion || binding.compile_digest !== cursor.compileDigest) throw Error('Factory second Run lineage changed')
    const checks = binding.fixed_acceptance_proof_checks
    if (!Array.isArray(checks) || !checks.length || checks.length > 16) throw Error('Factory criteria are invalid')
    const criteria = checks.map((raw,index) => { const item = record(raw); if (item.criterion_id !== `acceptance_${index+1}` || item.evidence_required !== true || item.human_acceptance_required !== true || typeof item.criterion !== 'string' || !item.criterion || item.criterion.length > 2000) throw Error('Factory criteria are invalid'); return {criterionId:item.criterion_id as string,criterion:item.criterion as string} })
    return {factoryId:cursor.factoryId,factoryVersion:cursor.factoryVersion,compileDigest:cursor.compileDigest,goalId:cleanName(binding.goal_id,400),criteria}
  }
  private intent(executionId: string, result: CodingResult, action: string): string {
    const review = result.review
    if (!review?.reviewId) throw Error('Exact human review ID is unavailable')
    const key = `opensaddle:factory-execution:${action}:v1:${this.baseUrl}:${this.user()}:${executionId}:${result.runId}:${result.artifactId}:${result.artifactDigest}:${review.reviewId}`
    try {
      const value = this.storage?.getItem(key) ?? crypto.randomUUID()
      if (!this.storage) throw Error()
      this.storage.setItem(key, value)
      if (this.storage.getItem(key) !== value) throw Error()
      return value
    } catch { throw Error('Factory action intent could not be saved; nothing was submitted') }
  }
  async advance(cursor: FactoryExecution, result: CodingResult): Promise<FactoryExecution> {
    if (cursor.state !== 'awaiting_a' || result.projectId !== cursor.projectId || result.runId !== cursor.aRunId ||
      result.review?.decision !== 'accepted' || result.executionStatus !== 'completed' || result.checksStatus !== 'passed' || result.limitations.length || !result.patch)
      throw Error('Accept the exact passing first-step result before advancing')
    const review = reviewId(result.review.reviewId)
    const response = await this.request(cursor.executionId, 'advance', { expected_a_run_id: cursor.aRunId,
      a_artifact_id: artifactId(result.artifactId), expected_a_artifact_digest: sha(result.artifactDigest),
      expected_a_review_id: review, idempotency_key: this.intent(cursor.executionId, result, 'advance') })
    const updated = this.parse(response, cursor.projectId, cursor.executionId)
    if (updated.state !== 'awaiting_b' || !updated.bRunId || updated.aRunId !== cursor.aRunId || updated.compileDigest !== cursor.compileDigest) throw Error('Factory advance receipt differs from the reviewed cursor')
    return updated
  }
  async accept(cursor: FactoryExecution, result: CodingResult, criteria: Array<{criterionId:string;criterion:string}>): Promise<Json> {
    if (cursor.state !== 'awaiting_b' || result.projectId !== cursor.projectId || result.runId !== cursor.bRunId ||
      result.review?.decision !== 'accepted' || result.executionStatus !== 'completed' || result.checksStatus !== 'passed' || result.limitations.length || !result.patch || !criteria.length)
      throw Error('Accept the exact passing second-step result and fixed criteria first')
    const response = await this.request(cursor.executionId, 'accept', { expected_b_run_id: cursor.bRunId,
      b_artifact_id: artifactId(result.artifactId), expected_b_artifact_digest: sha(result.artifactDigest),
      expected_b_review_id: reviewId(result.review.reviewId),
      criteria: criteria.map(item => ({ criterion_id: item.criterionId, decision: 'accepted', evidence_artifact_id: result.artifactId })) })
    if (response.schema_version !== 'opensaddle.factory-two-step-acceptance.v1' || response.execution_id !== cursor.executionId || response.project_id !== cursor.projectId || response.run_id !== cursor.bRunId || response.compile_digest !== cursor.compileDigest || response.artifact_id !== result.artifactId || response.artifact_digest !== result.artifactDigest || response.state !== 'applied') throw Error('Factory acceptance receipt is unconfirmed; refresh the execution')
    return response
  }
}
