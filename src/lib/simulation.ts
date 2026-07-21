import type { AgentRunBlock, Artifact, Harness, ModelKey, RuntimeKind, ToolCall } from '../types'
import { can } from '../services/capabilities'

export const MODEL_LABEL: Record<ModelKey, string> = {
  auto: 'Auto', gpt: 'GPT-5.6 Thinking', claude: 'Claude Opus', sonnet: 'Claude Sonnet', gemini: 'Gemini Pro', llama: 'Private Llama 4',
}
export const HARNESS_LABEL: Record<Harness, string> = {
  chat: 'Chat', research: 'Research', coding: 'Coding', browser: 'Browser', vm: 'VM agent',
}
export const RUNTIME_LABEL: Record<RuntimeKind, string> = {
  local: 'Local desktop', browser: 'Browser sandbox', sandbox: 'Ephemeral cloud VM', vm: 'Project VM', gpu: 'GPU machine', restricted: 'Restricted corporate',
}

export type RouteDecision = {
  klass: 'coding' | 'research' | 'browser' | 'chat' | 'ops'
  modelKey: ModelKey
  harnessKey: Harness
  runtimeKey: RuntimeKind
  reasons: string[]
  cost: string
}

export function classify(text: string): RouteDecision['klass'] {
  const l = text.toLowerCase()
  if (/salesforce|deploy|production|email|claim/.test(l)) return /code|repo|pr|feature|build|test/.test(l) ? 'coding' : 'ops'
  if (/code|repository|repo|pull request|\bpr\b|feature|build|refactor|test|debug|fix|vm/.test(l)) return 'coding'
  if (/research|compare|analy|summar|explore|report|architecture|investigate/.test(l)) return 'research'
  if (/website|chrome|browser|sharepoint|navigate|scrape/.test(l)) return 'browser'
  return 'chat'
}

/** Web builds start in the browser sandbox; local only when the desktop harness provides it. */
export function defaultRuntime(): RuntimeKind {
  return can('runtime.local') ? 'local' : 'browser'
}

export function deriveRoute(text: string, pref: string, overrides?: { model?: ModelKey; harness?: Harness | 'auto'; runtime?: RuntimeKind | 'auto' }): RouteDecision {
  const klass = classify(text)
  const baseRuntime = defaultRuntime()
  let modelKey: ModelKey = 'sonnet'
  let harnessKey: Harness = 'chat'
  let runtimeKey: RuntimeKind = baseRuntime
  let cost = '$0.03 – $0.09'

  if (klass === 'coding') { harnessKey = 'coding'; modelKey = pref === 'quality' ? 'claude' : 'sonnet'; runtimeKey = baseRuntime; cost = '$0.18 – $0.42' }
  else if (klass === 'research') { harnessKey = 'research'; modelKey = pref === 'fast' ? 'gemini' : 'gpt'; runtimeKey = 'sandbox'; cost = '$0.22 – $0.55' }
  else if (klass === 'browser' || klass === 'ops') { harnessKey = 'browser'; modelKey = 'sonnet'; runtimeKey = 'browser'; cost = '$0.06 – $0.15' }
  else { harnessKey = 'chat'; modelKey = pref === 'quality' ? 'claude' : 'sonnet'; runtimeKey = baseRuntime; cost = '$0.02 – $0.06' }

  if (pref === 'local') runtimeKey = baseRuntime
  if (pref === 'enterprise') modelKey = 'llama'
  if (pref === 'cost') modelKey = 'sonnet'
  if (pref === 'fast') modelKey = 'gemini'

  if (overrides?.model && overrides.model !== 'auto') modelKey = overrides.model
  if (overrides?.harness && overrides.harness !== 'auto') harnessKey = overrides.harness
  if (overrides?.runtime && overrides.runtime !== 'auto') runtimeKey = overrides.runtime

  const reasons = [
    `Task classified as ${klass === 'ops' ? 'operational change' : klass === 'coding' ? 'repository editing' : klass === 'research' ? 'research & analysis' : klass === 'browser' ? 'authenticated web use' : 'direct conversation'}`,
    `Project allows ${RUNTIME_LABEL[runtimeKey].toLowerCase()} access`,
    `${MODEL_LABEL[modelKey]} selected for ${pref}`,
    runtimeKey === 'local' ? 'VM not required — runs on device'
      : runtimeKey === 'browser' ? 'Runs in the browser sandbox — no install or VM needed'
      : `${RUNTIME_LABEL[runtimeKey]} available for isolation`,
  ]

  return { klass, modelKey, harnessKey, runtimeKey, reasons, cost }
}

export function needsPermission(text: string) {
  const l = text.toLowerCase()
  if (l.includes('salesforce')) return {
    resource: 'Salesforce Accounts API', title: 'Capability requested: Read a database',
    why: "To answer the user's question about at-risk accounts", data: 'Account name, region, renewal date',
    model: 'Claude Sonnet (US, approved)', reversible: 'Yes · read-only', risk: '~$0.02 · Low',
  }
  if (l.includes('production') || l.includes('deploy')) return {
    resource: 'Production deployment', title: 'Capability requested: Deploy applications',
    why: 'The change must reach the production environment', data: 'Build artifact + release notes',
    model: 'Claude Opus (US, approved)', reversible: 'No · rollback required', risk: '~$0.40 · High',
  }
  if (l.includes('email') || l.includes('cold email')) return {
    resource: 'Send email on your behalf', title: 'Capability requested: Send email',
    why: 'To deliver the drafted outreach to recipients', data: 'Recipient list, subject, body',
    model: 'Claude Sonnet (US, approved)', reversible: 'No · messages are sent', risk: '~$0.01 · Medium',
  }
  return null
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function simulateAgentRun(
  text: string,
  route: RouteDecision,
  onUpdate: (run: AgentRunBlock) => void,
): Promise<AgentRunBlock> {
  const klass: AgentRunBlock['kind'] =
    route.klass === 'ops' ? 'ops'
    : route.klass === 'chat' ? 'research'
    : route.klass
  const planLabels =
    klass === 'coding' ? ['Understand repository', 'Inspect relevant files', 'Implement changes', 'Run tests', 'Request approval']
    : klass === 'research' ? ['Understand question', 'Search knowledge & web', 'Read sources', 'Synthesize findings', 'Produce cited report']
    : ['Understand task', 'Open session', 'Navigate & extract', 'Validate', 'Summarize']

  const run: AgentRunBlock = {
    id: `run-${Date.now()}`,
    kind: klass,
    title: klass === 'coding' ? 'Coding agent run' : klass === 'research' ? 'Research agent run' : klass === 'ops' ? 'Operations agent run' : 'Browser agent run',
    model: MODEL_LABEL[route.modelKey],
    harness: HARNESS_LABEL[route.harnessKey],
    runtime: RUNTIME_LABEL[route.runtimeKey],
    statusText: 'Planning',
    done: false,
    tools: [],
    plan: planLabels.map((label) => ({ label, status: 'pending' as const })),
    artifacts: [],
  }
  onUpdate({ ...run })

  const statuses = planLabels.map((_, i) => {
    if (klass === 'coding') return ['Planning', 'Reading files', 'Implementing changes', 'Running tests', 'Validating output'][i]
    if (klass === 'research') return ['Planning', 'Searching knowledge', 'Reading sources', 'Synthesizing', 'Validating citations'][i]
    return ['Planning', 'Opening session', 'Navigating', 'Extracting', 'Validating'][i]
  })

  for (let step = 0; step < planLabels.length; step++) {
    run.plan = run.plan.map((p, i) => ({
      ...p,
      status: i < step ? 'done' : i === step ? 'active' : 'pending',
    }))
    run.statusText = statuses[step] ?? 'Working'
    onUpdate({ ...run, plan: [...run.plan], tools: [...run.tools], artifacts: [...run.artifacts] })
    await sleep(700)

    if (klass === 'coding' && step === 1) {
      run.tools.push(tool('Read files', 'file', 'glob: src/runtime/**/*.ts', 'Matched 24 files · 3,910 LOC', '0.8s', '$0.01'))
    }
    if (klass === 'coding' && step === 3) {
      run.tools.push(tool('Run tests', 'terminal', '$ npm test -- runtime', '18 passed, 0 failed · 4.2s', '4.2s', '$0.03'))
    }
    if (klass === 'coding' && step === 4) {
      run.artifacts.push(codingDiff())
    }
    if (klass === 'research' && step === 1) {
      run.tools.push(tool('Knowledge search', 'db', `query: "${text.slice(0, 40)}"`, '12 sources · top score 0.91', '1.1s', '$0.02'))
    }
    if (klass === 'research' && step === 2) {
      run.tools.push(tool('Read sources', 'file', '8 documents', 'Extracted 42 passages', '2.3s', '$0.05'))
    }
    if (klass === 'research' && step === 4) {
      run.artifacts.push(researchReport())
    }
    if ((klass === 'browser' || klass === 'ops') && step === 1) {
      run.tools.push(tool('Open session', 'globe', 'sandboxed Chromium', 'Authenticated', '0.9s', '$0.01'))
    }
    if ((klass === 'browser' || klass === 'ops') && step === 3) {
      run.artifacts.push(tableArtifact())
    }
    onUpdate({ ...run, plan: [...run.plan], tools: [...run.tools], artifacts: [...run.artifacts] })
  }

  run.plan = run.plan.map((p) => ({ ...p, status: 'done' }))
  run.done = true
  run.duration = `${(4 + Math.random() * 3).toFixed(1)}s`
  run.cost = `$${(0.18 + Math.random() * 0.2).toFixed(2)}`
  run.statusText = `Completed in ${run.duration}`
  onUpdate({ ...run })
  return run
}

function tool(name: string, icon: string, input: string, output: string, duration: string, cost: string): ToolCall {
  return { id: `tc-${Math.random().toString(36).slice(2, 7)}`, name, icon, input, output, duration, cost }
}

function codingDiff(): Artifact {
  return {
    id: `art-${Date.now()}`,
    type: 'diff',
    title: 'Proposed changes',
    subtitle: '2 files · +13 −1',
    diff: [
      {
        path: 'src/runtime/provision.ts', add: 5, del: 1,
        hunks: [{
          id: `h-${Date.now()}`, range: '@@ -20,6 +20,10 @@',
          lines: [
            { t: 'ctx', n: '20', c: '  const spec = resolveSpec(req);' },
            { t: 'del', n: '21', c: '  return allocate(spec);' },
            { t: 'add', n: '21', c: '  const approval = await requestBudget(spec, req.user);' },
            { t: 'add', n: '22', c: '  if (!approval.ok) throw new BudgetError(approval.reason);' },
            { t: 'add', n: '23', c: '  await audit.record("vm.provision", { spec, approval });' },
            { t: 'add', n: '24', c: '  return allocate(spec, { auditId: approval.id });' },
          ],
        }],
      },
      {
        path: 'src/runtime/background.ts', add: 8, del: 0,
        hunks: [{
          id: `h2-${Date.now()}`, range: '@@ -4,0 +5,8 @@',
          lines: [
            { t: 'add', n: '5', c: 'export async function continueInBackground(task) {' },
            { t: 'add', n: '6', c: '  const vm = await provision(task.request);' },
            { t: 'add', n: '7', c: '  queue.enqueue({ ...task, vmId: vm.id });' },
            { t: 'add', n: '8', c: '  return { vmId: vm.id, status: "running" };' },
            { t: 'add', n: '9', c: '}' },
          ],
        }],
      },
    ],
  }
}

function researchReport(): Artifact {
  return {
    id: `art-r-${Date.now()}`,
    type: 'report',
    title: 'Cited report',
    subtitle: 'Saved as project artifact · 4 sources',
    reportHtml: `<p><strong>Summary.</strong> The workspace is a layered agent platform: chat for UX, projects for durable scope, Auto for routing, and a permission gateway for protected calls <sup>[1][2]</sup>.</p><p>Routing balances quality, latency, cost, and data classification <sup>[3]</sup>.</p><p class="cite">[1] Runtime architecture v3 · [2] Permission gateway · [3] ADR-014</p>`,
  }
}

function tableArtifact(): Artifact {
  return {
    id: `art-t-${Date.now()}`,
    type: 'table',
    title: 'Extracted table',
    subtitle: '12 rows',
    table: {
      headers: ['Account', 'Region', 'Renewal', 'Risk'],
      rows: [
        ['Northwind', 'US-East', 'Aug 30', 'High'],
        ['Contoso', 'US-West', 'Sep 12', 'Medium'],
        ['Fabrikam', 'US-East', 'Oct 02', 'Low'],
      ],
    },
  }
}

export const DEMO_FLOWS = [
  { id: 'coding', title: 'Coding flow', prompt: 'Build a new feature that lets a user request a secure VM and continue the task in the background.', projectHint: 'Coding Agent' },
  { id: 'research', title: 'Research flow', prompt: 'Research and compare our model gateway architecture. Cite internal sources.', projectHint: 'Corporate Base Agent' },
  { id: 'corp', title: 'Corporate workflow', prompt: 'Look up at-risk Salesforce accounts and summarize renewals for review.', projectHint: 'Claims Assistant' },
]
