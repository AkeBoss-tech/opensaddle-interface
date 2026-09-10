import { RemoteMalleableShellClient } from './remoteMalleableShell'
import type { CodingTaskSpec } from '../features/onboarding/CodingTaskOptions'
export type CodingCheck = { argv: string[]; exit_code: number | null; stdout: string; stderr: string; timed_out: boolean; output_truncated?: Array<'stdout' | 'stderr' | 'descendant_cleanup'> }
export type CodingResult = {
  projectId: string; runId: string; artifactId: string; artifactDigest: string
  allowedPaths: string[]; sourceRevision: string; taskSpecDigest: string; executionStatus: 'completed' | 'failed' | 'interrupted'; checksStatus: 'passed' | 'failed' | 'not_run'
  patch: string; patchDigest: string; checks: CodingCheck[]; limitations: string[]
  baseline?: {workspaceDigest:string;indexDigest:string;files:Array<{path:string;digest:string|null}>}; verificationBeforeDigest?:string; verificationAfterDigest?:string; observationScope?:string
  review: null | { decision: 'accepted' | 'rejected'; reviewedBy: string; reviewedAt: string }
}
export interface CodingResultAuthority {
  read(projectId: string, runId: string): Promise<CodingResult>
  decide(result: CodingResult, decision: 'accepted' | 'rejected', intentId: string): Promise<unknown>
}
type Json = Record<string, unknown>
function object(value: unknown): Json { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Coding result response is invalid'); return value as Json }
function text(value: unknown, bound = 2048): string { if (typeof value !== 'string' || !value || value.length > bound) throw Error('Coding result identity is invalid'); return value }
function sha(value: unknown): string { const result = text(value); if (!/^(sha256:)?[a-f0-9]{64}$/.test(result)) throw Error('Coding result digest is invalid'); return result }
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('') }
export class CodingResultReviewClient implements CodingResultAuthority {
  private readonly baseUrl: string; private readonly user: () => string; private readonly token?: string
  constructor(baseUrl: string, user: () => string, token?: string) { this.baseUrl = baseUrl; this.user = user; this.token = token }
  private async request(runId: string, body?: unknown, runOnly = false) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v2/runs/${encodeURIComponent(runId)}${runOnly ? '' : '/coding-result/review'}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-OpenSaddle-User': this.user(), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok) throw Error(`Coding result unavailable (${response.status}). Refresh before deciding; the result or authorization may have changed.`)
    return object(await response.json())
  }
  async read(projectId: string, runId: string): Promise<CodingResult> {
    const value = await this.request(runId)
    if (value.schema_version !== 'opensaddle.coding-result-review.v1' || value.project_id !== projectId || value.run_id !== runId) throw Error('Coding result Project or Run identity is invalid')
    const artifactId = text(value.artifact_id), artifactDigest = text(value.artifact_digest)
    if (!/^[a-f0-9]{64}$/.test(artifactDigest)) throw Error('Coding result artifact digest is invalid')
    const content = await new RemoteMalleableShellClient(this.baseUrl, this.user, this.token).content({ project_id: projectId, run_id: runId, artifact_id: artifactId, digest: artifactDigest })
    const manifest = object(JSON.parse(content.text)), patch = object(manifest.patch)
    if (manifest.schema_version !== 'opensaddle.coding-result.v1' || manifest.project_id !== projectId || manifest.run_id !== runId || !['completed','failed','interrupted'].includes(String(manifest.execution_status)) || !['passed','failed','not_run'].includes(String(manifest.checks_status)) || patch.format !== 'unified-diff' || typeof patch.text !== 'string' || patch.text.length > 200000 || !Array.isArray(manifest.checks) || manifest.checks.length > 16 || !Array.isArray(manifest.limitations) || manifest.limitations.length > 64) throw Error('Coding result manifest contract is invalid')
    const patchDigest = sha(patch.sha256)
    if (await hash(patch.text) !== patchDigest.replace(/^sha256:/, '')) throw Error('Coding result patch bytes do not match their digest')
    const checks = manifest.checks.map(raw => { const check = object(raw); if (!Array.isArray(check.argv) || !check.argv.length || check.argv.length > 64 || check.argv.some(arg => typeof arg !== 'string' || !arg || arg.length > 4096) || !(check.exit_code === null || Number.isSafeInteger(check.exit_code)) || typeof check.stdout !== 'string' || typeof check.stderr !== 'string' || check.stdout.length > 200000 || check.stderr.length > 200000 || typeof check.timed_out !== 'boolean' || (check.output_truncated !== undefined && (!Array.isArray(check.output_truncated) || check.output_truncated.some(item => item !== 'stdout' && item !== 'stderr' && item !== 'descendant_cleanup')))) throw Error('Coding result verification receipt is invalid'); return check as CodingCheck })
    if (manifest.checks_status === 'passed' && (!checks.length || checks.some(check => check.exit_code !== 0 || check.timed_out))) throw Error('Coding result claims passing checks without successful receipts')
    const sourceRevision = text(manifest.source_revision)
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceRevision)) throw Error('Coding result source revision is invalid')
    const run = await this.request(runId, undefined, true)
    if (run.project_id !== projectId || run.run_id !== runId) throw Error('Coding result Run binding is invalid')
    const obligations = object(object(run.policy).obligations), spec = object(obligations.coding_task)
    if (spec.schema_version !== 'opensaddle.coding-task.v1' || !Array.isArray(spec.allowed_paths) || !spec.allowed_paths.length || spec.allowed_paths.length > 32 || !Array.isArray(spec.verification_commands) || !spec.verification_commands.length || spec.verification_commands.length > 16) throw Error('Coding result task specification is invalid')
    const canonical = (value: unknown): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Json)[key])).join(',') + '}' : JSON.stringify(value)
    const specificationDigest = await hash(canonical(spec))
    if (sha(manifest.task_spec_digest).replace(/^sha256:/, '') !== specificationDigest || obligations.coding_task_digest !== specificationDigest || obligations.coding_task_source_revision !== sourceRevision) throw Error('Coding result does not match the exact admitted arguments or source revision')
    const plannedChecks = spec.verification_commands
    if (checks.length > plannedChecks.length || checks.some((check,index) => JSON.stringify(check.argv) !== JSON.stringify(plannedChecks[index])) || (manifest.checks_status === 'passed' && checks.length !== plannedChecks.length)) throw Error('Coding result check receipts do not match the exact admitted verification commands')
    const allowedPaths = spec.allowed_paths.map(value => text(value))
    let baseline: CodingResult['baseline']
    if (manifest.baseline !== undefined) {
      const captured = object(manifest.baseline)
      if (!Array.isArray(captured.files) || captured.files.length > 32) throw Error('Coding result launch baseline is invalid')
      baseline = { workspaceDigest: sha(captured.workspace_digest), indexDigest: sha(captured.index_digest), files: captured.files.map(raw => { const file = object(raw); return { path: text(file.path), digest: file.sha256 === null ? null : sha(file.sha256) } }) }
    }
    const verificationBeforeDigest = manifest.verification_before_digest === undefined ? undefined : sha(manifest.verification_before_digest)
    const verificationAfterDigest = manifest.verification_after_digest === undefined ? undefined : sha(manifest.verification_after_digest)
    if (manifest.checks_status === 'passed' && verificationBeforeDigest !== verificationAfterDigest) throw Error('Coding verification changed the captured working bytes')
    let review: CodingResult['review'] = null
    if (value.review !== null) { const recorded = object(value.review); if (recorded.decision !== 'accepted' && recorded.decision !== 'rejected') throw Error('Coding result human decision is invalid'); review = { decision: recorded.decision, reviewedBy: text(recorded.reviewed_by), reviewedAt: text(recorded.reviewed_at) } }
    return { baseline, verificationBeforeDigest, verificationAfterDigest, observationScope: manifest.observation_scope === undefined ? undefined : text(manifest.observation_scope,8192), projectId, runId, artifactId, artifactDigest, allowedPaths, sourceRevision, taskSpecDigest: sha(manifest.task_spec_digest), executionStatus: manifest.execution_status as CodingResult['executionStatus'], checksStatus: manifest.checks_status as CodingResult['checksStatus'], patch: patch.text, patchDigest, checks, limitations: manifest.limitations.map(value => text(value, 8192)), review }
  }
  decide(result: CodingResult, decision: 'accepted' | 'rejected', intentId: string) { return this.request(result.runId, { artifact_id: result.artifactId, expected_artifact_digest: result.artifactDigest, decision, idempotency_key: intentId }) }
}
export type { CodingTaskSpec }
