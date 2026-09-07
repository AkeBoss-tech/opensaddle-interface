import type { EnvironmentRevision, ExactArtifactRef, ShellCommandDescriptor, ShellCommandResult } from '../../services/contracts'

export interface ReviewWorkspaceIdentity { projectId: string; runId: string }
export interface ReviewWorkspaceLoadedState {
  identity: ReviewWorkspaceIdentity
  artifacts: ExactArtifactRef[]
  selectedId: string
  result?: ShellCommandResult
}

export function hydrateReviewWorkspace(identity: ReviewWorkspaceIdentity, artifacts: ExactArtifactRef[], invocations: ShellCommandResult[], descriptor?: ShellCommandDescriptor, commandId = 'dev.opensaddle.artifact.review'): ReviewWorkspaceLoadedState {
  const result = [...invocations].reverse().find((item) => item.command_id === commandId
    && item.project_id === identity.projectId
    && item.resource.project_id === identity.projectId
    && item.resource.run_id === identity.runId
    && artifacts.some((artifact) => artifact.artifact_id === item.resource.artifact_id && artifact.digest === item.resource.digest)
    && (!descriptor || (item.version === descriptor.version && item.descriptor_digest === descriptor.descriptor_digest)))
  return {
    identity,
    artifacts,
    selectedId: result?.resource.artifact_id ?? artifacts[0]?.artifact_id ?? '',
    result,
  }
}

export function beginReviewWorkspaceTransition(identity: ReviewWorkspaceIdentity, current: ReviewWorkspaceLoadedState | undefined) {
  return current?.identity.projectId === identity.projectId && current.identity.runId === identity.runId ? current : undefined
}

export function buildReviewEnvironmentDefinition(environment: EnvironmentRevision, descriptor: ShellCommandDescriptor): EnvironmentRevision['definition'] {
  const ref = { command_id: descriptor.command_id, version: descriptor.version, descriptor_digest: descriptor.descriptor_digest }
  return {
    ...environment.definition,
    commands: [...environment.definition.commands.filter((item) => item.command_id !== ref.command_id), ref],
    bindings: environment.definition.bindings.includes('mod+shift+r') ? environment.definition.bindings : [...environment.definition.bindings, 'mod+shift+r'],
    services: environment.definition.services.some((item) => item.id === 'reviewer') ? environment.definition.services : [...environment.definition.services, { id: 'reviewer', status: 'dormant' }],
  }
}

export function reviewCommandUnavailableMessage(descriptor: ShellCommandDescriptor | undefined) {
  return descriptor?.available.reason ? `The review command is unavailable: ${descriptor.available.reason}` : 'The review command is unavailable.'
}

export function reviewCommandFailureTitle(error: string) {
  if (/stale_command_descriptor/.test(error)) return 'Command descriptor changed'
  if (/403|denied|revoked/i.test(error)) return 'Artifact access revoked'
  if (/404|not found/i.test(error)) return 'Review resources unavailable'
  return 'Review workspace failed'
}
