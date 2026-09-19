import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commissionPersonalRuntimeProcess } from '../electron/personalRuntimeCommissioning'

const request = { projectId: 'P', workspace: '/repo', adapter: 'codex' as const, executable: '/bin/codex', cpuMillicores: 1, memoryMiB: 1, maxConcurrency: 1 }
const failure = { schema_version: 'opensaddle.personal-runtime-startup-error.v1', protocol_version: 'opensaddle.personal-runtime.v1', project_id: 'P', code: 'personal_runtime_krail_missing' }

async function rejectedLaunch(payload: unknown): Promise<string> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'personal-startup-'))
  const state = path.join(root, 'state'), script = path.join(root, 'fixture.cjs'), pidFile = path.join(root, 'child.pid')
  mkdirSync(state)
  // External process fixture: the desktop spawner, private pipe parser and
  // cleanup are real. Provider stderr must never become user-facing content.
  writeFileSync(script, `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.stderr.write('private-diagnostic-secret');fs.writeSync(3,${JSON.stringify(JSON.stringify(payload) + '\n')});process.exit(2);`)
  let message = ''
  try {
    await assert.rejects(commissionPersonalRuntimeProcess({
      command: process.execPath, commandPrefix: [script], request,
      config: { projectDatabase: path.join(root, 'projects.db'), stateDir: state, ipcDir: state, port: 8766, handoffFd: 3 },
      expected: { baseUrl: 'http://127.0.0.1:8766/', projectId: 'P', ipcDir: state },
    }), (error: Error) => { message = error.message; return true })
    const pid = Number(readFileSync(pidFile, 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    assert.doesNotMatch(message, /private-diagnostic-secret|bearer-secret/)
    return message
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('personal runtime startup failure gives actionable dependency guidance after process cleanup', async () => {
  // PERSONAL-RUNTIME-STARTUP-1: missing optional support is a recoverable
  // installation failure, not an invalid credential handoff or leaked stderr.
  assert.match(await rejectedLaunch(failure), /Install the matching OpenSaddle package with KRAIL support/)
})

test('startup failure accepts only exact bound allowlisted codes', async () => {
  assert.match(await rejectedLaunch({ ...failure, code: 'personal_runtime_krail_incompatible' }), /KRAIL installation is incompatible/)
  assert.match(await rejectedLaunch({ ...failure, code: 'personal_runtime_platform_unsupported' }), /not supported on this operating system/)
  for (const payload of [
    { ...failure, code: '__proto__' },
    { ...failure, project_id: 'other-project' },
    { ...failure, protocol_version: 'unknown' },
    { ...failure, message: 'bearer-secret' },
  ]) assert.match(await rejectedLaunch(payload), /startup error contract is invalid/)
})
