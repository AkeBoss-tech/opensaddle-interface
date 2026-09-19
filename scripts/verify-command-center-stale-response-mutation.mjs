import { readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const directory = path.join(root, 'src/features/command-center')
const sourcePath = path.join(directory, 'CommandCenterSurface.tsx')
const testPath = path.join(directory, 'CommandCenterPage.mounted.test.tsx')
const suffix = `${process.pid}-${crypto.randomUUID()}`
const mutationModule = `CommandCenterSurface.__mutation-${suffix}`
const mutationPath = path.join(directory, `${mutationModule}.tsx`)
const mutationTestPath = path.join(directory, `CommandCenterPage.__mutation-${suffix}.test.tsx`)

const source = await readFile(sourcePath, 'utf8')
const test = await readFile(testPath, 'utf8')
let mutated = source
mutated = mutated.replace("if(current===generation.current)setState({ kind: 'ready', snapshot,identity,client })", "setState({ kind: 'ready', snapshot,identity,client })")
mutated = mutated.replace("if(current===generation.current)setState({ kind: 'error', reason: error instanceof Error ? error.message : String(error),identity,client })", "setState({ kind: 'error', reason: error instanceof Error ? error.message : String(error),identity,client })")
mutated = mutated.replace("&&(state.identity!==identity||state.client!==client)", "&&false")

if (mutated === source || mutated.includes('if(current===generation.current)setState')) {
  throw new Error('The controlled mutation did not remove the expected stale-response fences.')
}

const mutatedTest = test.replace("from'./CommandCenterSurface'", `from'./${mutationModule}'`)
if (mutatedTest === test) throw new Error('The mounted suite import did not bind to the disposable mutation.')

try {
  await writeFile(mutationPath, mutated)
  await writeFile(mutationTestPath, mutatedTest)
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', mutationTestPath], { cwd: root, encoding: 'utf8' })
  const output = `${result.stdout}\n${result.stderr}`
  const expectedFailures = [
    'a disconnected mounted surface cannot republish a deferred protected snapshot',
    'replacement client success and error both fence the earlier connection',
    'overlapping refreshes retain only the latest result or error',
    'render-time client replacement hides a ready old snapshot before effects run',
  ]
  const reproduced = expectedFailures.filter(name => output.includes(`✖ ${name}`))
  if (result.status === 0 || reproduced.length < 2) {
    process.stderr.write(output)
    throw new Error(`Controlled mutation did not reproduce enough stale-response failures (${reproduced.length}/4).`)
  }
  console.log(JSON.stringify({
    controlledMutation: true,
    historicalReproduction: false,
    testFile: 'src/features/command-center/CommandCenterPage.mounted.test.tsx',
    mutatedFences: ['success generation fence', 'error generation fence', 'render-time identity/client fence'],
    processExit: result.status,
    reproducedFailures: reproduced,
  }, null, 2))
} finally {
  await Promise.all([rm(mutationPath, { force: true }), rm(mutationTestPath, { force: true })])
}
