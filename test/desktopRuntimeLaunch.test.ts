import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  desktopCliPath,
  resolveDesktopCli,
} from '../electron/cliDiscovery.ts'
import {
  classifySidecarHealth,
  incompatibleSidecarMessage,
  REQUIRED_OPENSADDLE_CAPABILITY,
  REQUIRED_ONBOARDING_RUN_LIST_CONTRACT,
  REQUIRED_PROJECT_ONBOARDING_CONTRACT,
} from '../electron/sidecarCompatibility.ts'

function executable(target: string) {
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, '#!/bin/sh\nexit 0\n')
  chmodSync(target, 0o755)
}

test('Finder-style CLI discovery uses explicit and bounded common paths', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'opensaddle-cli-discovery-'))
  try {
    const home = path.join(root, 'home')
    const commonCodex = path.join(home, '.local', 'bin', 'codex')
    const configuredClaude = path.join(root, 'configured', 'claude')
    const searchedGemini = path.join(root, 'searched', 'gemini')
    executable(commonCodex)
    executable(configuredClaude)
    executable(searchedGemini)
    const env = {
      PATH: '/usr/bin:/bin',
      OPENSADDLE_CLI_SEARCH_PATH: path.dirname(searchedGemini),
      OPENSADDLE_CLAUDE_EXECUTABLE: configuredClaude,
    }
    const options = { env, home, platform: 'darwin' as const }

    assert.equal(resolveDesktopCli('codex', options), commonCodex)
    assert.equal(resolveDesktopCli('claude', options), configuredClaude)
    assert.equal(resolveDesktopCli('gemini', options), searchedGemini)
    assert.equal(resolveDesktopCli('../codex', options), null)
    mkdirSync(path.join(root, 'directory-named-codex'))
    assert.equal(resolveDesktopCli('codex', {
      ...options,
      env: { ...env, OPENSADDLE_CODEX_EXECUTABLE: path.join(root, 'directory-named-codex') },
    }), commonCodex)
    const effectivePath = desktopCliPath(options).split(':')
    assert.equal(effectivePath[0], path.dirname(configuredClaude))
    assert.ok(effectivePath.includes(path.dirname(searchedGemini)))
    assert.ok(effectivePath.includes(path.join(home, '.local', 'bin')))
    assert.ok(effectivePath.includes('/opt/homebrew/bin'))
    const inheritedByBackend = spawnSync('/bin/sh', ['-c', 'command -v codex'], {
      env: { PATH: effectivePath.join(':') },
      encoding: 'utf8',
    })
    assert.equal(inheritedByBackend.status, 0)
    assert.equal(inheritedByBackend.stdout.trim(), commonCodex)
    assert.deepEqual(
      desktopCliPath({ ...options, env: { ...env, OPENSADDLE_CLI_PATH_MODE: 'inherited-only' } }).split(':'),
      ['/usr/bin', '/bin'],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sidecar compatibility requires the exact onboarding capability contract', () => {
  const compatible = {
    service: 'opensaddle',
    mode: 'local',
    capabilities: ['projects', REQUIRED_OPENSADDLE_CAPABILITY],
    contracts: { project_onboarding: REQUIRED_PROJECT_ONBOARDING_CONTRACT, onboarding_run_list: REQUIRED_ONBOARDING_RUN_LIST_CONTRACT },
  }
  assert.equal(classifySidecarHealth(compatible), 'compatible')
  assert.equal(classifySidecarHealth({ ...compatible, capabilities: ['projects'] }), 'incompatible')
  assert.equal(classifySidecarHealth({ ...compatible, contracts: {} }), 'incompatible')
  assert.equal(classifySidecarHealth({ ...compatible, contracts: { project_onboarding: REQUIRED_PROJECT_ONBOARDING_CONTRACT } }), 'incompatible')
  assert.equal(classifySidecarHealth({ service: 'other', mode: 'local', capabilities: [REQUIRED_OPENSADDLE_CAPABILITY] }), 'incompatible')
  assert.match(incompatibleSidecarMessage('http://127.0.0.1:8765', false), /separate loopback port/)
  assert.match(incompatibleSidecarMessage('http://127.0.0.1:8765', true), /set OPENSADDLE_URL to a free loopback port/)
})

test('desktop launch passes resolved CLIs to the backend and selected URL to the renderer', () => {
  const main = readFileSync('electron/main.ts', 'utf8')
  const preload = readFileSync('electron/preload.cjs', 'utf8')
  const services = readFileSync('src/services/index.ts', 'utf8')
  const settings = readFileSync('src/pages/SettingsPage.tsx', 'utf8')
  assert.match(main, /PATH: desktopCliPath\(cliResolutionOptions\(\)\)/)
  assert.match(main, /OPENSADDLE_SIDECAR_STDIO === 'inherit'/)
  assert.match(main, /health === 'incompatible'/)
  assert.match(main, /opensaddleUrl = await unusedLoopbackUrl\(\)/)
  assert.match(main, /ipcMain\.on\('runtime:opensaddle-url'/)
  assert.match(preload, /opensaddleUrl: ipcRenderer\.sendSync\('runtime:opensaddle-url'\)/)
  assert.match(services, /window\.opensaddle\?\.opensaddleUrl/)
  assert.match(settings, /info\.opensaddleError/)
  assert.match(settings, /info\.opensaddleNotice/)
})

test('packaged onboarding smoke exercises profile-only prepare and cleanup', () => {
  const smoke = readFileSync('scripts/smoke-packaged-onboarding.mjs', 'utf8')
  assert.match(smoke, /\/api\/health/)
  assert.match(smoke, /\/api\/local-action-token/)
  assert.match(smoke, /\/api\/projects/)
  assert.match(smoke, /onboarding\/prepare/)
  assert.match(smoke, /active_run_id !== null/)
  assert.match(smoke, /execution_barriers\?\.includes\('git_clean'\)/)
  assert.match(smoke, /waitForManagedOwnership/)
  assert.match(smoke, /OPENSADDLE_CLI_PATH_MODE/)
  assert.match(smoke, /terminatePid/)
  assert.match(smoke, /waitForStopped/)
})
