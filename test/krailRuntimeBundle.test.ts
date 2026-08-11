import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveKrailRuntime } from '../electron/runtimeBundle.ts'

function fixture() {
  const resourceRoot = mkdtempSync(path.join(os.tmpdir(), 'opensaddle-krail-runtime-'))
  const runtime = path.join(resourceRoot, 'krail-runtime')
  mkdirSync(path.join(runtime, 'bin'), { recursive: true })
  for (const name of ['krail-admin', 'krail-mutate']) {
    const command = path.join(runtime, 'bin', name)
    writeFileSync(command, '#!/bin/sh\nexit 0\n')
    chmodSync(command, 0o755)
  }
  const manifest = {
    schemaVersion: 1, runtime: 'krail',
    wheel: { name: 'krail-1.1.13-py3-none-any.whl', sha256: 'a'.repeat(64) },
    commands: { admin: 'bin/krail-admin', mutation: 'bin/krail-mutate' },
    builtAt: '2026-08-11T00:00:00Z',
  }
  writeFileSync(path.join(runtime, 'manifest.json'), JSON.stringify(manifest))
  return { resourceRoot, runtime, manifest }
}

test('packaged KRAIL runtime resolves only a complete validated manifest', () => {
  const value = fixture()
  try {
    const resolved = resolveKrailRuntime(value.resourceRoot)
    assert.equal(resolved?.adminCommand, path.join(value.runtime, 'bin', 'krail-admin'))
    assert.equal(resolved?.mutationCommand, path.join(value.runtime, 'bin', 'krail-mutate'))
    rmSync(path.join(value.runtime, 'bin', 'krail-mutate'))
    assert.equal(resolveKrailRuntime(value.resourceRoot), null)
  } finally {
    rmSync(value.resourceRoot, { recursive: true, force: true })
  }
})

test('packaged KRAIL runtime rejects traversal and missing manifests', () => {
  const value = fixture()
  try {
    value.manifest.commands.admin = '../outside'
    writeFileSync(path.join(value.runtime, 'manifest.json'), JSON.stringify(value.manifest))
    assert.equal(resolveKrailRuntime(value.resourceRoot), null)
    rmSync(path.join(value.runtime, 'manifest.json'))
    assert.equal(resolveKrailRuntime(value.resourceRoot), null)
  } finally {
    rmSync(value.resourceRoot, { recursive: true, force: true })
  }
})

test('desktop packaging includes KRAIL runtime and injects only validated commands', () => {
  const electronPackage = readFileSync('electron/package.json', 'utf8')
  const main = readFileSync('electron/main.ts', 'utf8')
  assert.match(electronPackage, /runtime-bundle\/krail-runtime/)
  assert.match(electronPackage, /"to": "krail-runtime"/)
  assert.match(main, /resolveKrailRuntime/)
  assert.match(main, /OPENSADDLE_KRAIL_ADMIN_COMMAND/)
  assert.match(main, /OPENSADDLE_KRAIL_MUTATION_COMMAND/)
})
