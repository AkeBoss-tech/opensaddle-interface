import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { discoverAgentSkills } from '../electron/skillDiscovery.ts'

async function skill(root: string, name: string, description: string, helper = false) {
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'SKILL.md'), `---\nname: "${name}"\ndescription: "${description}"\n---\n\n# ${name}\n`)
  if (helper) await writeFile(path.join(root, 'helper.sh'), '#!/bin/sh\n')
}

test('discovers bounded Codex, Claude, and Cursor skill manifests without executing them', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'opensaddle-skill-discovery-'))
  try {
    await Promise.all([
      skill(path.join(home, '.codex', 'skills', 'reviewer'), 'Reviewer', 'Review code', true),
      skill(path.join(home, '.claude', 'skills', 'planner'), 'Planner', 'Plan work'),
      skill(path.join(home, '.cursor', 'skills', 'designer'), 'Designer', 'Design UI'),
    ])
    const skills = await discoverAgentSkills(home)
    assert.deepEqual(new Set(skills.map((item) => item.source)), new Set(['codex', 'claude', 'cursor']))
    assert.equal(skills.find((item) => item.name === 'Reviewer')?.helperFileCount, 1)
    assert.equal(skills.find((item) => item.name === 'Planner')?.description, 'Plan work')
    assert.ok(skills.every((item) => item.id.startsWith('skill-') && item.content.includes('# ')))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
