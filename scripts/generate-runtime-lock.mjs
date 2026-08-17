import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const wheelhouse = path.resolve(process.argv[2] ?? '')
const output = path.resolve(process.argv[3] ?? '')
const python = {
  version: process.env.PYTHON_RUNTIME_VERSION,
  url: process.env.PYTHON_RUNTIME_URL,
  size: Number(process.env.PYTHON_RUNTIME_SIZE),
  sha256: process.env.PYTHON_RUNTIME_SHA256,
}
if (!wheelhouse || !output || !python.version || !/^https:\/\/github\.com\/astral-sh\/python-build-standalone\/releases\/download\//.test(python.url ?? '') || !Number.isSafeInteger(python.size) || python.size < 1 || !/^[0-9a-f]{64}$/.test(python.sha256 ?? '')) {
  throw new Error('Usage: generate-runtime-lock.mjs WHEELHOUSE OUTPUT with complete immutable PYTHON_RUNTIME_* metadata')
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const filenames = readdirSync(wheelhouse).filter((name) => name.endsWith('.whl')).sort()
if (!filenames.length) throw new Error('wheelhouse is empty')
const wheels = []
for (const filename of filenames) {
  const match = /^([^-]+)-([^-]+)-.+\.whl$/.exec(filename)
  if (!match) throw new Error(`unsupported wheel filename: ${filename}`)
  const distribution = match[1].replaceAll('_', '-').toLowerCase()
  const version = match[2]
  const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(distribution)}/${encodeURIComponent(version)}/json`, { redirect: 'error' })
  if (!response.ok) throw new Error(`PyPI metadata unavailable for ${distribution}==${version}`)
  const metadata = await response.json()
  const candidates = metadata.urls.filter((item) => item.filename === filename && item.packagetype === 'bdist_wheel')
  if (candidates.length !== 1) throw new Error(`expected one official PyPI file for ${filename}`)
  const official = candidates[0]
  const bytes = readFileSync(path.join(wheelhouse, filename))
  if (!/^https:\/\/files\.pythonhosted\.org\//.test(official.url) || official.size !== bytes.length || official.digests?.sha256 !== sha256(bytes)) {
    throw new Error(`local wheel does not match official PyPI metadata: ${filename}`)
  }
  wheels.push({ distribution, version, filename, url: official.url, size: official.size, sha256: official.digests.sha256 })
}
const requirements = `${wheels.map((wheel) => `${wheel.distribution}==${wheel.version} --hash=sha256:${wheel.sha256}`).join('\n')}\n`
const wheelSetDigest = sha256(Buffer.from(JSON.stringify(wheels)))
mkdirSync(output, { recursive: true })
writeFileSync(path.join(output, 'requirements-macos-arm64-python3.13.txt'), requirements)
const lock = {
  schemaVersion: 1,
  target: { platform: 'macos', architecture: 'arm64', python: '3.13' },
  python,
  topLevel: { krail: '1.2.0rc2', opensaddle: '1.2.0rc4' },
  requirementsSha256: sha256(Buffer.from(requirements)),
  wheelSetSha256: wheelSetDigest,
  wheels,
}
writeFileSync(path.join(output, 'runtime-lock-macos-arm64-python3.13.json'), `${JSON.stringify(lock, null, 2)}\n`)
console.log(`Locked ${wheels.length} official wheels; wheel set ${wheelSetDigest}`)
