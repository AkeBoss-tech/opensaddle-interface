import assert from 'node:assert/strict'
import test from 'node:test'
import { projectOnboardingChangeFromWire, projectOnboardingStateFromWire } from '../src/services/projectOnboardingWire.ts'

const digest = (value: string) => `sha256:${value.repeat(64)}`
const descriptor = {
  recommendation_id: 'install-review-skill',
  discovery_fingerprint: digest('a'),
  artifact_kind: 'codex_skill',
  target_path: '.agents/skills/review-code/SKILL.md',
  target_contract: 'codex.project-skill/v1',
}
const option = { recommendation_id: 'install-review-skill', kind: 'project_action', title: 'Install review skill', summary: 'Install a reviewed project skill.', instruction: 'Write only the exact skill target.', allowed_paths: ['.agents/skills/review-code/SKILL.md'], verification: [{ name: 'check', command: 'test -f .agents/skills/review-code/SKILL.md', evidence: ['pyproject.toml'], timeout_seconds: 30 }], commit_message: 'Add project review skill', materialization: descriptor }
const state = { contract: 'opensaddle.project-onboarding/v1', project_id: 'demo', status: 'ready', runner: 'codex_cli', fingerprint: digest('a'), discovery: { contract: 'krail.project-discovery/v1', root: '/tmp/demo', mode: 'onboard', fingerprint: digest('a'), languages: ['python'], ecosystems: ['python'], file_count: 1, repository: { kind: 'git', revision: 'b'.repeat(40), dirty: false }, commands: [] }, profile: null, automation_recommendations: null, recommendation_options: [option], active_run_id: null, execution_head: 'b'.repeat(40), execution_ready: true, execution_barriers: [], refresh_required: false, error: null }
const validation = { contract: 'opensaddle.materialization-validation/v1', status: 'valid', recommendation_id: 'install-review-skill', artifact_kind: 'codex_skill', target_path: '.agents/skills/review-code/SKILL.md', target_contract: 'codex.project-skill/v1', semantic_name: 'review-code', description_digest: digest('c'), content_digest: digest('d'), byte_count: 123, activation_boundary: 'project' }
const change = { contract: 'opensaddle.onboarding-change-proposal/v1', project_id: 'demo', run_id: 'run-1', recommendation_id: 'install-review-skill', fingerprint: digest('a'), status: 'approval_required', diff_digest: digest('e'), changed_files: ['.agents/skills/review-code/SKILL.md'], patch: 'diff --git a/x b/x', verification: option.verification, activity: [], checks: [], profile: null, automation_recommendations: null, recommendation_options: [option], materialization_validation: validation }

const projections: Array<[string, () => unknown, unknown]> = [
  ['projects discovery ecosystems', () => projectOnboardingStateFromWire(state, 'demo').discovery?.ecosystems, ['python']],
  ['projects materialization recommendation binding', () => projectOnboardingStateFromWire(state, 'demo').recommendationOptions[0]?.materialization?.recommendationId, 'install-review-skill'],
  ['projects materialization discovery binding', () => projectOnboardingStateFromWire(state, 'demo').recommendationOptions[0]?.materialization?.discoveryFingerprint, digest('a')],
  ['projects materialization artifact kind', () => projectOnboardingStateFromWire(state, 'demo').recommendationOptions[0]?.materialization?.artifactKind, 'codex_skill'],
  ['projects materialization target path', () => projectOnboardingStateFromWire(state, 'demo').recommendationOptions[0]?.materialization?.targetPath, '.agents/skills/review-code/SKILL.md'],
  ['projects materialization target contract', () => projectOnboardingStateFromWire(state, 'demo').recommendationOptions[0]?.materialization?.targetContract, 'codex.project-skill/v1'],
  ['projects validation receipt contract', () => projectOnboardingChangeFromWire(change, 'demo').materializationValidation?.contract, 'opensaddle.materialization-validation/v1'],
  ['projects validation receipt status', () => projectOnboardingChangeFromWire(change, 'demo').materializationValidation?.status, 'valid'],
  ['projects validation semantic name', () => projectOnboardingChangeFromWire(change, 'demo').materializationValidation?.semanticName, 'review-code'],
  ['projects validation description digest', () => projectOnboardingChangeFromWire(change, 'demo').materializationValidation?.descriptionDigest, digest('c')],
  ['projects validation content digest', () => projectOnboardingChangeFromWire(change, 'demo').materializationValidation?.contentDigest, digest('d')],
  ['projects validation byte count', () => projectOnboardingChangeFromWire(change, 'demo').materializationValidation?.byteCount, 123],
  ['projects validation activation boundary', () => projectOnboardingChangeFromWire(change, 'demo').materializationValidation?.activationBoundary, 'project'],
]
for (const [name, actual, expected] of projections) test(name, () => assert.deepEqual(actual(), expected))

test('projects discovery projects authoritative ecosystem objects to their names', () => {
  const authoritative = structuredClone(state)
  authoritative.discovery.ecosystems = [
    { ecosystem: 'python', manifests: ['pyproject.toml'], evidence: [] },
    { name: 'node', manifests: [], evidence: [] },
  ] as unknown as string[]
  assert.deepEqual(projectOnboardingStateFromWire(authoritative, 'demo').discovery?.ecosystems, ['python', 'node'])
})

const invalidDescriptors: Array<[string, Record<string, unknown>]> = [
  ['rejects absolute materialization paths', { target_path: '/tmp/SKILL.md' }],
  ['rejects parent materialization traversal', { target_path: '../SKILL.md' }],
  ['rejects backslash materialization paths', { target_path: '.agents\\skills\\x\\SKILL.md' }],
  ['rejects unknown materialization artifact kinds', { artifact_kind: 'shell_script' }],
  ['rejects unknown materialization target contracts', { target_contract: 'arbitrary/v1' }],
  ['rejects noncanonical discovery fingerprint', { discovery_fingerprint: 'abc' }],
  ['rejects empty materialization recommendation id', { recommendation_id: '' }],
]
for (const [name, mutation] of invalidDescriptors) test(name, () => {
  const mutated = structuredClone(state)
  mutated.recommendation_options[0]!.materialization = { ...descriptor, ...mutation } as typeof descriptor
  assert.throws(() => projectOnboardingStateFromWire(mutated, 'demo'))
})

const invalidValidations: Array<[string, Record<string, unknown>]> = [
  ['rejects unversioned validation receipts', { contract: 'materialization' }],
  ['rejects non-valid validation status', { status: 'unknown' }],
  ['rejects host activation boundary', { activation_boundary: 'host' }],
  ['rejects zero-byte materialization', { byte_count: 0 }],
  ['rejects fractional byte count', { byte_count: 1.5 }],
  ['rejects invalid description digest', { description_digest: 'sha256:no' }],
  ['rejects invalid content digest', { content_digest: 'sha256:no' }],
  ['rejects empty semantic name', { semantic_name: '' }],
]
for (const [name, mutation] of invalidValidations) test(name, () => {
  const mutated = structuredClone(change)
  mutated.materialization_validation = { ...validation, ...mutation } as typeof validation
  assert.throws(() => projectOnboardingChangeFromWire(mutated, 'demo'))
})
