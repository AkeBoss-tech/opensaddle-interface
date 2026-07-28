import type { HarnessExecutionPolicy } from './types.js'

export type RunExecutionMode = 'plan' | 'review' | 'project' | 'full-access'
export type TaskCapabilityId = 'Browser' | 'Network' | 'Secure VM' | 'Subagents'
export type HarnessPolicyControls = 'native' | 'sandbox-only' | 'provider-defined'

const CAPABILITY_DENIALS: Record<TaskCapabilityId, string[]> = {
  Browser: ['mcp__browser__*', 'mcp__chrome__*', 'browser_*', 'chrome_*'],
  Network: ['WebFetch', 'WebSearch', 'web_fetch', 'web_search'],
  'Secure VM': ['mcp__opensaddle__create_vm', 'create_vm', 'provision_vm'],
  Subagents: ['Task', 'Agent', 'delegate', 'spawn_agent'],
}
const TASK_CAPABILITIES = Object.keys(CAPABILITY_DENIALS) as TaskCapabilityId[]

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

/**
 * Narrows an execution-mode policy using the task capability switches. These
 * switches never broaden an admin-defined policy and never disable the core
 * repository tools governed by the sandbox mode itself.
 */
export function applyTaskCapabilities(
  policy: HarnessExecutionPolicy,
  enabled?: readonly TaskCapabilityId[],
): HarnessExecutionPolicy {
  if (!enabled) return {
    ...policy,
    allowedTools: [...policy.allowedTools],
    deniedTools: [...policy.deniedTools],
  }
  const selected = new Set(enabled)
  const disabledPatterns = (Object.keys(CAPABILITY_DENIALS) as TaskCapabilityId[])
    .filter((capability) => !selected.has(capability))
    .flatMap((capability) => CAPABILITY_DENIALS[capability])
  return {
    ...policy,
    network: policy.network && selected.has('Network'),
    allowedTools: [...policy.allowedTools],
    deniedTools: [...new Set([...policy.deniedTools, ...disabledPatterns])],
  }
}

/**
 * Returns capability restrictions a harness cannot faithfully enforce.
 * Sandbox-only harnesses can enforce Network at the command boundary, but
 * cannot promise per-tool Browser, VM, or subagent rules.
 */
export function unsupportedTaskCapabilities(
  enabled: readonly TaskCapabilityId[],
  controls: HarnessPolicyControls,
): TaskCapabilityId[] {
  if (controls === 'native') return []
  const disabled = TASK_CAPABILITIES.filter((capability) => !enabled.includes(capability))
  return controls === 'sandbox-only'
    ? disabled.filter((capability) => capability !== 'Network')
    : disabled
}
