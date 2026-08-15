import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const staging = path.join(repositoryRoot, 'electron', 'runtime-bundle', 'krail-runtime')
const backendStaging = path.join(repositoryRoot, 'electron', 'runtime-bundle', 'opensaddle-backend')
const wheelFlag = process.argv.indexOf('--wheel')
const wheelInput = wheelFlag >= 0 ? process.argv[wheelFlag + 1] : process.env.KRAIL_WHEEL
const opensaddleWheelInput = process.env.OPENSADDLE_WHEEL
const expectedKrailVersion = process.env.KRAIL_VERSION?.trim()
const expectedOpenSaddleVersion = process.env.OPENSADDLE_VERSION?.trim()
const runtimeFlag = process.argv.indexOf('--python-runtime')
const runtimeInput = runtimeFlag >= 0 ? process.argv[runtimeFlag + 1] : process.env.KRAIL_PYTHON_RUNTIME
const runtimeDigest = process.env.KRAIL_PYTHON_RUNTIME_SHA256?.toLowerCase()

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function run(command, args, errorMessage, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) throw new Error(errorMessage)
}

function clean() {
  rmSync(staging, { recursive: true, force: true })
  rmSync(backendStaging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
}

function validReleaseVersion(version) {
  return typeof version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:(?:a|b|rc)[0-9]+)?$/.test(version)
}

function wheelMatches(file, distribution, version) {
  if (!existsSync(file) || !validReleaseVersion(version)) return false
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${distribution}-${escapedVersion}-[^/]+\\.whl$`).test(path.basename(file))
}

clean()
if (!wheelInput) {
  console.log('KRAIL runtime not bundled: provide a wheel and pinned Python runtime')
  process.exit(0)
}

const wheel = path.resolve(wheelInput)
if (!wheelMatches(wheel, 'krail', expectedKrailVersion)) {
  console.error(`KRAIL_WHEEL must point to a krail-${expectedKrailVersion ?? '<version>'} wheel and KRAIL_VERSION must be valid`)
  process.exit(1)
}
if (!opensaddleWheelInput) {
  console.error('OPENSADDLE_WHEEL is required for an out-of-box managed desktop runtime')
  process.exit(1)
}
const opensaddleWheel = path.resolve(opensaddleWheelInput)
if (!wheelMatches(opensaddleWheel, 'opensaddle', expectedOpenSaddleVersion)) {
  console.error(`OPENSADDLE_WHEEL must point to an opensaddle-${expectedOpenSaddleVersion ?? '<version>'} wheel and OPENSADDLE_VERSION must be valid`)
  process.exit(1)
}
if (!runtimeInput || !runtimeDigest || !/^[a-f0-9]{64}$/.test(runtimeDigest)) {
  console.error('KRAIL_PYTHON_RUNTIME and its 64-character KRAIL_PYTHON_RUNTIME_SHA256 are required')
  process.exit(1)
}
const runtimeArchive = path.resolve(runtimeInput)
if (!existsSync(runtimeArchive) || !/\.tar\.gz$/.test(path.basename(runtimeArchive))) {
  console.error('KRAIL_PYTHON_RUNTIME must point to a pinned install-only Python .tar.gz archive')
  process.exit(1)
}
if (sha256(runtimeArchive) !== runtimeDigest) {
  console.error('KRAIL Python runtime digest does not match KRAIL_PYTHON_RUNTIME_SHA256')
  process.exit(1)
}

try {
  const listing = spawnSync('tar', ['-tzf', runtimeArchive], { encoding: 'utf8' })
  if (listing.status !== 0) throw new Error('could not inspect the KRAIL Python runtime archive')
  const members = listing.stdout.split('\n').filter(Boolean)
  if (!members.length || members.some((member) => member.startsWith('/') || member.split('/').includes('..'))) {
    throw new Error('KRAIL Python runtime archive contains an unsafe path')
  }
  run('tar', ['-xzf', runtimeArchive, '-C', staging], 'could not extract the KRAIL Python runtime')
  const python = path.join(staging, 'python', 'bin', 'python3')
  if (!existsSync(python)) throw new Error('KRAIL Python runtime archive does not contain python/bin/python3')

  const sitePackages = path.join(staging, 'site-packages')
  const dependencyReport = path.join(staging, 'dependency-install-report.json')
  run(
    python,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:', '--report', dependencyReport, '--target', sitePackages, wheel, opensaddleWheel],
    'pip failed to stage the KRAIL runtime',
  )

  const bin = path.join(staging, 'bin')
  mkdirSync(bin, { recursive: true })
  for (const [name, module] of [['krail-admin', 'krail.admin'], ['krail-mutate', 'krail.mutation']]) {
    const launcher = path.join(bin, name)
    writeFileSync(launcher, `#!/bin/sh\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$HERE/../python/bin/python3" -I -c 'import runpy, sys; sys.path.insert(0, sys.argv.pop(1)); runpy.run_module("${module}", run_name="__main__")' "$HERE/../site-packages" "$@"\n`)
    chmodSync(launcher, 0o755)
  }
  for (const launcher of ['krail-admin', 'krail-mutate']) {
    run(
      '/usr/bin/env',
      ['-i', 'PATH=/usr/bin:/bin', path.join(bin, launcher), '--help'],
      `${launcher} failed its sanitized bundled-runtime smoke test`,
    )
  }
  mkdirSync(backendStaging, { recursive: true })
  const backendLauncher = path.join(backendStaging, 'opensaddle')
  writeFileSync(backendLauncher, `#!/bin/sh\nHERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$HERE/../krail-runtime/python/bin/python3" -I -c 'import runpy, sys; sys.path.insert(0, sys.argv.pop(1)); runpy.run_module("opensaddle.cli.main", run_name="__main__")' "$HERE/../krail-runtime/site-packages" "$@"\n`)
  chmodSync(backendLauncher, 0o755)
  run(
    '/usr/bin/env',
    ['-i', 'PATH=/usr/bin:/bin', backendLauncher, '--help'],
    'opensaddle backend failed its sanitized bundled-runtime smoke test',
  )
  const manifest = {
    schemaVersion: 1,
    runtime: 'krail',
    wheel: {
      version: expectedKrailVersion,
      name: path.basename(wheel),
      sha256: sha256(wheel),
    },
    opensaddle: {
      version: expectedOpenSaddleVersion,
      name: path.basename(opensaddleWheel),
      sha256: sha256(opensaddleWheel),
      command: '../opensaddle-backend/opensaddle',
    },
    python: {
      name: path.basename(runtimeArchive),
      sha256: runtimeDigest,
      command: 'python/bin/python3',
    },
    dependencies: {
      report: 'dependency-install-report.json',
      sha256: sha256(dependencyReport),
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
