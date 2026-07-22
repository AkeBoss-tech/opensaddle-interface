import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluatePermissions } from '../src/permissions.js'
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
})
