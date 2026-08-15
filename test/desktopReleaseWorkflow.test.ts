import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/desktop-release.yml', 'utf8')
const runtimeBuilder = readFileSync('scripts/build-krail-runtime.mjs', 'utf8')
const releaseGuide = readFileSync('docs/desktop-release.md', 'utf8')
const runtimeGuide = readFileSync('docs/desktop-krail-runtime.md', 'utf8')

test('desktop release is manual, tag-bound, and immutable', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s+push:/m)
  assert.match(workflow, /ref: refs\/tags\/\$\{\{ inputs\.tag \}\}/)
  assert.match(workflow, /\^desktop-v\(\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\)\$/)
  assert.match(workflow, /electron\/package\.json/)
  assert.match(workflow, /repos\/\$GITHUB_REPOSITORY\/immutable-releases/)
  assert.match(workflow, /X-GitHub-Api-Version: 2026-03-10/)
  assert.match(workflow, /gh release create/)
  assert.match(workflow, /--verify-tag/)
  assert.doesNotMatch(workflow, /--clobber/)
  assert.ok((workflow.match(/gh release view/g) ?? []).length >= 2)
})

test('desktop release verifies official wheels and the pinned Python archive', () => {
  assert.match(workflow, /runs-on: macos-15/)
  assert.match(workflow, /default: 1\.2\.0rc1/)
  assert.doesNotMatch(workflow, /KRAIL_VERSION: 1\.1\.13/)
  assert.doesNotMatch(workflow, /OPENSADDLE_VERSION: 1\.1\.1/)
  assert.match(workflow, /https:\/\/pypi\.org\/pypi\/krail\/\$\{KRAIL_VERSION\}\/json/)
  assert.match(workflow, /https:\/\/pypi\.org\/pypi\/opensaddle\/\$\{OPENSADDLE_VERSION\}\/json/)
  assert.match(workflow, /resolve_official_wheel/)
  assert.match(workflow, /https:\\?\/\\?\/files\\?\.pythonhosted\\?\.org/)
  assert.ok((workflow.match(/shasum -a 256 -c/g) ?? []).length >= 3)
  assert.match(workflow, /KRAIL_PYTHON_RUNTIME="\$PYTHON_ARCHIVE"/)
  assert.match(workflow, /KRAIL_PYTHON_RUNTIME_SHA256="\$PYTHON_ARCHIVE_SHA256"/)
  assert.match(workflow, /OPENSADDLE_WHEEL="\$OPENSADDLE_WHEEL"/)
  assert.match(runtimeBuilder, /python\/bin\/python3/)
  assert.match(runtimeBuilder, /OPENSADDLE_WHEEL/)
  assert.match(runtimeBuilder, /KRAIL_VERSION/)
  assert.match(runtimeBuilder, /OPENSADDLE_VERSION/)
})

test('desktop release fails closed for signing and smoke-tests packaged launchers', () => {
  for (const secret of [
    'MACOS_CERTIFICATE_BASE64',
    'MACOS_CERTIFICATE_PASSWORD',
    'MACOS_SIGNING_IDENTITY',
    'MACOS_KEYCHAIN_PASSWORD',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
    'RELEASE_ADMIN_TOKEN',
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`))
    assert.ok(releaseGuide.includes('`' + secret + '`'))
  }
  assert.match(workflow, /notarytool submit/)
  assert.match(workflow, /stapler staple/)
  assert.match(workflow, /stapler validate/)
  assert.match(workflow, /codesign --verify --deep --strict/)
  assert.match(workflow, /spctl --assess/)
  assert.ok((workflow.match(/env -i PATH=\/usr\/bin:\/bin/g) ?? []).length >= 6)
  for (const launcher of ['krail-admin', 'krail-mutate', 'opensaddle']) {
    assert.ok((workflow.match(new RegExp(`${launcher.replace('-', '\\-')}.*--help`, 'g')) ?? []).length >= 2)
  }
  assert.match(workflow, /CHECKSUM_PATH="\$DMG_PATH\.sha256"/)
  assert.match(workflow, /provenance\.json/)
})

test('release documentation defines provenance and non-destructive rollback', () => {
  assert.match(releaseGuide, /OpenSaddle 1\.2, then Desktop v0\.2\.0/)
  assert.match(releaseGuide, /immutable release/i)
  assert.match(releaseGuide, /publish a higher `desktop-vX\.Y\.Z`/)
  assert.match(releaseGuide, /Never move the old tag or replace its DMG/)
  assert.match(releaseGuide, /packaged OpenSaddle backend/)
  assert.match(runtimeGuide, /KRAIL_PYTHON_RUNTIME_SHA256/)
  assert.match(runtimeGuide, /`python\/bin\/python3`/)
  assert.match(runtimeGuide, /raw_inbox/)
})
