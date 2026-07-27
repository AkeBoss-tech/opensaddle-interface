import type { HarnessExecutionPolicy } from './types.js'

export type RunExecutionMode = 'plan' | 'review' | 'project' | 'full-access'

const DEFAULT_PROJECT_POLICY: HarnessExecutionPolicy = {
  sandbox: 'workspace-write',
  approvals: 'on-request',
  network: false,
  allowedTools: [],
  deniedTools: [],
}

/**
 * Converts the task-level mode shown in the composer into the concrete policy
 * passed to every local harness. Explicit tool denials remain authoritative.
 */
export function policyForExecutionMode(
  mode: RunExecutionMode,
  base?: HarnessExecutionPolicy,
): HarnessExecutionPolicy {
  const policy = base ?? DEFAULT_PROJECT_POLICY
  if (mode === 'plan') {
    return {
      ...policy,
      sandbox: 'read-only',
      approvals: 'always',
      network: false,
    }
  }
  if (mode === 'review') {
    return {
      ...policy,
      sandbox: 'workspace-write',
      approvals: 'on-request',
      network: false,
    }
  }
  if (mode === 'full-access') {
    return {
      ...policy,
      sandbox: 'full-access',
      approvals: 'never',
      network: true,
    }
  }
  return {
    ...policy,
    allowedTools: [...policy.allowedTools],
    deniedTools: [...policy.deniedTools],
  }
}
