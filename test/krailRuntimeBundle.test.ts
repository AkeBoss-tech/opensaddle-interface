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
  mkdirSync(path.join(runtime, 'python', 'bin'), { recursive: true })
  for (const name of ['krail-admin', 'krail-mutate']) {
    const command = path.join(runtime, 'bin', name)
    writeFileSync(command, '#!/bin/sh\nexit 0\n')
    chmodSync(command, 0o755)
  }
  const python = path.join(runtime, 'python', 'bin', 'python3')
  writeFileSync(python, '#!/bin/sh\nexit 0\n')
  chmodSync(python, 0o755)
  const dependencyReport = path.join(runtime, 'dependency-install-report.json')
  writeFileSync(dependencyReport, '{"version":"1"}\n')
  const dependencyDigest = '25d269e05e8aae00d55b18b16fcc01b92086b476f4de4a2cb9d3c0c1c29b9e8e'
  const manifest = {
    schemaVersion: 1, runtime: 'krail',
    wheel: { name: 'krail-1.1.13-py3-none-any.whl', sha256: 'a'.repeat(64) },
    opensaddle: { name: 'opensaddle-1.1.1-py3-none-any.whl', sha256: 'c'.repeat(64), command: '../opensaddle-backend/opensaddle' },
    python: { name: 'python.tar.gz', sha256: 'b'.repeat(64), command: 'python/bin/python3' },
    dependencies: { report: 'dependency-install-report.json', sha256: dependencyDigest },
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

test('packaged KRAIL runtime requires its pinned interpreter', () => {
  const value = fixture()
  try {
    rmSync(path.join(value.runtime, 'python', 'bin', 'python3'))
    assert.equal(resolveKrailRuntime(value.resourceRoot), null)
  } finally {
    rmSync(value.resourceRoot, { recursive: true, force: true })
  }
})

test('packaged KRAIL runtime rejects a tampered dependency report', () => {
  const value = fixture()
  try {
    writeFileSync(path.join(value.runtime, 'dependency-install-report.json'), '{"tampered":true}\n')
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
  assert.match(electronPackage, /"to": "opensaddle-backend"/)
  assert.match(main, /resolveKrailRuntime/)
  assert.match(main, /OPENSADDLE_KRAIL_ADMIN_COMMAND/)
  assert.match(main, /OPENSADDLE_KRAIL_MUTATION_COMMAND/)
  const builder = readFileSync('scripts/build-krail-runtime.mjs', 'utf8')
  assert.match(builder, /KRAIL_PYTHON_RUNTIME_SHA256/)
  assert.match(builder, /OPENSADDLE_WHEEL/)
  assert.match(builder, /python\/bin\/python3/)
  assert.match(builder, /PATH=\/usr\/bin:\/bin/)
})
