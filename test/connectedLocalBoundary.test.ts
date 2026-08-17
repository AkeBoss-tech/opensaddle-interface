import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const app = source('src/App.tsx')
const services = source('src/services/index.ts')
const store = source('src/data/store.tsx')
const work = source('src/features/work/WorkPage.tsx')
const start = source('src/features/projects/ConnectedLocalStartPage.tsx')
const project = source('src/features/projects/ConnectedLocalProjectPage.tsx')
const dialog = source('src/features/onboarding/ConnectedLocalProjectDialog.tsx')

const required: Array<[string, string, string]> = [
  ['local routes are selected by authoritative connection mode', app, "controlPlane.connected && services.controlPlane.mode === 'local'"],
  ['local root redirects to Start', app, '<Route path="/" element={<Navigate to="/start" replace />} />'],
  ['local Start is mounted', app, '<Route path="/start" element={<StartPage />} />'],
  ['local Work is mounted', app, '<Route path="/work" element={<WorkPage />} />'],
  ['local project overview is source-backed', app, '<ConnectedLocalProjectPage />'],
  ['local onboarding is mounted', app, '<ProjectOnboardingPage />'],
  ['local Settings is mounted', app, '<Route path="/settings" element={<SettingsPage />} />'],
  ['unknown local routes fail back to Start', app, '<Route path="*" element={<Navigate to="/start" replace />} />'],
  ['local project creation uses the narrow dialog', app, '<ConnectedLocalProjectDialog'],
  ['local registration invokes the server project API', app, 'services.localProjects.registerProject(proposedId, root)'],
  ['server-returned project identity is retained', app, 'id: registered.projectId'],
  ['server-returned root derives presentation name', app, 'registered.root.split'],
  ['local registration navigates to governed onboarding', app, '/onboarding?${new URLSearchParams'],
  ['local command palette offers adding a project', app, "label: 'Add local project'"],
  ['local shortcut cannot create a generic chat', app, '!connectedLocal && (e.metaKey || e.ctrlKey)'],
  ['loopback mode cannot instantiate remote workspace', services, "backendMode !== 'local'"],
  ['loopback mode cannot instantiate remote threads', services, "const threads = backendAvailable && backendMode !== 'local'"],
  ['loopback mode cannot instantiate remote workflows', services, "const workflows = backendAvailable && backendMode !== 'local'"],
  ['registry hydration imports only missing projects', store, 'next.projects.push(projectFromRegisteredLocalProject'],
  ['Work reads the governed run registry', work, 'listOnboardingRuns?.(200)'],
  ['Work deep-links to the exact onboarding run', work, 'onboarding?run=${encodeURIComponent(run.runId)}'],
  ['Work maps approval required to attention', work, "run.status === 'approval_required' ? 'Needs approval'"],
  ['Start labels the trusted-local boundary', start, 'Trusted local workflow'],
  ['Start exposes server connection state', start, 'services?.controlPlane.connected'],
  ['Start does not fabricate runner readiness while capabilities are absent', start, 'No Codex or Claude runner reported by the control plane'],
  ['Start shows authoritative registered roots', start, 'project.local?.rootPath'],
  ['project overview loads authoritative onboarding state', project, 'localProjects?.onboardingState?.(projectId)'],
  ['project overview renders discovery fingerprint', project, 'state.fingerprint'],
  ['project overview renders ecosystems', project, 'state.discovery?.ecosystems'],
  ['project overview renders canonical evidence locators', project, '#${evidence.digest}'],
  ['native folder action is bridge-gated', project, 'window.opensaddle?.openPath && project.local'],
  ['registration dialog derives no renderer-side project name', dialog, 'Project folder'],
  ['registration dialog offers exact supported runners', dialog, '<option value="codex_cli">Codex CLI</option>'],
]

for (const [name, body, needle] of required) {
  test(name, () => assert.ok(body.includes(needle), `missing boundary: ${needle}`))
}

test('local registry hydration does not synthesize permission grants', () => {
  const block = store.slice(store.indexOf('services.localProjects.listProjects()'), store.indexOf('if (!services?.threads)'))
  assert.doesNotMatch(block, /permissionGrants\.push|action of \['read'/)
})

test('local routes do not mount generic chat or workflow pages', () => {
  const localRoutes = app.slice(app.indexOf('{connectedLocal ? <Routes>'), app.indexOf('</Routes> : <Routes>'))
  assert.doesNotMatch(localRoutes, /ChatPage|WorkflowsPage|PermissionsPage|BrowserRuntimePage|LocalProjectsPage/)
})
