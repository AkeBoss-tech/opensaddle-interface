import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ProjectFilesystemError, ProjectFilesystemService } from '../src/projectFilesystem.js'

async function fixture(): Promise<{ base: string; project: string; outside: string; service: ProjectFilesystemService }> {
  const base = await mkdtemp(join(tmpdir(), 'opensaddle-project-files-'))
  const project = join(base, 'project')
  const outside = join(base, 'outside')
  await Promise.all([mkdir(project), mkdir(outside)])
  await Promise.all([
    mkdir(join(project, 'docs'), { recursive: true }),
    mkdir(join(project, '.claude', 'agents'), { recursive: true }),
    mkdir(join(project, '.claude', 'worktrees', 'stale-copy'), { recursive: true }),
    mkdir(join(project, '.codex', 'skills', 'reviewer'), { recursive: true }),
    mkdir(join(project, 'node_modules', 'ignored-package'), { recursive: true }),
    mkdir(join(project, 'site'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(project, 'README.md'), '# Project\n'),
    writeFile(join(project, 'AGENTS.md'), '# Instructions\n'),
    writeFile(join(project, 'docs', 'guide.md'), 'searchable documentation\n'),
    writeFile(join(project, '.claude', 'agents', 'review.md'), '# Reviewer\n'),
    writeFile(join(project, '.claude', 'worktrees', 'stale-copy', 'README.md'), '# Duplicate\n'),
    writeFile(join(project, '.codex', 'skills', 'reviewer', 'SKILL.md'), '# Skill\n'),
    writeFile(join(project, 'site', 'index.html'), '<main>site</main>\n'),
    writeFile(join(project, 'node_modules', 'ignored-package', 'never.md'), 'ignored\n'),
    writeFile(join(project, 'binary.bin'), Buffer.from([0, 1, 2, 3])),
    writeFile(join(outside, 'secret.txt'), 'must not leak\n'),
  ])
  await symlink(join(outside, 'secret.txt'), join(project, 'escape.txt'))
  return { base, project, outside, service: new ProjectFilesystemService([base], { maxReadBytes: 12, maxSearchBytes: 2_048 }) }
}

test('lists and reads project-relative files while honoring ignored directories', async () => {
  const value = await fixture()
  try {
    const listed = await value.service.list(value.project)
    assert.equal(listed.entries.some((entry) => entry.name === 'README.md'), true)
    assert.equal(listed.entries.some((entry) => entry.name === 'node_modules'), false)
    const read = await value.service.read(value.project, 'README.md')
    assert.equal(read.content, '# Project\n')
    assert.equal(read.truncated, false)
    const limited = await value.service.read(value.project, 'docs/guide.md')
    assert.equal(limited.truncated, true)
    await assert.rejects(value.service.read(value.project, 'binary.bin'), (error: unknown) => error instanceof ProjectFilesystemError && error.statusCode === 415)
  } finally { await rm(value.base, { recursive: true, force: true }) }
})

test('rejects path traversal, unapproved roots, and symlink escapes', async () => {
  const value = await fixture()
  try {
    await assert.rejects(value.service.stat(value.project, '../outside/secret.txt'), (error: unknown) => error instanceof ProjectFilesystemError && error.code === 'invalid_path')
    await assert.rejects(value.service.read(value.project, 'escape.txt'), (error: unknown) => error instanceof ProjectFilesystemError && error.code === 'path_escaped')
    await assert.rejects(new ProjectFilesystemService([value.project]).list(value.outside), (error: unknown) => error instanceof ProjectFilesystemError && error.code === 'root_not_allowed')
  } finally { await rm(value.base, { recursive: true, force: true }) }
})

test('searches bounded text files and excludes ignored directories', async () => {
  const value = await fixture()
  try {
    const result = await value.service.search(value.project, 'documentation')
    assert.deepEqual(result.matches.map((match) => match.path), ['docs/guide.md'])
    assert.equal(result.scannedFiles > 0, true)
    const noIgnored = await value.service.search(value.project, 'ignored')
    assert.equal(noIgnored.matches.length, 0)
  } finally { await rm(value.base, { recursive: true, force: true }) }
})

test('discovers instructions, agents, skills, docs, and sites for a sidebar manifest', async () => {
  const value = await fixture()
  try {
    const manifest = await value.service.rescan(value.project)
    assert.deepEqual(manifest.counts, { instruction: 1, skill: 1, agent: 1, documentation: 2, site: 1 })
    assert.equal(manifest.artifacts.some((artifact) => artifact.path === 'node_modules/ignored-package/never.md'), false)
    assert.equal(manifest.artifacts.some((artifact) => artifact.path.includes('/worktrees/')), false)
  } finally { await rm(value.base, { recursive: true, force: true }) }
})

test('writes only managed local agent and skill artifacts without following symlinks', async () => {
  const value = await fixture()
  try {
    const skill = await value.service.writeManagedArtifact(
      value.project,
      '.opensaddle/skills/release-review/SKILL.md',
      '---\nname: Release review\n---\n\n# Release review\n',
    )
    const agent = await value.service.writeManagedArtifact(
      value.project,
      '.opensaddle/agents/release-manager.md',
      '---\nname: Release manager\n---\n\n# Release manager\n',
    )
    assert.equal(skill.path, '.opensaddle/skills/release-review/SKILL.md')
    assert.equal(agent.path, '.opensaddle/agents/release-manager.md')
    assert.match((await value.service.read(value.project, skill.path)).content, /^---\nname: Re/)
    const manifest = await value.service.rescan(value.project)
    assert.equal(manifest.counts.skill, 2)
    assert.equal(manifest.counts.agent, 2)
    const archived = await value.service.archiveManagedArtifact(value.project, skill.path)
    assert.equal(archived.path, skill.path)
    assert.match(archived.archivedPath, /^\.opensaddle\/archive\/\d+-skills-release-review-[a-f0-9]{8}\.md$/)
    await assert.rejects(
      value.service.stat(value.project, skill.path),
      (error: unknown) => error instanceof ProjectFilesystemError && error.code === 'not_found',
    )
    const rescanned = await value.service.rescan(value.project)
    assert.equal(rescanned.counts.skill, 1)
    assert.equal(rescanned.counts.documentation, 2)
    const archives = await value.service.listManagedArchives(value.project)
    assert.deepEqual(archives.map((entry) => ({
      archivedPath: entry.archivedPath,
      originalPath: entry.originalPath,
      kind: entry.kind,
      name: entry.name,
    })), [{
      archivedPath: archived.archivedPath,
      originalPath: skill.path,
      kind: 'skill',
      name: 'release-review',
    }])
    const restored = await value.service.restoreManagedArtifact(value.project, archived.archivedPath)
    assert.equal(restored.path, skill.path)
    assert.equal((await value.service.listManagedArchives(value.project)).length, 0)
    assert.equal((await value.service.rescan(value.project)).counts.skill, 2)
    await assert.rejects(
      value.service.restoreManagedArtifact(value.project, archived.archivedPath),
      (error: unknown) => error instanceof ProjectFilesystemError && error.code === 'not_found',
    )

    await assert.rejects(
      value.service.writeManagedArtifact(value.project, 'docs/unsafe.md', '# Unsafe\n'),
      (error: unknown) => error instanceof ProjectFilesystemError && error.code === 'invalid_path',
    )
    await mkdir(join(value.project, '.opensaddle', 'skills'), { recursive: true })
    await symlink(value.outside, join(value.project, '.opensaddle', 'skills', 'escape'))
    await assert.rejects(
      value.service.writeManagedArtifact(value.project, '.opensaddle/skills/escape/SKILL.md', '# Escape\n'),
      (error: unknown) => error instanceof ProjectFilesystemError && error.code === 'path_escaped',
    )
  } finally { await rm(value.base, { recursive: true, force: true }) }
})
