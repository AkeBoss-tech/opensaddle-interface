import type { CodingResult } from './codingResultReview'
import type { CodingTaskSpec } from '../features/onboarding/CodingTaskOptions'

type Row = Record<string, unknown>
const object = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Factory response is invalid')
  return value as Row
}
const name = (value: unknown, max = 400): string => {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw Error('Factory identity is invalid')
  return value
}
const digest = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('Factory digest is invalid')
  return value
}
const version = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw Error('Factory version is invalid')
  return Number(value)
}
const strings = (value: unknown, max = 16): string[] => {
  if (!Array.isArray(value) || value.length > max) throw Error('Factory list is invalid')
  return value.map(item => name(item, 4000))
}

export interface FactoryBlueprint {
  contributionId: string; packageId: string; packageVersion: string; manifestDigest: string
  goalTemplate: string; acceptanceTemplate: string[]
}
export interface FactoryDefinition {
  factoryId: string; projectId: string; version: number; name: string; blueprintId: string
  packageId: string; packageVersion: string; manifestDigest: string
  parameterDefaults: Record<string, string>; codingTask: CodingTaskSpec
  blueprintCurrentlyEnabled: boolean
}
export interface FactoryPlan {
  factoryId: string; factoryVersion: number; projectId: string; compileDigest: string; manifestDigest: string
  parameters: Record<string, string>; source: { sourceId: string; revision: string; digest: string }
  objective: string; criteria: Array<{ criterionId: string; criterion: string }>
  task: string; adapterId: 'codex-app-server'; codingTask: CodingTaskSpec
  scopes: string[]; adapterVersion: string; adapterConfigDigest: string
}
export interface FactoryPreparation { preparationId: string; goalId: string; goalVersion: number; goalRevision: number; compileDigest: string }
export interface FactoryRunBinding { factoryId: string; factoryVersion: number; compileDigest: string; criteria: FactoryPlan['criteria']; goalId: string }
export interface FactoryAcceptance { runId: string; projectId: string; compileDigest: string; artifactId: string; artifactDigest: string; state: 'pending' | 'applied'; receiptDigest: string }

function codingTask(value: unknown): CodingTaskSpec {
  const row = object(value)
  if (row.schema_version !== 'opensaddle.coding-task.v1' || !Array.isArray(row.allowed_paths) || !Array.isArray(row.verification_commands)
      || row.allowed_paths.length < 1 || row.allowed_paths.length > 32 || row.verification_commands.length < 1 || row.verification_commands.length > 16)
    throw Error('Factory coding scope is invalid')
  const allowed_paths = row.allowed_paths.map(item => name(item, 1000))
  const verification_commands = row.verification_commands.map(raw => {
    if (!Array.isArray(raw) || !raw.length || raw.length > 64) throw Error('Factory verification scope is invalid')
    return raw.map(item => name(item, 4096))
  })
  return { schema_version: 'opensaddle.coding-task.v1', allowed_paths, verification_commands }
}
function parameters(value: unknown): Record<string, string> {
  const row = object(value)
  if (Object.keys(row).length > 100) throw Error('Factory parameters are invalid')
  return Object.fromEntries(Object.entries(row).map(([key, item]) => [name(key, 100), name(item, 4000)]))
}
function blueprint(value: unknown): FactoryBlueprint {
  const row = object(value), descriptor = object(row.descriptor)
  return { contributionId: name(row.contribution_id), packageId: name(row.package_id), packageVersion: name(row.package_version, 100), manifestDigest: digest(row.manifest_digest), goalTemplate: name(descriptor.goal_template, 4000), acceptanceTemplate: strings(descriptor.acceptance_template) }
}
function definition(value: unknown, projectId: string): FactoryDefinition | null {
  const row = object(value), policy = object(row.policy)
  if (policy.repo_task === undefined) return null
  const repoTask = object(policy.repo_task)
  if (repoTask.execution_profile === undefined) return null
  const profile = object(repoTask.execution_profile)
  if (profile.kind !== 'single_coding_run') return null
  if (row.project_id !== projectId || profile.kind !== 'single_coding_run' || repoTask.adapter_id !== 'codex-app-server') throw Error('Factory definition is not a supported coding Run')
  return { factoryId: name(row.factory_id, 200), projectId, version: version(row.version), name: name(row.name, 200), blueprintId: name(row.blueprint_id), packageId: name(row.package_id), packageVersion: name(row.package_version, 100), manifestDigest: digest(row.manifest_digest), parameterDefaults: parameters(row.parameter_defaults), codingTask: codingTask(profile.coding_task), blueprintCurrentlyEnabled: row.blueprint_currently_enabled === true }
}
function plan(value: unknown, projectId: string, factoryId: string, factoryVersion: number, sourceId: string): FactoryPlan {
  const row = object(value), source = object(row.source_pin), goal = object(row.proposed_goal), run = object(row.proposed_run_intent), profile = object(row.launch_profile)
  if (row.schema_version !== 'opensaddle.factory-repo-task-compile.v1' || row.project_id !== projectId || row.factory_id !== factoryId || row.factory_version !== factoryVersion
      || source.source_id !== sourceId || goal.project_id !== projectId || run.project_id !== projectId || run.source_id !== sourceId
      || profile.state !== 'profile_complete_pending_live_admission' || profile.adapter_id !== 'codex-app-server'
      || run.native_adapter_id !== 'codex-app-server' || run.task !== goal.objective || row.dry_run !== true || row.dispatch_authorized !== false)
    throw Error('Factory preview changed identity or is not reviewable')
  const checks = row.acceptance_proof_checks
  if (!Array.isArray(checks) || !checks.length || checks.length > 16) throw Error('Factory criteria are invalid')
  const criteria = checks.map((raw, index) => { const item = object(raw); if (item.criterion_id !== `acceptance_${index + 1}` || item.evidence_required !== true || item.human_acceptance_required !== true) throw Error('Factory criteria are invalid'); return { criterionId: item.criterion_id as string, criterion: name(item.criterion, 2000) } })
  if (JSON.stringify(criteria.map(item => item.criterion)) !== JSON.stringify(strings(goal.acceptance_criteria))) throw Error('Factory criteria changed')
  return { factoryId, factoryVersion, projectId, compileDigest: digest(row.compile_digest), manifestDigest: digest(row.manifest_digest), parameters: parameters(row.resolved_parameters), source: { sourceId, revision: name(source.revision, 200), digest: digest(source.snapshot_digest) }, objective: name(goal.objective, 4000), criteria, task: name(run.task, 4000), adapterId: 'codex-app-server', codingTask: codingTask(profile.coding_task), scopes: strings(profile.requested_scopes_for_policy_review), adapterVersion: name(profile.adapter_version, 100), adapterConfigDigest: digest(profile.adapter_config_digest) }
}

export class FactoryConflict extends Error {}
class FactoryMissing extends Error {}
export class FactoryCodingClient {
  private intents = new Map<string, string>()
  private baseUrl: string
  private user: () => string
  private token?: string
  readonly configuredWorkerId: string
  readonly adapterBinding: {adapter_id:string;adapter_version:string;adapter_config_digest:string}
  private storage?: Storage
  constructor(baseUrl: string, user: () => string, token?: string, configuredWorkerId = '', adapterBinding: {adapter_id:string;adapter_version:string;adapter_config_digest:string} = {adapter_id:'',adapter_version:'',adapter_config_digest:''}, storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage) { this.baseUrl=baseUrl;this.user=user;this.token=token;this.configuredWorkerId=configuredWorkerId;this.adapterBinding=adapterBinding;this.storage=storage }
  identity() { return this.user() }
  private async request(path: string, method = 'GET', body?: unknown): Promise<Row> {
    const actor = this.user()
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'X-OpenSaddle-User': actor, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (actor !== this.user()) throw Error('Factory account changed; reload before continuing')
    if (response.status === 409) throw new FactoryConflict('Factory, source, Goal, or permission changed. Refresh the preview and review the new plan before continuing.')
    if (response.status === 404) throw new FactoryMissing('Factory resource is unavailable')
    if (response.status === 401 || response.status === 403) throw Error('Factory authority is unavailable. Refresh Project access.')
    if (!response.ok) throw Error(`Factory request outcome is unconfirmed (${response.status}). Reload before retrying the same action.`)
    const payload = object(await response.json())
    if (actor !== this.user()) throw Error('Factory account changed; reload before continuing')
    return payload
  }
  async blueprints(projectId: string): Promise<FactoryBlueprint[]> {
    return this.pages(projectId,'factory-blueprints','opensaddle.factory-blueprints.v1',blueprint)
  }
  async definitions(projectId: string): Promise<FactoryDefinition[]> {
    return (await this.pages(projectId,'factories','opensaddle.factory-definitions.v1',item=>definition(item,projectId))).filter((item):item is FactoryDefinition=>item!==null)
  }
  private async pages<T>(projectId:string,resource:string,schema:string,parse:(value:unknown)=>T):Promise<T[]> {
    const result:T[]=[];let offset=0
    for(let page=0;page<10;page++) {
      const row=await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/${resource}?offset=${offset}&limit=100`)
      if(row.schema_version!==schema||row.project_id!==projectId||!Array.isArray(row.items)||row.items.length>100)throw Error('Factory catalog identity is invalid')
      result.push(...row.items.map(parse))
      if(row.next_offset===null)return result
      if(!Number.isSafeInteger(row.next_offset)||Number(row.next_offset)<=offset||Number(row.next_offset)!==offset+row.items.length)throw Error('Factory catalog cursor is invalid')
      offset=Number(row.next_offset)
    }
    throw Error('Factory catalog is too large for this view')
  }
  async create(projectId: string, nameValue: string, blueprintId: string, defaults: Record<string,string>, spec: CodingTaskSpec, adapter: {adapter_id:string;adapter_version:string;adapter_config_digest:string}): Promise<FactoryDefinition> {
    const repoTask = { ...adapter, allowed_scopes: ['repository:read','repository:write'], steps: [{ id: 'implementation', depends_on: [], required_capabilities: ['code.edit','tests.run'], requested_scopes: ['repository:read','repository:write'] }], execution_profile: { kind: 'single_coding_run', coding_task: spec } }
    const row = await this.request(`/api/v2/projects/${encodeURIComponent(projectId)}/factories`, 'POST', { name: nameValue, blueprint_id: blueprintId, parameter_defaults: defaults, repo_task: repoTask })
    const created=definition(row, projectId)
    if(!created)throw Error('Created Factory has no supported coding profile')
    return created
  }
  async preview(projectId: string, factoryId: string, factoryVersion: number, sourceId: string, values: Record<string,string>): Promise<FactoryPlan> {
    return plan(await this.request(`/api/v2/factories/${encodeURIComponent(factoryId)}/compile`, 'POST', { project_id: projectId, source_id: sourceId, factory_version: factoryVersion, parameters: values }), projectId, factoryId, factoryVersion, sourceId)
  }
  async prepare(value: FactoryPlan): Promise<FactoryPreparation> {
    const row = await this.request(`/api/v2/factories/${encodeURIComponent(value.factoryId)}/prepare-goal`, 'POST', { project_id: value.projectId, source_id: value.source.sourceId, factory_version: value.factoryVersion, parameters: value.parameters, expected_compile_digest: value.compileDigest })
    if (row.schema_version !== 'opensaddle.factory-coding-goal-preparation.v1' || row.project_id !== value.projectId || row.factory_id !== value.factoryId || row.factory_version !== value.factoryVersion || row.compile_digest !== value.compileDigest || row.goal_status !== 'ready') throw Error('Factory Goal preparation does not match the reviewed preview')
    return { preparationId: name(row.preparation_id), goalId: name(row.goal_id), goalVersion: version(row.goal_version), goalRevision: Number(row.goal_revision), compileDigest: value.compileDigest }
  }
  async launch(value: FactoryPlan, prepared: FactoryPreparation): Promise<string> {
    if (prepared.compileDigest !== value.compileDigest) throw Error('Factory Goal and preview differ')
    const actor = this.user()
    const body = { project_id: value.projectId, source_id: value.source.sourceId, task: value.task, native_adapter_id: value.adapterId, coding_task: value.codingTask, factory_binding: { factory_id: value.factoryId, factory_version: value.factoryVersion, compile_digest: value.compileDigest, parameters: value.parameters, goal_preparation_id: prepared.preparationId } }
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([this.baseUrl, actor, body])))), byte => byte.toString(16).padStart(2,'0')).join('')
    const key = `opensaddle:factory-run-intent:v1:${fingerprint}`
    let intent: string
    try { intent = this.storage?.getItem(key) ?? this.intents.get(key) ?? crypto.randomUUID(); if (this.storage) { this.storage.setItem(key, intent); if (this.storage.getItem(key) !== intent) throw Error() } else if (typeof window !== 'undefined') throw Error(); else this.intents.set(key,intent) }
    catch { throw Error('Factory submission intent could not be saved; no Run was submitted') }
    if (actor !== this.user()) throw Error('Factory account changed; no Run was submitted')
    const row = await this.request('/api/v2/runs', 'POST', { ...body, idempotency_key: intent })
    if (row.project_id !== value.projectId || typeof row.run_id !== 'string' || !row.run_id) throw Error('Factory Run receipt is unconfirmed; retry the same reviewed plan')
    return row.run_id
  }
  async acceptance(projectId: string, runId: string): Promise<FactoryAcceptance | null> {
    try { return this.parseAcceptance(await this.request(`/api/v2/runs/${encodeURIComponent(runId)}/factory-acceptance`), projectId, runId) }
    catch (error) { if (error instanceof FactoryMissing) return null; throw error }
  }
  async runBinding(projectId: string, runId: string): Promise<FactoryRunBinding | null> {
    const run = await this.request(`/api/v2/runs/${encodeURIComponent(runId)}`)
    if (run.project_id !== projectId || run.run_id !== runId) throw Error('Factory Run identity changed')
    const policy = object(run.policy), obligations = object(policy.obligations)
    if (obligations.factory_binding === undefined) return null
    const binding = object(obligations.factory_binding)
    const checks = binding.fixed_acceptance_proof_checks
    if (!Array.isArray(checks) || !checks.length || checks.length > 16) throw Error('Factory Run criteria are invalid')
    const criteria = checks.map((raw,index) => { const row = object(raw); if (row.criterion_id !== `acceptance_${index+1}` || row.evidence_required !== true || row.human_acceptance_required !== true) throw Error('Factory Run criteria are invalid'); return {criterionId:row.criterion_id as string,criterion:name(row.criterion,2000)} })
    return { factoryId:name(binding.factory_id,200), factoryVersion:version(binding.factory_version), compileDigest:digest(binding.compile_digest), goalId:name(binding.goal_id), criteria }
  }
  async accept(projectId: string, runId: string, compileDigest: string, result: CodingResult, criteria: FactoryPlan['criteria']): Promise<FactoryAcceptance> {
    if (result.projectId !== projectId || result.runId !== runId || result.review?.decision !== 'accepted' || result.checksStatus !== 'passed' || result.executionStatus !== 'completed' || result.limitations.length) throw Error('Accept the exact passing coding result before Factory criteria')
    const row = await this.request(`/api/v2/runs/${encodeURIComponent(runId)}/factory-acceptance`, 'POST', { expected_compile_digest: compileDigest, artifact_id: result.artifactId, expected_artifact_digest: result.artifactDigest, criteria: criteria.map(item => ({ criterion_id: item.criterionId, decision: 'accepted', evidence_artifact_id: result.artifactId })) })
    const accepted=this.parseAcceptance(row, projectId, runId)
    if(accepted.compileDigest!==compileDigest||accepted.artifactId!==result.artifactId||accepted.artifactDigest!==result.artifactDigest)throw Error('Factory acceptance receipt differs from the exact reviewed evidence')
    return accepted
  }
  private parseAcceptance(value: Row, projectId: string, runId: string): FactoryAcceptance {
    if (value.schema_version !== 'opensaddle.factory-coding-acceptance.v1' || value.project_id !== projectId || value.run_id !== runId || (value.state !== 'pending' && value.state !== 'applied')) throw Error('Factory acceptance identity is invalid')
    return { projectId, runId, state: value.state, compileDigest: digest(value.compile_digest), artifactId: name(value.artifact_id), artifactDigest: digest(value.artifact_digest), receiptDigest: digest(value.receipt_digest) }
  }
}
