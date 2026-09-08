import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const [repository, revision, output] = process.argv.slice(2)
if (!repository || !/^[a-f0-9]{40}$/.test(revision ?? '') || !output) {
  console.error('Usage: export-runtime-source.mjs REPOSITORY EXACT_REVISION OUTPUT_DIRECTORY')
  process.exit(1)
}
const run = (args, options = {}) => {
  const result = spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`)
  return result.stdout.trim()
}
const exact = run(['rev-parse', `${revision}^{commit}`])
if (exact !== revision) throw new Error('revision did not resolve to the exact requested commit')
const remote = run(['remote', 'get-url', 'origin'])
const tree = run(['rev-parse', `${revision}^{tree}`])
const destination = path.resolve(output)
const sourceRoot = path.resolve(repository)
if (destination === sourceRoot || sourceRoot.startsWith(`${destination}${path.sep}`)) {
  throw new Error('output must not be the repository or one of its ancestors')
}
if (existsSync(destination)) throw new Error('output already exists; choose a new destination')
mkdirSync(destination, { recursive: true })
const archive = path.join(destination, 'source.tar')
const archived = spawnSync('git', ['-C', repository, 'archive', '--format=tar', '-o', archive, revision], { encoding: 'utf8' })
if (archived.status !== 0) throw new Error(archived.stderr || 'git archive failed')
const archiveSha256 = createHash('sha256').update(readFileSync(archive)).digest('hex')
const receipt = { schemaVersion: 1, repository: remote, revision, tree, archiveSha256 }
writeFileSync(path.join(destination, 'source-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
console.log(JSON.stringify(receipt))
