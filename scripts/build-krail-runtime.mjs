import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const staging = path.join(repositoryRoot, 'electron', 'runtime-bundle', 'krail-runtime')
const wheelFlag = process.argv.indexOf('--wheel')
const wheelInput = wheelFlag >= 0 ? process.argv[wheelFlag + 1] : process.env.KRAIL_WHEEL

function clean() {
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
}

clean()
if (!wheelInput) {
  console.log('KRAIL runtime not bundled: provide --wheel PATH or KRAIL_WHEEL')
  process.exit(0)
}

const wheel = path.resolve(wheelInput)
if (!existsSync(wheel) || !/^krail-1\.1\.13-.*\.whl$/.test(path.basename(wheel))) {
  console.error('KRAIL_WHEEL must point to a krail-1.1.13 wheel')
  process.exit(1)
}

try {
  const sitePackages = path.join(staging, 'site-packages')
  const python = process.env.PYTHON || 'python3'
  const installed = spawnSync(
    python,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '--target', sitePackages, wheel],
    { stdio: 'inherit' },
  )
  if (installed.status !== 0) throw new Error('pip failed to stage the KRAIL runtime')

  const bin = path.join(staging, 'bin')
  mkdirSync(bin, { recursive: true })
  for (const [name, module] of [['krail-admin', 'krail.admin'], ['krail-mutate', 'krail.mutation']]) {
    const launcher = path.join(bin, name)
    writeFileSync(launcher, `#!/bin/sh\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport PYTHONPATH="$HERE/../site-packages${'${PYTHONPATH:+:$PYTHONPATH}'}"\nexec "${'${PYTHON:-python3}'}" -m ${module} "$@"\n`)
    chmodSync(launcher, 0o755)
  }
  const manifest = {
    schemaVersion: 1,
    runtime: 'krail',
    wheel: {
      name: path.basename(wheel),
      sha256: createHash('sha256').update(readFileSync(wheel)).digest('hex'),
    },
    commands: { admin: 'bin/krail-admin', mutation: 'bin/krail-mutate' },
    builtAt: new Date().toISOString(),
  }
  writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Bundled ${manifest.wheel.name}`)
} catch (error) {
  clean()
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
