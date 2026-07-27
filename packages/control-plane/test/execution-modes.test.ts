import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { policyForExecutionMode } from '../src/executionModes.js'

const projectPolicy = {
  sandbox: 'workspace-write' as const,
  approvals: 'on-request' as const,
  network: true,
  allowedTools: ['read_file'],
  deniedTools: ['delete_file'],
}

describe('per-run execution modes', () => {
  it('makes plan mode read-only while retaining explicit tool boundaries', () => {
    assert.deepEqual(policyForExecutionMode('plan', projectPolicy), {
      sandbox: 'read-only',
      approvals: 'always',
      network: false,
      allowedTools: ['read_file'],
      deniedTools: ['delete_file'],
    })
  })

  it('makes review mode workspace-scoped while keeping promotion explicit', () => {
    assert.deepEqual(policyForExecutionMode('review', projectPolicy), {
      sandbox: 'workspace-write',
      approvals: 'on-request',
      network: false,
      allowedTools: ['read_file'],
      deniedTools: ['delete_file'],
    })
  })

  it('enables local full access without erasing explicit denials', () => {
    assert.deepEqual(policyForExecutionMode('full-access', projectPolicy), {
      sandbox: 'full-access',
      approvals: 'never',
      network: true,
      allowedTools: ['read_file'],
      deniedTools: ['delete_file'],
    })
  })
})
