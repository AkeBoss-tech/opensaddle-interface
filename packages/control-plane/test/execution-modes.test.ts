import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyTaskCapabilities, policyForExecutionMode, unsupportedTaskCapabilities } from '../src/executionModes.js'

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

  it('narrows provider tools without broadening the admin network policy', () => {
    const policy = applyTaskCapabilities(projectPolicy, ['Browser'])
    assert.equal(policy.network, false)
    assert.ok(policy.deniedTools.includes('WebFetch'))
    assert.ok(policy.deniedTools.includes('create_vm'))
    assert.ok(policy.deniedTools.includes('spawn_agent'))
    assert.equal(policy.deniedTools.includes('mcp__browser__*'), false)
    assert.ok(policy.deniedTools.includes('delete_file'))
  })

  it('leaves core repository tools to the sandbox execution mode', () => {
    const policy = applyTaskCapabilities(projectPolicy, [])
    assert.equal(policy.deniedTools.includes('Read'), false)
    assert.equal(policy.deniedTools.includes('Edit'), false)
    assert.equal(policy.deniedTools.includes('Bash'), false)
  })

  it('fails closed when a harness cannot enforce selected restrictions', () => {
    assert.deepEqual(unsupportedTaskCapabilities(
      ['Browser', 'Network'],
      'sandbox-only',
    ), ['Secure VM', 'Subagents'])
    assert.deepEqual(unsupportedTaskCapabilities(
      ['Browser', 'Secure VM', 'Subagents'],
      'sandbox-only',
    ), [])
    assert.deepEqual(unsupportedTaskCapabilities(
      ['Browser', 'Network'],
      'provider-defined',
    ), ['Secure VM', 'Subagents'])
    assert.deepEqual(unsupportedTaskCapabilities([], 'native'), [])
  })
})
