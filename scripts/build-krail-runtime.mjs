import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const finalRoot = path.join(repositoryRoot, 'electron', 'runtime-bundle')
const candidateRoot = path.join(repositoryRoot, 'electron', `.runtime-bundle-candidate-${process.pid}`)
const staging = path.join(candidateRoot, 'krail-runtime')
const backendStaging = path.join(candidateRoot, 'opensaddle-backend')
const wheelFlag = process.argv.indexOf('--wheel')
const wheelInput = wheelFlag >= 0 ? process.argv[wheelFlag + 1] : process.env.KRAIL_WHEEL
const opensaddleWheelInput = process.env.OPENSADDLE_WHEEL
const expectedKrailVersion = process.env.KRAIL_VERSION?.trim()
const expectedOpenSaddleVersion = process.env.OPENSADDLE_VERSION?.trim()
const runtimeFlag = process.argv.indexOf('--python-runtime')
const runtimeInput = runtimeFlag >= 0 ? process.argv[runtimeFlag + 1] : process.env.KRAIL_PYTHON_RUNTIME
const runtimeDigest = process.env.KRAIL_PYTHON_RUNTIME_SHA256?.toLowerCase()
const runtimeLockInput = process.env.KRAIL_RUNTIME_LOCK
const requirementsInput = process.env.KRAIL_REQUIREMENTS_LOCK
const wheelhouseInput = process.env.KRAIL_WHEELHOUSE
const runtimeRequired = process.argv.includes('--required')
const revisionPattern = /^[a-f0-9]{40}$/
const sourceRepositories = {
  interface: 'https://github.com/AkeBoss-tech/opensaddle-interface.git',
  krail: 'https://github.com/AkeBoss-tech/knowledge.git',
  opensaddle: 'https://github.com/AkeBoss-tech/opensaddle.git',
}
const interfaceSourceReceiptInput = process.env.INTERFACE_SOURCE_RECEIPT
const interfaceSourceArchiveInput = process.env.INTERFACE_SOURCE_ARCHIVE
const sources = {
  interface: { repository: sourceRepositories.interface, revision: process.env.INTERFACE_SOURCE_REVISION?.trim(), tree: process.env.INTERFACE_SOURCE_TREE?.trim() },
  krail: { repository: sourceRepositories.krail, revision: process.env.KRAIL_SOURCE_REVISION?.trim(), tree: process.env.KRAIL_SOURCE_TREE?.trim() },
  opensaddle: { repository: sourceRepositories.opensaddle, revision: process.env.OPENSADDLE_SOURCE_REVISION?.trim(), tree: process.env.OPENSADDLE_SOURCE_TREE?.trim() },
}
const wheelProvenance = {
  krail: process.env.KRAIL_WHEEL_PROVENANCE ?? 'pypi',
  opensaddle: process.env.OPENSADDLE_WHEEL_PROVENANCE ?? 'pypi',
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function run(command, args, errorMessage, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) throw new Error(errorMessage)
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function clean() {
  rmSync(candidateRoot, { recursive: true, force: true })
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

if (!wheelInput) {
  console.error('KRAIL runtime not bundled: provide a wheel and pinned Python runtime')
  process.exit(runtimeRequired ? 1 : 0)
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
if (Object.values(sources).some((source) => !revisionPattern.test(source.revision ?? '') || !revisionPattern.test(source.tree ?? ''))) {
  console.error('every source requires exact Git revision and tree SHAs')
  process.exit(1)
}
const cleanCheckout = (
  capture('git', ['rev-parse', 'HEAD']) !== sources.interface.revision
  ? false
  : capture('git', ['remote', 'get-url', 'origin']) === sources.interface.repository
    && capture('git', ['rev-parse', 'HEAD^{tree}']) === sources.interface.tree
    && spawnSync('git', ['diff', '--quiet', 'HEAD', '--'], { cwd: repositoryRoot }).status === 0
)
let interfaceSourceEvidence = { kind: 'clean_git_checkout', receiptSha256: null, archiveSha256: null }
if (!cleanCheckout) {
  if (!interfaceSourceReceiptInput || !interfaceSourceArchiveInput) {
    console.error('Interface source provenance requires a clean checkout or verified Git archive receipt')
    process.exit(1)
  }
  const receiptPath = path.resolve(interfaceSourceReceiptInput)
  const archivePath = path.resolve(interfaceSourceArchiveInput)
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  const archiveSha256 = sha256(archivePath)
  if (receipt.schemaVersion !== 1 || receipt.repository !== sources.interface.repository || receipt.revision !== sources.interface.revision || receipt.tree !== sources.interface.tree || receipt.archiveSha256 !== archiveSha256) {
    console.error('Interface Git archive receipt does not match the packaged source')
    process.exit(1)
  }
  const listing = spawnSync('tar', ['-tf', archivePath], { encoding: 'utf8' })
  const members = listing.status === 0 ? listing.stdout.split('\n').filter((member) => member && !member.endsWith('/')) : []
  const archiveMatches = members.length > 0 && members.every((member) => {
    if (member.startsWith('/') || member.split('/').includes('..')) return false
    const extracted = spawnSync('tar', ['-xOf', archivePath, member])
    const local = path.resolve(repositoryRoot, member)
    return extracted.status === 0 && local.startsWith(`${repositoryRoot}${path.sep}`) && existsSync(local) && Buffer.compare(extracted.stdout, readFileSync(local)) === 0
  })
  if (!archiveMatches) {
    console.error('Interface extracted source bytes do not match the verified Git archive')
    process.exit(1)
  }
  interfaceSourceEvidence = { kind: 'verified_git_archive', receiptSha256: sha256(receiptPath), archiveSha256 }
}
if (!cleanCheckout && interfaceSourceEvidence.kind !== 'verified_git_archive') {
  console.error('Interface source provenance could not be verified')
  process.exit(1)
}
if (Object.values(wheelProvenance).some((value) => !['pypi', 'reviewed_local'].includes(value))) {
  console.error('wheel provenance must be pypi or reviewed_local')
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
if (!runtimeLockInput || !requirementsInput || !wheelhouseInput) {
  console.error('KRAIL_RUNTIME_LOCK, KRAIL_REQUIREMENTS_LOCK, and KRAIL_WHEELHOUSE are required')
  process.exit(1)
}
const runtimeLockPath = path.resolve(runtimeLockInput)
const requirementsPath = path.resolve(requirementsInput)
const wheelhouse = path.resolve(wheelhouseInput)
const runtimeLock = JSON.parse(readFileSync(runtimeLockPath, 'utf8'))
const requirementsBytes = readFileSync(requirementsPath)
const wheelSet = Array.isArray(runtimeLock.wheels) ? runtimeLock.wheels : []
const wheelSetDigest = createHash('sha256').update(JSON.stringify(wheelSet)).digest('hex')
if (
  runtimeLock.schemaVersion !== 1
  || runtimeLock.target?.platform !== 'macos'
  || runtimeLock.target?.architecture !== 'arm64'
  || runtimeLock.target?.python !== '3.13'
  || runtimeLock.python?.sha256 !== runtimeDigest
  || runtimeLock.python?.size !== statSync(runtimeArchive).size
  || runtimeLock.topLevel?.krail !== expectedKrailVersion
  || runtimeLock.topLevel?.opensaddle !== expectedOpenSaddleVersion
  || runtimeLock.requirementsSha256 !== createHash('sha256').update(requirementsBytes).digest('hex')
  || runtimeLock.wheelSetSha256 !== wheelSetDigest
  || wheelSet.length === 0
) {
  console.error('runtime lock does not match the requested macOS arm64 Python 3.13 release inputs')
  process.exit(1)
}
const lockedNames = new Set()
for (const locked of wheelSet) {
  const candidate = path.join(wheelhouse, locked.filename ?? '')
  const localTopLevel = locked.filename === path.basename(wheel) && wheelProvenance.krail === 'reviewed_local'
    || locked.filename === path.basename(opensaddleWheel) && wheelProvenance.opensaddle === 'reviewed_local'
  const localSource = locked.filename === path.basename(wheel) ? sources.krail
    : locked.filename === path.basename(opensaddleWheel) ? sources.opensaddle : null
  if (
    !/^[A-Za-z0-9_.+-]+\.whl$/.test(locked.filename ?? '')
    || (!localTopLevel && !/^https:\/\/files\.pythonhosted\.org\//.test(locked.url ?? ''))
    || (localTopLevel && (locked.source?.repository !== localSource?.repository || locked.source?.revision !== localSource?.revision))
    || !/^[a-f0-9]{64}$/.test(locked.sha256 ?? '')
    || !existsSync(candidate)
    || statSync(candidate).size !== locked.size
    || sha256(candidate) !== locked.sha256
  ) {
    console.error(`wheelhouse does not match runtime lock: ${locked.filename ?? '<invalid>'}`)
    process.exit(1)
  }
  lockedNames.add(locked.filename)
}
const lockedKrail = wheelSet.find((locked) => locked.filename === path.basename(wheel))
const lockedOpenSaddle = wheelSet.find((locked) => locked.filename === path.basename(opensaddleWheel))
if (
  !lockedKrail
  || !lockedOpenSaddle
  || sha256(wheel) !== lockedKrail.sha256
  || statSync(wheel).size !== lockedKrail.size
  || sha256(opensaddleWheel) !== lockedOpenSaddle.sha256
  || statSync(opensaddleWheel).size !== lockedOpenSaddle.size
) {
  console.error('top-level KRAIL and OpenSaddle wheels must exactly match the runtime lock')
  process.exit(1)
}
if (readdirSync(wheelhouse).filter((name) => name.endsWith('.whl')).some((name) => !lockedNames.has(name))) {
  console.error('wheelhouse contains an unexpected wheel')
  process.exit(1)
}

clean()
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
    ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-index', '--require-hashes', '--only-binary=:all:', '--find-links', wheelhouse, '--report', dependencyReport, '--target', sitePackages, '-r', requirementsPath],
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
    schemaVersion: 2,
    runtime: 'krail',
    sources: { ...sources, interface: { ...sources.interface, evidence: interfaceSourceEvidence } },
    wheel: {
      version: expectedKrailVersion,
      name: path.basename(wheel),
      sha256: sha256(wheel),
      provenance: wheelProvenance.krail,
    },
    opensaddle: {
      version: expectedOpenSaddleVersion,
      name: path.basename(opensaddleWheel),
      sha256: sha256(opensaddleWheel),
      provenance: wheelProvenance.opensaddle,
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
    runtimeLock: { name: 'runtime-lock.json', sha256: sha256(runtimeLockPath) },
    requirements: { name: 'requirements.txt', sha256: sha256(requirementsPath) },
    wheelSet: { count: wheelSet.length, sha256: wheelSetDigest },
    commands: { admin: 'bin/krail-admin', mutation: 'bin/krail-mutate' },
    builtAt: new Date().toISOString(),
  }
  copyFileSync(runtimeLockPath, path.join(staging, manifest.runtimeLock.name))
  copyFileSync(requirementsPath, path.join(staging, manifest.requirements.name))
  writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const priorRoot = `${finalRoot}.prior-${process.pid}`
  rmSync(priorRoot, { recursive: true, force: true })
  if (existsSync(finalRoot)) renameSync(finalRoot, priorRoot)
  try { renameSync(candidateRoot, finalRoot) }
  catch (error) { if (existsSync(priorRoot)) renameSync(priorRoot, finalRoot); throw error }
  rmSync(priorRoot, { recursive: true, force: true })
  console.log(`Bundled ${manifest.wheel.name}`)
} catch (error) {
  clean()
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
