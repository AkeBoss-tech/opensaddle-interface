import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canDelegateToAgent, evaluatePermissions } from '../src/permissions.js'
import type { PermissionGrant } from '../src/types.js'

const base = {
  createdAt: 1,
  createdBy: 'admin',
} satisfies Partial<PermissionGrant>

function grant(input: Omit<PermissionGrant, 'createdAt' | 'createdBy'>): PermissionGrant {
  return { ...base, ...input } as PermissionGrant
}

describe('server-side permission evaluation', () => {
  it('requires both user and agent grants for agent execution', () => {
    const grants = [
      grant({
        id: 'user-exec',
        principalKind: 'user',
        principalId: 'u1',
        resourceKind: 'project',
        resourceId: 'p1',
        action: 'execute',
        effect: 'allow',
      }),
    ]
    const result = evaluatePermissions(grants, {
      userId: 'u1',
      agentId: 'a1',
      resourceKind: 'project',
      resourceId: 'p1',
      action: 'execute',
    })
    assert.equal(result.allowed, false)
    assert.match(result.reason, /Agent lacks/)
  })

  it('allows the user and agent intersection and preserves approval', () => {
    const grants = [
      grant({
        id: 'user-exec',
        principalKind: 'user',
        principalId: 'u1',
        resourceKind: 'project',
        resourceId: 'p1',
        action: 'execute',
        effect: 'allow',
      }),
      grant({
        id: 'agent-exec',
        principalKind: 'agent',
        principalId: 'a1',
        resourceKind: 'project',
        resourceId: 'p1',
        action: 'execute',
        effect: 'allow',
        approvalRequired: true,
      }),
    ]
    const result = evaluatePermissions(grants, {
      userId: 'u1',
      agentId: 'a1',
      resourceKind: 'project',
      resourceId: 'p1',
      action: 'execute',
    })
    assert.equal(result.allowed, true)
    assert.equal(result.approvalRequired, true)
  })

  it('makes explicit denial win over organization administration', () => {
    const grants = [
      grant({
        id: 'admin',
        principalKind: 'user',
        principalId: 'u1',
        resourceKind: 'organization',
        resourceId: 'org',
        action: 'administer',
        effect: 'allow',
      }),
      grant({
        id: 'deny',
        principalKind: 'user',
        principalId: 'u1',
        resourceKind: 'project',
        resourceId: 'p1',
        action: 'execute',
        effect: 'deny',
      }),
    ]
    const result = evaluatePermissions(grants, {
      userId: 'u1',
      resourceKind: 'project',
      resourceId: 'p1',
      action: 'execute',
    })
    assert.equal(result.allowed, false)
    assert.deepEqual(result.matchedGrantIds, ['deny'])
  })

  it('does not reuse a consumed one-time grant', () => {
    const result = evaluatePermissions([
      grant({
        id: 'once-consumed',
        principalKind: 'user',
        principalId: 'u1',
        resourceKind: 'tool',
        resourceId: 'email',
        action: 'write',
        effect: 'allow',
        scope: 'once',
        scopeId: 'thread-1',
        usesRemaining: 0,
        consumedAt: 10,
      }),
    ], {
      userId: 'u1',
      resourceKind: 'tool',
      resourceId: 'email',
      action: 'write',
    })
    assert.equal(result.allowed, false)
    assert.equal(result.matchedGrantIds.length, 0)
  })

  it('allows cross-thread delegation only to equal or lesser-privileged agents', () => {
    const grants = [
      grant({ id: 'caller-read', principalKind: 'agent', principalId: 'caller', resourceKind: 'repository', resourceId: 'repo-1', action: 'read', effect: 'allow' }),
      grant({ id: 'target-read', principalKind: 'agent', principalId: 'target', resourceKind: 'repository', resourceId: 'repo-1', action: 'read', effect: 'allow' }),
    ]
    assert.equal(canDelegateToAgent(grants, 'caller', 'target').allowed, true)
    grants.push(grant({ id: 'target-write', principalKind: 'agent', principalId: 'target', resourceKind: 'repository', resourceId: 'repo-1', action: 'write', effect: 'allow' }))
    assert.equal(canDelegateToAgent(grants, 'caller', 'target').allowed, false)
  })

  it('does not let a caller delegate around its own explicit deny', () => {
    const grants = [
      grant({ id: 'caller-allow', principalKind: 'agent', principalId: 'caller', resourceKind: 'tool', resourceId: 'github', action: 'write', effect: 'allow' }),
      grant({ id: 'caller-deny', principalKind: 'agent', principalId: 'caller', resourceKind: 'tool', resourceId: 'github', action: 'write', effect: 'deny' }),
      grant({ id: 'target-allow', principalKind: 'agent', principalId: 'target', resourceKind: 'tool', resourceId: 'github', action: 'write', effect: 'allow' }),
    ]
    assert.equal(canDelegateToAgent(grants, 'caller', 'target').allowed, false)
  })
})
