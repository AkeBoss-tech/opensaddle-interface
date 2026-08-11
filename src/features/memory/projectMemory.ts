import type {
  LocalProjectClient,
  ProjectMemoryOperation,
  ProjectMemoryOperationStage,
} from '../../services/contracts'

export const MEMORY_PROPOSAL_ID = 'project-memory'

export function managedMemoryProjectId(root: string): string {
  let hash = 5381
  for (const character of root.replace(/[\\/]+$/, '').toLowerCase()) hash = (hash * 33) ^ character.charCodeAt(0)
  return `local-${(hash >>> 0).toString(36)}`
}

export function memoryOperationStage(operation: ProjectMemoryOperation): ProjectMemoryOperationStage {
  if (operation.status === 'failed') return 'failed'
  if (operation.status === 'succeeded') return 'ready'
  return operation.stage
}

export async function waitForMemoryOperation(
  client: LocalProjectClient,
  projectId: string,
  initial: ProjectMemoryOperation,
  options: { intervalMs?: number; maxPolls?: number; onUpdate?: (operation: ProjectMemoryOperation) => void } = {},
): Promise<ProjectMemoryOperation> {
  const intervalMs = options.intervalMs ?? 500
  const maxPolls = options.maxPolls ?? 240
  let operation = initial
  options.onUpdate?.(operation)
  for (let attempt = 0; operation.status === 'queued' || operation.status === 'running'; attempt += 1) {
    if (!client.memoryOperation) throw new Error('The connected backend cannot report Project Memory operation status.')
    if (attempt >= maxPolls) throw new Error('Project Memory setup is still running. Refresh to inspect the authoritative operation.')
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
    operation = await client.memoryOperation(projectId, operation.operationId)
    options.onUpdate?.(operation)
  }
  if (operation.status === 'failed') {
    const error = new Error(operation.error ?? operation.message ?? 'Project Memory operation failed.')
    Object.assign(error, { retryable: operation.retryable, operation })
    throw error
  }
  return operation
}

