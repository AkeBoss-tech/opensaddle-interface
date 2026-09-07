import assert from 'node:assert/strict'
import test from 'node:test'
import type { EnvironmentRevision, ExactArtifactRef, ShellCommandDescriptor, ShellCommandResult } from '../../services/contracts'
import { beginReviewWorkspaceTransition, buildReviewEnvironmentDefinition, hydrateReviewWorkspace, reviewCommandFailureTitle, reviewCommandUnavailableMessage } from './reviewWorkspaceModel'

const artifact = (id: string, digest: string): ExactArtifactRef => ({ project_id: 'project-1', run_id: 'run-1', artifact_id: id, digest })
const invocation = (id: string, resource: ExactArtifactRef, version = 1): ShellCommandResult => ({ invocation_id: id, project_id: resource.project_id, command_id: 'dev.opensaddle.artifact.review', version, descriptor_digest: `descriptor-${version}`, invoked_by: 'user-1', created_at: '2026-09-07T04:00:00Z', resource, input: {}, status: 'completed', result: { verified: false }, receipt: { effect: 'read', resource_digest: resource.digest, verified: false } })
const descriptor = (version: number, digest: string): ShellCommandDescriptor => ({ schema_version: 'opensaddle.command.v1', command_id: 'dev.opensaddle.artifact.review', version, descriptor_digest: digest, title: 'Review artifacts', description: 'Review', effect: 'read', required_actions: ['artifacts:read'], available: { available: true }, input_schema: {}, output_schema: {} } as ShellCommandDescriptor)

test('restores a durable result only with its exact artifact and descriptor identity', () => {
  const a = artifact('A', 'digest-A'); const b = artifact('B', 'digest-B')
  const state = hydrateReviewWorkspace({ projectId: 'project-1', runId: 'run-1' }, [a, b], [invocation('exact-B', b), invocation('stale-version-A', a, 2)], descriptor(1, 'descriptor-1'))
  assert.equal(state.selectedId, 'B')
  assert.equal(state.result?.resource.artifact_id, state.selectedId)
  assert.equal(state.result?.invocation_id, 'exact-B')
})

test('replaces a stale command ref with the exact discovered descriptor', () => {
  const environment = { definition: { commands: [{ command_id: 'dev.opensaddle.artifact.review', version: 1, descriptor_digest: 'old' }], bindings: [], services: [], packages: [] } } as unknown as EnvironmentRevision
  assert.deepEqual(buildReviewEnvironmentDefinition(environment, descriptor(2, 'new')).commands, [{ command_id: 'dev.opensaddle.artifact.review', version: 2, descriptor_digest: 'new' }])
})

test('a route transition synchronously clears actionable state', () => {
  const current = hydrateReviewWorkspace({ projectId: 'project-1', runId: 'run-1' }, [artifact('A', 'digest-A')], [])
  assert.equal(beginReviewWorkspaceTransition({ projectId: 'project-2', runId: 'run-2' }, current), undefined)
})

test('announces the authoritative unavailable reason', () => {
  const unavailable = { ...descriptor(1, 'digest'), available: { available: false, reason: 'artifact registry offline' } }
  assert.match(reviewCommandUnavailableMessage(unavailable), /artifact registry offline/)
})

test('labels a stale descriptor response without treating it as an access failure', () => {
  assert.equal(reviewCommandFailureTitle('{"code":"stale_command_descriptor"}'), 'Command descriptor changed')
})
