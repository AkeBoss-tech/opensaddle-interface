import assert from 'node:assert/strict'
import test from 'node:test'
import { appendPermissionGrants } from '../src/data/store.tsx'
import type { PermissionGrant } from '../src/types/index.ts'

const existing: PermissionGrant = {
  id: 'existing', principalKind: 'user', principalId: 'user-1', resourceKind: 'project', resourceId: 'project-1',
  action: 'read', effect: 'allow', createdAt: 1, createdBy: 'user-1',
}

test('addPermissionGrants appends without dropping existing grants', () => {
  const grants = appendPermissionGrants([existing], [{
    principalKind: 'user', principalId: 'user-1', resourceKind: 'project', resourceId: 'project-2', action: 'write', effect: 'allow',
  }], 'user-1')
  assert.equal(grants.length, 2)
  assert.deepEqual(grants[0], existing)
  assert.equal(grants[1]?.resourceId, 'project-2')
  assert.equal(grants[1]?.createdBy, 'user-1')
})
