import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const workflow = readFileSync('.github/workflows/desktop-release.yml', 'utf8')
const runtimeBuilder = readFileSync('scripts/build-krail-runtime.mjs', 'utf8')
const releaseGuide = readFileSync('docs/desktop-release.md', 'utf8')
const runtimeGuide = readFileSync('docs/desktop-krail-runtime.md', 'utf8')
const packageManifest = readFileSync('package.json', 'utf8')

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
  assert.match(workflow, /default: 1\.2\.0rc2/)
  assert.match(workflow, /default: 1\.2\.0rc5/)
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
  assert.match(runtimeBuilder, /--no-index/)
  assert.match(runtimeBuilder, /--require-hashes/)
  assert.match(packageManifest, /build-krail-runtime\.mjs --required/)
  assert.match(runtimeBuilder, /KRAIL_RUNTIME_LOCK/)
  assert.match(workflow, /wheelSetSha256/)
})

test('required runtime build fails without inputs and preserves the prior valid bundle', () => {
  const root=mkdtempSync(path.join(tmpdir(),'opensaddle-runtime-required-'))
  mkdirSync(path.join(root,'scripts'),{recursive:true});mkdirSync(path.join(root,'electron','runtime-bundle'),{recursive:true})
  cpSync('scripts/build-krail-runtime.mjs',path.join(root,'scripts','build-krail-runtime.mjs'))
  const sentinel=path.join(root,'electron','runtime-bundle','valid-existing-bundle');writeFileSync(sentinel,'keep')
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('KRAIL_')||key.startsWith('OPENSADDLE_')||key.endsWith('_SOURCE_REVISION'))delete env[key]
  const missing=spawnSync(process.execPath,['scripts/build-krail-runtime.mjs','--required'],{cwd:root,env,encoding:'utf8'})
  assert.equal(missing.status,1);assert.match(missing.stderr,/runtime not bundled/i);assert.equal(readFileSync(sentinel,'utf8'),'keep')
  const malformed=spawnSync(process.execPath,['scripts/build-krail-runtime.mjs','--required'],{cwd:root,env:{...env,KRAIL_WHEEL:path.join(root,'missing.whl'),KRAIL_VERSION:'1.2.3'},encoding:'utf8'})
  assert.equal(malformed.status,1);assert.equal(existsSync(sentinel),true)
})

test('runtime source export binds immutable archive bytes to exact commit and tree', () => {
  const root=mkdtempSync(path.join(tmpdir(),'opensaddle-source-export-'))
  const repo=path.join(root,'repo');const out=path.join(root,'out');mkdirSync(repo)
  const git=(args:string[])=>spawnSync('git',args,{cwd:repo,encoding:'utf8'})
  assert.equal(git(['init','-q']).status,0);assert.equal(git(['config','user.email','fixture@example.invalid']).status,0);assert.equal(git(['config','user.name','Fixture']).status,0)
  writeFileSync(path.join(repo,'tracked.txt'),'accepted bytes\n');assert.equal(git(['add','.']).status,0);assert.equal(git(['commit','-qm','fixture']).status,0)
  assert.equal(git(['remote','add','origin','https://github.com/AkeBoss-tech/opensaddle-interface.git']).status,0)
  const revision=git(['rev-parse','HEAD']).stdout.trim();const tree=git(['rev-parse','HEAD^{tree}']).stdout.trim()
  writeFileSync(path.join(repo,'tracked.txt'),'dirty bytes\n')
  const result=spawnSync(process.execPath,['scripts/export-runtime-source.mjs',repo,revision,out],{cwd:process.cwd(),encoding:'utf8'})
  assert.equal(result.status,0,result.stderr);const receipt=JSON.parse(readFileSync(path.join(out,'source-receipt.json'),'utf8'))
  assert.equal(receipt.revision,revision);assert.equal(receipt.tree,tree);assert.match(receipt.archiveSha256,/^[a-f0-9]{64}$/)
  assert.equal(spawnSync('tar',['-xOf',path.join(out,'source.tar'),'tracked.txt'],{encoding:'utf8'}).stdout,'accepted bytes\n')
  const repeat=spawnSync(process.execPath,['scripts/export-runtime-source.mjs',repo,revision,out],{cwd:process.cwd(),encoding:'utf8'});assert.equal(repeat.status,1);assert.match(repeat.stderr,/already exists/)
  const ancestor=spawnSync(process.execPath,['scripts/export-runtime-source.mjs',repo,revision,root],{cwd:process.cwd(),encoding:'utf8'});assert.equal(ancestor.status,1);assert.match(ancestor.stderr,/ancestor/)
})

test('a failure after offline install staging preserves the prior runtime', () => {
  const root=mkdtempSync(path.join(tmpdir(),'opensaddle-runtime-post-install-'));mkdirSync(path.join(root,'scripts'));mkdirSync(path.join(root,'electron','runtime-bundle'),{recursive:true})
  cpSync('scripts/build-krail-runtime.mjs',path.join(root,'scripts','build-krail-runtime.mjs'));const sentinel=path.join(root,'electron','runtime-bundle','valid-existing-bundle');writeFileSync(sentinel,'keep')
  const inputs=path.join(root,'inputs'),pyroot=path.join(root,'py','python','bin'),wheelhouse=path.join(inputs,'wheels');mkdirSync(pyroot,{recursive:true});mkdirSync(wheelhouse,{recursive:true})
  const fakePython=path.join(pyroot,'python3');writeFileSync(fakePython,'#!/bin/sh\nexit 0\n');chmodSync(fakePython,0o755)
  const pythonArchive=path.join(inputs,'python.tar.gz');assert.equal(spawnSync('tar',['-czf',pythonArchive,'-C',path.join(root,'py'),'.']).status,0)
  const digest=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');const pythonSha=digest(pythonArchive)
  const krail=path.join(wheelhouse,'krail-1.2.3-py3-none-any.whl'),opensaddle=path.join(wheelhouse,'opensaddle-1.2.3-py3-none-any.whl');writeFileSync(krail,'krail');writeFileSync(opensaddle,'opensaddle')
  const krailSource={repository:'https://github.com/AkeBoss-tech/knowledge.git',revision:'2'.repeat(40)};const opensaddleSource={repository:'https://github.com/AkeBoss-tech/opensaddle.git',revision:'3'.repeat(40)}
  const wheels=[{filename:path.basename(krail),url:'',sha256:digest(krail),size:statSync(krail).size,source:krailSource},{filename:path.basename(opensaddle),url:'',sha256:digest(opensaddle),size:statSync(opensaddle).size,source:opensaddleSource}]
  const requirements=path.join(inputs,'requirements.txt');writeFileSync(requirements,'fixture\n');const lock=path.join(inputs,'runtime-lock.json');writeFileSync(lock,JSON.stringify({schemaVersion:1,target:{platform:'macos',architecture:'arm64',python:'3.13'},python:{sha256:pythonSha,size:statSync(pythonArchive).size},topLevel:{krail:'1.2.3',opensaddle:'1.2.3'},requirementsSha256:digest(requirements),wheelSetSha256:createHash('sha256').update(JSON.stringify(wheels)).digest('hex'),wheels}))
  const largeTracked=path.join(root,'large-tracked-fixture');writeFileSync(largeTracked,'x'.repeat(2*1024*1024))
  const sourceArchive=path.join(inputs,'source.tar');assert.equal(spawnSync('tar',['-cf',sourceArchive,'-C',root,'scripts/build-krail-runtime.mjs','large-tracked-fixture']).status,0);const receipt=path.join(inputs,'source-receipt.json');writeFileSync(receipt,JSON.stringify({schemaVersion:1,repository:'https://github.com/AkeBoss-tech/opensaddle-interface.git',revision:'1'.repeat(40),tree:'4'.repeat(40),archiveSha256:digest(sourceArchive)}))
  const env={...process.env,INTERFACE_SOURCE_REVISION:'1'.repeat(40),INTERFACE_SOURCE_TREE:'4'.repeat(40),INTERFACE_SOURCE_ARCHIVE:sourceArchive,INTERFACE_SOURCE_RECEIPT:receipt,KRAIL_SOURCE_REVISION:krailSource.revision,KRAIL_SOURCE_TREE:'5'.repeat(40),OPENSADDLE_SOURCE_REVISION:opensaddleSource.revision,OPENSADDLE_SOURCE_TREE:'6'.repeat(40),KRAIL_WHEEL:krail,KRAIL_VERSION:'1.2.3',KRAIL_WHEEL_PROVENANCE:'reviewed_local',OPENSADDLE_WHEEL:opensaddle,OPENSADDLE_VERSION:'1.2.3',OPENSADDLE_WHEEL_PROVENANCE:'reviewed_local',KRAIL_PYTHON_RUNTIME:pythonArchive,KRAIL_PYTHON_RUNTIME_SHA256:pythonSha,KRAIL_RUNTIME_LOCK:lock,KRAIL_REQUIREMENTS_LOCK:requirements,KRAIL_WHEELHOUSE:wheelhouse}
  const result=spawnSync(process.execPath,['scripts/build-krail-runtime.mjs','--required'],{cwd:root,env,encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/dependency-install-report/);assert.equal(readFileSync(sentinel,'utf8'),'keep')
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
  assert.ok((workflow.match(/smoke-packaged-onboarding\.mjs/g) ?? []).length >= 2)
  assert.match(workflow, /--resources electron\/runtime-bundle/)
  assert.match(workflow, /smoke-packaged-onboarding\.mjs --app "\$APP_PATH"/)
  assert.match(workflow, /CHECKSUM_PATH="\$DMG_PATH\.sha256"/)
  assert.match(workflow, /provenance\.json/)
})

test('release documentation defines provenance and non-destructive rollback', () => {
  assert.match(releaseGuide, /OpenSaddle 1\.2\.0rc5, then Desktop v0\.2\.1/)
  assert.match(releaseGuide, /immutable release/i)
  assert.match(releaseGuide, /publish a higher `desktop-vX\.Y\.Z`/)
  assert.match(releaseGuide, /Never move the old tag or replace its DMG/)
  assert.match(releaseGuide, /packaged OpenSaddle backend/)
  assert.match(runtimeGuide, /KRAIL_PYTHON_RUNTIME_SHA256/)
  assert.match(runtimeGuide, /`python\/bin\/python3`/)
  assert.match(runtimeGuide, /raw_inbox/)
})
