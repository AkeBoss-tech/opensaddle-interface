import assert from 'node:assert/strict'
import test from 'node:test'
import { projectFromRegisteredLocalProject } from '../src/data/registeredLocalProjects.ts'

test('hydrates a registered daemon folder as a local-admin project', () => {
  const project = projectFromRegisteredLocalProject({
    projectId: 'local-opensaddle',
    root: '/work/opensaddle-interface',
    createdAt: 1_785_222_400_000,
  }, 'codex')

  assert.equal(project.id, 'local-opensaddle')
  assert.equal(project.name, 'opensaddle-interface')
  assert.equal(project.workspaceKind, 'local')
  assert.equal(project.local?.rootPath, '/work/opensaddle-interface')
  assert.equal(project.local?.adminAccess, true)
  assert.equal(project.local?.defaultHarnessId, 'codex')
  assert.equal(project.routingDefaults?.providerKey, 'codex')
  assert.equal(project.routingDefaults?.runtimeKey, 'local')
})
