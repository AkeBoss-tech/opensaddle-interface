import type { AppData } from '../types'

const now = Date.now()
const hour = 3600_000
const day = 24 * hour

export const DATA_VERSION = 5
export const STORAGE_KEY = 'opensaddle-data-v5'

export function createSeedData(): AppData {
  const corp = 'proj-corp'
  const cust = 'proj-customer'
  const claims = 'proj-claims'
  const cold = 'proj-cold'
  const eng = 'proj-eng'
  const coding = 'proj-coding'
  const router = 'proj-router'
  const audit = 'proj-audit'

  const chatCoding = 'chat-coding-pr'
  const chatResearch = 'chat-research'
  const chatClaims = 'chat-claims'
  const chatNew = 'chat-welcome'

  return {
    version: DATA_VERSION,
    workspaceName: 'Acme enterprise workspace',
    currentUserId: 'user-ad',
    members: [
      { id: 'user-ad', name: 'Akash Dubey', initials: 'AD', role: 'Admin', email: 'akash@acme.com' },
      { id: 'user-maya', name: 'Maya Chen', initials: 'MC', role: 'Editor', email: 'maya@acme.com' },
      { id: 'user-jordan', name: 'Jordan Lee', initials: 'JL', role: 'Reviewer', email: 'jordan@acme.com' },
      { id: 'user-sec', name: 'Security Ops', initials: 'SO', role: 'Reviewer', email: 'secops@acme.com' },
      { id: 'user-priya', name: 'Priya Shah', initials: 'PS', role: 'Viewer', email: 'priya@acme.com' },
    ],
    projects: [
      { id: corp, name: 'Corporate Base Agent', parentId: null, description: 'Default enterprise agent with corporate-safe routing, shared knowledge, and a permission gateway.', iconColor: '#80a9ff', knowledgeCount: 12, serviceCount: 8, childCount: 4, autoConfidence: 93, lineage: ['Organization', 'Corporate Base Agent'] },
      { id: cust, name: 'Customer Operations', parentId: corp, description: 'Claims, outreach, and customer-facing workflows.', iconColor: '#9b83ff', knowledgeCount: 6, serviceCount: 4, childCount: 2, autoConfidence: 88, lineage: ['Organization', 'Corporate Base Agent', 'Customer Operations'] },
      { id: claims, name: 'Claims Assistant', parentId: cust, description: 'Drafts claim responses with human approval on writes.', iconColor: '#8f78de', knowledgeCount: 4, serviceCount: 3, childCount: 0, autoConfidence: 91, lineage: ['Organization', 'Corporate Base Agent', 'Customer Operations', 'Claims Assistant'] },
      { id: cold, name: 'Cold Emailer', parentId: cust, description: 'Outreach drafts with send gated by approval.', iconColor: '#d6af63', knowledgeCount: 3, serviceCount: 2, childCount: 0, autoConfidence: 84, lineage: ['Organization', 'Corporate Base Agent', 'Customer Operations', 'Cold Emailer'] },
      { id: eng, name: 'Engineering', parentId: corp, description: 'Repositories, CI systems, and coding agents.', iconColor: '#73a8dd', knowledgeCount: 9, serviceCount: 5, childCount: 3, autoConfidence: 95, lineage: ['Organization', 'Corporate Base Agent', 'Engineering'] },
      { id: coding, name: 'Coding Agent', parentId: eng, description: 'Repository-aware planning, patches, tests, and PRs.', iconColor: '#cf7979', knowledgeCount: 7, serviceCount: 3, childCount: 0, autoConfidence: 96, lineage: ['Organization', 'Engineering', 'Scarlet Sync', 'Coding Agent'], routingDefaults: { providerKey: 'codex', modelKey: 'sonnet', runtimeKey: 'sandbox', reviewProviderKey: 'claude' } },
      { id: router, name: 'Model Router', parentId: eng, description: 'Routing policy, cost controls, and harness selection.', iconColor: '#73a8dd', knowledgeCount: 5, serviceCount: 2, childCount: 0, autoConfidence: 90, lineage: ['Organization', 'Engineering', 'Model Router'] },
      { id: audit, name: 'Degree Audit', parentId: coding, description: 'Nested project that inherits GitHub but denies production DB writes.', iconColor: '#65c78b', knowledgeCount: 3, serviceCount: 2, childCount: 0, autoConfidence: 89, lineage: ['Organization', 'Engineering', 'Scarlet Sync', 'Degree Audit'] },
    ],
    chats: [
      { id: chatNew, projectId: corp, title: 'New chat', visibility: 'private', createdAt: now, updatedAt: now, sharedWith: [] },
      { id: chatCoding, projectId: coding, title: 'Secure VM background feature', visibility: 'shared', createdAt: now - 2 * hour, updatedAt: now - hour, sharedWith: ['user-maya', 'user-jordan'], agentId: 'agent-coder' },
      { id: chatResearch, projectId: corp, title: 'Model gateway architecture review', visibility: 'project', createdAt: now - day, updatedAt: now - 3 * hour, sharedWith: [], agentId: 'agent-research' },
      { id: chatClaims, projectId: claims, title: 'At-risk Salesforce renewals', visibility: 'shared', createdAt: now - 5 * hour, updatedAt: now - 4 * hour, sharedWith: ['user-maya'], agentId: 'agent-claims' },
      { id: 'chat-policy', projectId: router, title: 'Audit policy-aware routing', visibility: 'project', createdAt: now - 2 * day, updatedAt: now - day, sharedWith: [] },
      { id: 'chat-sharepoint', projectId: corp, title: 'Create SharePoint knowledge index', visibility: 'private', createdAt: now - 3 * day, updatedAt: now - 2 * day, sharedWith: [] },
      { id: 'chat-prs', projectId: coding, title: 'Review GitHub pull requests', visibility: 'shared', createdAt: now - 4 * day, updatedAt: now - 3 * day, sharedWith: ['user-jordan'] },
    ],
    messages: [
      {
        id: 'm1', chatId: chatCoding, role: 'user', createdAt: now - 2 * hour,
        text: 'Build a new feature that lets a user request a secure VM and continue the task in the background.',
      },
      {
        id: 'm2', chatId: chatCoding, role: 'assistant', createdAt: now - 2 * hour + 60_000,
        text: '',
        routingNote: 'Auto · Claude Opus · Coding · Local',
        run: {
          id: 'run-seed-coding',
          kind: 'coding',
          title: 'Coding agent run',
          model: 'Claude Opus',
          harness: 'Coding',
          runtime: 'Local desktop',
          statusText: 'Completed in 6.0s',
          done: true,
          duration: '6.0s',
          cost: '$0.33',
          plan: [
            { label: 'Understand repository', status: 'done' },
            { label: 'Inspect relevant files', status: 'done' },
            { label: 'Implement changes', status: 'done' },
            { label: 'Run tests', status: 'done' },
            { label: 'Request approval', status: 'done' },
          ],
          tools: [
            { id: 't1', name: 'Read files', icon: 'file', input: 'glob: src/runtime/**/*.ts', output: 'Matched 24 files · 3,910 LOC', duration: '0.8s', cost: '$0.01' },
            { id: 't2', name: 'Run tests', icon: 'terminal', input: '$ npm test -- runtime', output: '18 passed, 0 failed · 4.2s', duration: '4.2s', cost: '$0.03' },
          ],
          artifacts: [{
            id: 'a1', type: 'diff', title: 'Proposed changes', subtitle: '2 files · +13 −1',
            diff: [
              {
                path: 'src/runtime/provision.ts', add: 5, del: 1,
                hunks: [{
                  id: 'h1', range: '@@ -20,6 +20,10 @@', status: 'accepted',
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
                  id: 'h2', range: '@@ -4,0 +5,8 @@',
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
          }],
        },
      },
      {
        id: 'm3', chatId: chatResearch, role: 'user', createdAt: now - day,
        text: 'Research and compare our model gateway architecture. Cite internal sources.',
      },
      {
        id: 'm4', chatId: chatResearch, role: 'assistant', createdAt: now - day + 120_000,
        text: '',
        routingNote: 'Auto · GPT-5.6 · Research · Cloud VM',
        run: {
          id: 'run-seed-research',
          kind: 'research',
          title: 'Research agent run',
          model: 'GPT-5.6 Thinking',
          harness: 'Research',
          runtime: 'Ephemeral cloud VM',
          statusText: 'Completed in 6.6s',
          done: true,
          duration: '6.6s',
          cost: '$0.27',
          plan: [
            { label: 'Understand question', status: 'done' },
            { label: 'Search knowledge & web', status: 'done' },
            { label: 'Read sources', status: 'done' },
            { label: 'Synthesize findings', status: 'done' },
            { label: 'Produce cited report', status: 'done' },
          ],
          tools: [
            { id: 'rt1', name: 'Knowledge search', icon: 'db', input: 'query: model gateway architecture', output: '12 sources · top score 0.91', duration: '1.1s', cost: '$0.02' },
            { id: 'rt2', name: 'Read sources', icon: 'file', input: '8 documents', output: 'Extracted 42 passages', duration: '2.3s', cost: '$0.05' },
          ],
          artifacts: [{
            id: 'ar1', type: 'report', title: 'Cited report', subtitle: 'Saved as project artifact · 4 sources',
            reportHtml: `<p><strong>Summary.</strong> The workspace is a layered agent platform: chat for UX, projects for durable scope, Auto mode for routing, a permission gateway for every protected call, and runs/automations for long work <sup>[1][2]</sup>.</p><p>Routing balances quality, latency, cost, and data classification, keeping regulated data on approved US models <sup>[3]</sup>.</p><p class="cite">[1] Runtime architecture v3 · [2] Permission gateway spec · [3] Model routing policy (ADR-014)</p>`,
          }],
        },
      },
      {
        id: 'm5', chatId: chatClaims, role: 'user', createdAt: now - 5 * hour,
        text: 'Look up at-risk Salesforce accounts and summarize renewals.',
      },
      {
        id: 'm6', chatId: chatClaims, role: 'assistant', createdAt: now - 5 * hour + 90_000,
        text: '',
        lightHtml: `<p>Access was granted for this chat. I read at-risk accounts with least-privileged scope and recorded the call to the audit log.</p><p><strong>Findings:</strong> 3 accounts renew within 45 days; Northwind is high risk.</p>`,
        routingNote: 'Auto · Claude Sonnet · Browser · Local',
        run: {
          id: 'run-seed-claims',
          kind: 'ops',
          title: 'Operations agent run',
          model: 'Claude Sonnet',
          harness: 'Browser',
          runtime: 'Local desktop',
          statusText: 'Completed',
          done: true,
          tools: [
            { id: 'ct1', name: 'Salesforce read', icon: 'db', input: 'Accounts where risk=high', output: '12 rows returned', duration: '1.4s', cost: '$0.02' },
          ],
          plan: [
            { label: 'Request permission', status: 'done' },
            { label: 'Query accounts', status: 'done' },
            { label: 'Summarize renewals', status: 'done' },
          ],
          artifacts: [{
            id: 'at1', type: 'table', title: 'At-risk accounts',
            table: {
              headers: ['Account', 'Region', 'Renewal', 'Risk'],
              rows: [
                ['Northwind', 'US-East', 'Aug 30', 'High'],
                ['Contoso', 'US-West', 'Sep 12', 'Medium'],
                ['Fabrikam', 'US-East', 'Oct 02', 'Low'],
              ],
            },
          }],
        },
      },
    ],
    agents: [
      { id: 'agent-coder', projectId: coding, name: 'Secure Coding Agent', description: 'Plans, edits, tests, and opens PRs in managed sandboxes.', systemPrompt: 'You are a careful coding agent. Prefer smallest diffs. Never deploy without approval.', modelPolicy: 'claude', harness: 'coding', runtime: 'sandbox', tools: ['Files', 'GitHub', 'Terminal', 'VM'], knowledgeSourceIds: ['kn-github'], interfaceId: 'iface-chat-diff', visibility: 'shared', createdAt: now - 10 * day },
      { id: 'agent-research', projectId: corp, name: 'Research Analyst', description: 'Searches knowledge and produces cited reports.', systemPrompt: 'Cite sources. Prefer internal knowledge over web.', modelPolicy: 'gpt', harness: 'research', runtime: 'sandbox', tools: ['Knowledge', 'Web'], knowledgeSourceIds: ['kn-sharepoint', 'kn-drive'], interfaceId: 'iface-doc', visibility: 'project', createdAt: now - 8 * day },
      { id: 'agent-claims', projectId: claims, name: 'Claims Copilot', description: 'Drafts claim responses; writes require approval.', systemPrompt: 'Never invent policy. Escalate ambiguous cases.', modelPolicy: 'sonnet', harness: 'browser', runtime: 'local', tools: ['Salesforce', 'Files'], knowledgeSourceIds: ['kn-claims'], interfaceId: 'iface-form', visibility: 'shared', createdAt: now - 6 * day },
      { id: 'agent-cold', projectId: cold, name: 'Cold Email Drafter', description: 'Writes outreach drafts; sending is gated by human approval.', systemPrompt: 'Draft concise, personalized outreach. Never send without approval.', modelPolicy: 'sonnet', harness: 'chat', runtime: 'browser', tools: ['Files', 'Email'], knowledgeSourceIds: [], visibility: 'project', createdAt: now - 6 * day },
      { id: 'agent-router', projectId: router, name: 'Routing Policy Analyst', description: 'Audits routing decisions, cost controls, and harness selection.', systemPrompt: 'Explain routing decisions with policy citations and cost impact.', modelPolicy: 'gpt', harness: 'research', runtime: 'sandbox', tools: ['Knowledge'], knowledgeSourceIds: ['kn-github'], visibility: 'project', createdAt: now - 7 * day },
      { id: 'agent-audit', projectId: audit, name: 'Degree Audit Agent', description: 'Repository-aware checks that inherit GitHub but deny production DB writes.', systemPrompt: 'Read-only against production data. Propose changes as diffs.', modelPolicy: 'sonnet', harness: 'coding', runtime: 'sandbox', tools: ['Files', 'GitHub'], knowledgeSourceIds: ['kn-github'], visibility: 'project', createdAt: now - 5 * day },
    ],
    sites: [
      {
        id: 'site-claims', projectId: claims, name: 'Claims intake portal', description: 'Customer-facing intake experience with an embedded claims agent.',
        slug: 'claims-intake', accent: '#8f78de',
        agentId: 'agent-claims', agentPlacement: 'bubble', visibility: 'shared', createdAt: now - 5 * day, updatedAt: now - 3 * hour,
        pages: [
          { id: 'sp1', title: 'Home', body: 'Submit a claim update and let the assistant draft a response for review. Every submission is routed through the claims copilot with human approval on writes.', agentRail: true },
          { id: 'sp1b', title: 'Track a claim', body: 'Enter your claim ID to see live status, adjuster notes, and expected resolution dates.', agentRail: true },
          { id: 'sp1c', title: 'FAQ', body: 'Answers to common coverage, deductible, and timeline questions — the agent can answer anything not covered here.', agentRail: true },
        ],
        versions: [
          { id: 'sv-claims-3', label: 'v3', summary: 'Added claim tracking page and FAQ', status: 'draft', createdAt: now - 3 * hour, createdBy: 'user-maya' },
          { id: 'sv-claims-2', label: 'v2', summary: 'Embedded claims copilot bubble on every page', status: 'published', createdAt: now - 2 * day, createdBy: 'user-ad' },
          { id: 'sv-claims-1', label: 'v1', summary: 'Initial intake form', status: 'archived', createdAt: now - 5 * day, createdBy: 'user-ad' },
        ],
        publishedVersionId: 'sv-claims-2',
      },
      {
        id: 'site-status', projectId: eng, name: 'Engineering status page', description: 'Internal status page with coding-agent Q&A on incidents.',
        slug: 'eng-status', accent: '#73a8dd',
        agentId: 'agent-coder', agentPlacement: 'rail', visibility: 'project', createdAt: now - 4 * day, updatedAt: now - day,
        pages: [
          { id: 'sp2', title: 'Status', body: 'All systems operational. Ask the coding agent about recent incidents, deploys, or postmortems.', agentRail: true },
          { id: 'sp2b', title: 'Incidents', body: 'No active incidents. Last incident: elevated API latency (resolved Jul 18).', agentRail: true },
        ],
        versions: [
          { id: 'sv-status-2', label: 'v2', summary: 'Incident history + agent rail', status: 'published', createdAt: now - day, createdBy: 'user-ad' },
          { id: 'sv-status-1', label: 'v1', summary: 'Basic status board', status: 'archived', createdAt: now - 4 * day, createdBy: 'user-ad' },
        ],
        publishedVersionId: 'sv-status-2',
      },
      {
        id: 'site-outreach', projectId: cold, name: 'Outreach preview studio', description: 'Review outreach drafts and approve sends from one page.',
        slug: 'outreach-studio', accent: '#d6af63',
        agentId: 'agent-cold', agentPlacement: 'bubble', visibility: 'private', createdAt: now - 2 * day, updatedAt: now - 5 * hour,
        pages: [
          { id: 'sp3', title: 'Drafts', body: 'Pending outreach drafts appear here. Approve, edit, or ask the drafter agent to rewrite in a different tone.', agentRail: true },
        ],
        versions: [
          { id: 'sv-outreach-1', label: 'v1', summary: 'Draft review board', status: 'draft', createdAt: now - 2 * day, createdBy: 'user-ad' },
        ],
      },
    ],
    apis: [
      {
        id: 'api-accounts', projectId: claims, name: 'At-risk accounts API', description: 'Mock CRUD over renewal risk records.',
        path: '/api/claims/at-risk', visibility: 'shared', createdAt: now - 3 * day,
        fields: [
          { name: 'account', type: 'string' },
          { name: 'region', type: 'string' },
          { name: 'renewal', type: 'date' },
          { name: 'risk', type: 'string' },
        ],
        records: [
          { id: 'r1', data: { account: 'Northwind', region: 'US-East', renewal: '2026-08-30', risk: 'High' } },
          { id: 'r2', data: { account: 'Contoso', region: 'US-West', renewal: '2026-09-12', risk: 'Medium' } },
          { id: 'r3', data: { account: 'Fabrikam', region: 'US-East', renewal: '2026-10-02', risk: 'Low' } },
        ],
        transformScript: `// Normalize risk labels\nreturn records.map(r => ({\n  ...r,\n  data: { ...r.data, risk: String(r.data.risk).toUpperCase() }\n}));`,
        runHistory: [
          { at: now - hour, action: 'GET', detail: 'Listed 3 records' },
          { at: now - 2 * hour, action: 'TRANSFORM', detail: 'Normalized risk labels' },
        ],
      },
      {
        id: 'api-prs', projectId: coding, name: 'PR findings API', description: 'Stores coding-agent review findings.',
        path: '/api/engineering/pr-findings', visibility: 'project', createdAt: now - 2 * day,
        fields: [
          { name: 'pr', type: 'number' },
          { name: 'severity', type: 'string' },
          { name: 'severity', type: 'string' },
        ],
        records: [
          { id: 'p1', data: { pr: 1932, severity: 'medium', finding: 'Missing budget check on VM provision' } },
        ],
        transformScript: `return records;`,
        runHistory: [{ at: now - 3 * hour, action: 'POST', detail: 'Inserted finding for PR #1932' }],
      },
    ],
    dashboards: [
      {
        id: 'dash-ops', projectId: cust, name: 'Customer ops pulse', description: 'KPIs for claims and outreach.',
        visibility: 'shared', createdAt: now - day,
        widgets: [
          { id: 'w1', type: 'kpi', title: 'Open claims', value: '128', delta: '↓ 6% WoW' },
          { id: 'w2', type: 'kpi', title: 'Avg draft time', value: '4.2m', delta: '↓ 18%' },
          { id: 'w3', type: 'chart', title: 'Daily agent assists', chartBars: [40, 55, 48, 72, 61, 80, 74] },
          { id: 'w4', type: 'table', title: 'Top queues', table: { headers: ['Queue', 'Waiting', 'SLA'], rows: [['High sev', '12', '92%'], ['Renewals', '34', '88%']] } },
        ],
      },
      {
        id: 'dash-cost', projectId: router, name: 'Routing cost board', description: 'Spend and Auto savings.',
        visibility: 'project', createdAt: now - 2 * day,
        widgets: [
          { id: 'w5', type: 'kpi', title: 'MTD spend', value: '$4,982', delta: '↓ 8.4%' },
          { id: 'w6', type: 'kpi', title: 'Auto savings', value: '$1,940', delta: 'vs manual' },
          { id: 'w7', type: 'chart', title: 'Spend by day', chartBars: [46, 62, 55, 74, 59, 82, 70] },
        ],
      },
    ],
    interfaces: [
      {
        id: 'iface-chat-diff', projectId: coding, name: 'Chat + Diff', kind: 'chat',
        description: 'Classic chat with run cards and diff review.',
        layout: { showChat: true, showForm: false, showMetrics: false, showDocument: false, heroTitle: 'Coding workspace' },
        agentId: 'agent-coder', visibility: 'shared', createdAt: now - 9 * day,
      },
      {
        id: 'iface-form', projectId: claims, name: 'Claims form workflow', kind: 'form',
        description: 'Structured intake form with agent review panel.',
        layout: { showChat: true, showForm: true, showMetrics: true, showDocument: false, formFields: ['Claim ID', 'Customer', 'Issue summary', 'Priority'], heroTitle: 'Claims intake' },
        agentId: 'agent-claims', visibility: 'shared', createdAt: now - 7 * day,
      },
      {
        id: 'iface-doc', projectId: corp, name: 'Document studio', kind: 'document',
        description: 'Report-first interface with side chat.',
        layout: { showChat: true, showForm: false, showMetrics: false, showDocument: true, heroTitle: 'Research studio' },
        agentId: 'agent-research', visibility: 'project', createdAt: now - 7 * day,
      },
      {
        id: 'iface-custom', projectId: eng, name: 'Status + agent rail', kind: 'custom',
        description: 'Full page with floating agent assistant.',
        layout: { showChat: true, showForm: false, showMetrics: true, showDocument: false, heroTitle: 'Engineering status' },
        agentId: 'agent-coder', visibility: 'project', createdAt: now - 4 * day,
      },
    ],
    knowledge: [
      { id: 'kn-sharepoint', projectId: corp, name: 'Corporate SharePoint', kind: 'SharePoint', status: 'Indexed', items: 1240, lastSync: '12 min ago', sensitivity: 'Internal', owner: 'IT' },
      { id: 'kn-files', projectId: corp, name: 'Project files', kind: 'Files', status: 'Live', items: 82, lastSync: 'Live', sensitivity: 'Internal', owner: 'Akash Dubey' },
      { id: 'kn-github', projectId: coding, name: 'GitHub documentation', kind: 'GitHub', status: 'Partial', items: 7, lastSync: '1h ago', sensitivity: 'Internal', owner: 'Platform' },
      { id: 'kn-drive', projectId: corp, name: 'Drive research library', kind: 'Drive', status: 'Indexed', items: 286, lastSync: '40 min ago', sensitivity: 'Internal', owner: 'Research' },
      { id: 'kn-claims', projectId: claims, name: 'Claims playbooks', kind: 'SharePoint', status: 'Indexed', items: 64, lastSync: '2h ago', sensitivity: 'Restricted', owner: 'Ops' },
    ],
    services: [
      { id: 'svc-sf', projectId: claims, name: 'Salesforce', logo: 'salesforce.svg', status: 'Request per action', subtitle: 'Accounts, cases, approved records' },
      { id: 'svc-jira', projectId: eng, name: 'Jira', logo: 'jira.svg', status: 'Connected', subtitle: 'Read issues; create drafts' },
      { id: 'svc-gh', projectId: coding, name: 'GitHub Enterprise', logo: 'github.svg', status: 'Connected', subtitle: 'Selected repos and PRs' },
      { id: 'svc-slack', projectId: corp, name: 'Slack', logo: 'slack.svg', status: 'Connected', subtitle: 'Search channels; posting needs review' },
    ],
    capabilities: {
      [coding]: [
        { capability: 'GitHub access', value: 'Read / write', source: 'parent', sourceLabel: 'Inherited · Scarlet Sync' },
        { capability: 'Internal documentation', value: 'Search', source: 'parent', sourceLabel: 'Inherited · Scarlet Sync' },
        { capability: 'Approved models', value: 'US region only', source: 'org', sourceLabel: 'Inherited · Organization' },
        { capability: 'Cloud runtime budget', value: '$2 / run', source: 'override', sourceLabel: 'Overridden here' },
        { capability: 'Production database writes', value: 'Denied', source: 'denied', sourceLabel: 'Explicitly denied here' },
      ],
      [audit]: [
        { capability: 'GitHub access', value: 'Read / write', source: 'parent', sourceLabel: 'Inherited · Scarlet Sync' },
        { capability: 'Internal documentation', value: 'Search', source: 'parent', sourceLabel: 'Inherited · Scarlet Sync' },
        { capability: 'Approved models', value: 'US region only', source: 'org', sourceLabel: 'Inherited · Organization' },
        { capability: 'Production database writes', value: 'Denied', source: 'denied', sourceLabel: 'Explicitly denied here' },
      ],
      [claims]: [
        { capability: 'Salesforce read', value: 'Scoped', source: 'override', sourceLabel: 'Overridden here' },
        { capability: 'Salesforce write', value: 'Approve each', source: 'denied', sourceLabel: 'Human approval required' },
        { capability: 'Send email', value: 'Approve each', source: 'parent', sourceLabel: 'Inherited · Customer Operations' },
      ],
    },
    tasks: [
      { id: 'task-1', projectId: cust, name: 'Morning operations brief', type: 'scheduled', schedule: 'Weekdays · 8:00 AM', harness: 'Research', status: 'active' },
      { id: 'task-2', projectId: coding, name: 'Review new pull requests', type: 'scheduled', schedule: 'Every 2 hours', harness: 'Coding', status: 'active' },
      { id: 'task-3', projectId: corp, name: 'Refresh knowledge indexes', type: 'scheduled', schedule: 'Daily · 1:30 AM', harness: 'Background', status: 'active' },
      { id: 'task-4', projectId: router, name: 'Model spend anomaly check', type: 'scheduled', schedule: 'Mondays · 9:00 AM', harness: 'Research', status: 'paused' },
      { id: 'task-5', projectId: corp, name: 'Index engineering documentation', type: 'background', schedule: 'Started 14m ago', harness: 'Background worker', status: 'running', progress: 68 },
      { id: 'task-6', projectId: claims, name: 'Generate Q2 customer themes', type: 'background', schedule: 'Started 38m ago', harness: 'Research agent', status: 'running', progress: 43 },
      { id: 'task-7', projectId: coding, name: 'PR opened → review', type: 'monitor', schedule: 'GitHub webhook', harness: 'Coding', status: 'armed', trigger: 'GitHub webhook', action: 'Coding review + comment', approval: 'Auto (read-only)',
        timeline: [
          { time: '10:00', title: 'Triggered', detail: 'pull_request.opened', kind: 'info' },
          { time: '10:00', title: 'Loaded project context', detail: 'Coding Agent · 12 sources' },
          { time: '10:01', title: 'Permission inherited', detail: 'Scoped GitHub read', kind: 'info' },
          { time: '10:02', title: 'Provisioned ephemeral VM', detail: '8 vCPU · us-east-1' },
          { time: '10:04', title: 'Analyzed 183 files', detail: '2 findings' },
          { time: '10:08', title: 'Posted review comments', detail: 'Claude Sonnet' },
          { time: '10:09', title: 'Waiting for reviewer', detail: 'Merge needs human', kind: 'warn' },
        ],
      },
      { id: 'task-8', projectId: router, name: 'Spend > 80% budget', type: 'monitor', schedule: 'Budget threshold', harness: 'Ops', status: 'armed', trigger: 'Budget threshold', action: 'Notify + pause cloud tasks', approval: 'Auto' },
      { id: 'task-9', projectId: claims, name: 'New high-sev case', type: 'monitor', schedule: 'Salesforce record', harness: 'Claims', status: 'waiting', trigger: 'Salesforce record', action: 'Draft response for review', approval: 'Human required' },
    ],
    environments: [
      { id: 'env-local', name: 'Local desktop', subtitle: "Akash's MacBook Pro · on-device", kind: 'local', status: 'Idle', os: 'macOS 15 · arm64', cpu: '10 core · 32 GB', network: 'Full (user)', secrets: 'Keychain', packages: ['node 20', 'python 3.12', 'git 2.44', 'docker'], idleTimeout: '—', cost: '$0.00 · free', mounts: '~/repos/scarlet-sync' },
      { id: 'env-browser', name: 'Browser sandbox', subtitle: 'Isolated Chromium · cookies on-device', kind: 'browser', status: 'Running', os: 'Sandboxed Linux', cpu: '2 core · 4 GB', network: 'Allowlist only', secrets: 'None', packages: ['chromium 126', 'playwright'], idleTimeout: '10 min', cost: '$0.02 / min' },
      { id: 'env-cloud', name: 'Ephemeral cloud VM', subtitle: 'coding-agent-pr-1932 · us-east-1', kind: 'sandbox', status: 'Running', os: 'Ubuntu 22.04', cpu: '8 vCPU · 32 GB', network: 'GitHub + npm only', secrets: 'GITHUB_TOKEN', packages: ['ubuntu 22.04', 'node 20', 'pnpm', 'postgres-client'], idleTimeout: '44 min', cost: '$0.34 / hr · $2.10 today', mounts: 'scarlet-sync', region: 'us-east-1' },
      { id: 'env-persist', name: 'Persistent workspace', subtitle: 'research-workspace · retains state', kind: 'vm', status: 'Stopped', os: 'Ubuntu 22.04', cpu: '4 vCPU · 16 GB', network: 'Approved data APIs', secrets: 'Vault refs', packages: ['python 3.12', 'pandas', 'jupyter', 'duckdb'], idleTimeout: 'Never', cost: '$0.18 / hr when on' },
      { id: 'env-gpu', name: 'GPU machine', subtitle: 'A10G · on demand', kind: 'gpu', status: 'Stopped', os: 'Ubuntu 22.04', cpu: '8 vCPU · 32 GB · 1× A10G', network: 'Model registry only', secrets: 'Registry token', packages: ['cuda 12.4', 'pytorch', 'vllm'], idleTimeout: '5 min', cost: '$1.20 / hr', region: 'us-west-2' },
      { id: 'env-corp', name: 'Restricted corporate', subtitle: 'Handles regulated customer data', kind: 'restricted', status: 'Stopped', os: 'Hardened Linux', cpu: '4 vCPU · 16 GB', network: 'No egress', secrets: 'HSM', packages: ['hardened image', 'no egress'], idleTimeout: '15 min', cost: '$0.40 / hr', region: 'US only' },
    ],
    plugins: [
      { id: 'pl-gh', name: 'GitHub Enterprise', publisher: 'Platform Engineering', category: 'developer', description: 'Search repos, inspect PRs, create branches via approved runtimes.', logo: 'github.svg', installed: true, rating: '4.9 ★', projects: 18, type: 'connector' },
      { id: 'pl-slack', name: 'Slack', publisher: 'Slack', category: 'productivity', description: 'Search channels, summarize threads, post after confirmation.', logo: 'slack.svg', installed: true, rating: '4.8 ★', projects: 32, type: 'connector' },
      { id: 'pl-sf', name: 'Salesforce', publisher: 'Managed connector', category: 'sales', description: 'Scoped CRM data with field redaction and mutation previews.', logo: 'salesforce.svg', installed: false, rating: '4.7 ★', projects: 11, type: 'connector' },
      { id: 'pl-jira', name: 'Jira', publisher: 'Atlassian', category: 'developer', description: 'Find issues and update approved fields with audit trails.', logo: 'jira.svg', installed: true, rating: '4.8 ★', projects: 21, type: 'connector' },
      { id: 'pl-drive', name: 'Google Drive', publisher: 'Google', category: 'productivity', description: 'Search and create files in folders shared with a project.', logo: 'google-drive.svg', installed: false, rating: '4.6 ★', projects: 8, type: 'connector' },
      { id: 'pl-chrome', name: 'Chrome Runtime', publisher: 'Built in', category: 'developer', description: 'Use the user’s browser session with credentials on-device.', logo: 'chrome.svg', installed: true, rating: 'Built-in', projects: 99, type: 'runtime' },
      { id: 'pl-aws', name: 'AWS Runtime', publisher: 'Private cloud', category: 'data', description: 'Ephemeral VMs using approved images and budgets.', logo: 'aws.svg', installed: false, rating: '4.9 ★', projects: 6, type: 'runtime' },
      { id: 'pl-coding', name: 'Secure Coding Agent', publisher: 'Internal', category: 'harness', description: 'Repository-aware planning, generation, tests, and patches.', logo: '', installed: false, rating: 'Private', projects: 5, type: 'harness' },
      { id: 'pl-tmpl', name: 'Software repository template', publisher: 'OpenSaddle', category: 'template', description: 'Project template with coding agent, GitHub, and diff interface.', logo: '', installed: false, rating: '4.8 ★', projects: 14, type: 'template' },
    ],
    notifications: [
      { id: 'n1', title: 'Permission waiting', body: 'Claims Assistant needs Salesforce write approval.', at: now - 20 * 60_000, read: false, href: '/runs' },
      { id: 'n2', title: 'Budget alert 80%', body: 'Engineering project crossed 80% of monthly budget.', at: now - hour, read: false, href: '/usage' },
      { id: 'n3', title: 'Shared chat', body: 'Maya shared “Secure VM background feature” with you.', at: now - 2 * hour, read: true, href: '/chat/' + chatCoding },
      { id: 'n4', title: 'Monitor armed', body: 'PR opened → review is watching GitHub webhooks.', at: now - 5 * hour, read: true, href: '/runs' },
    ],
    usageDays: [
      { label: 'Jul 1', gpt: 46, claude: 36, gemini: 18 },
      { label: 'Jul 5', gpt: 40, claude: 45, gemini: 15 },
      { label: 'Jul 9', gpt: 55, claude: 28, gemini: 17 },
      { label: 'Jul 13', gpt: 38, claude: 47, gemini: 15 },
      { label: 'Jul 17', gpt: 48, claude: 35, gemini: 17 },
      { label: 'Jul 20', gpt: 44, claude: 40, gemini: 16 },
    ],
    budgets: [
      { id: 'b1', name: 'Workspace · monthly', used: 4982, limit: 7000 },
      { id: 'b2', name: 'Engineering project', used: 1820, limit: 2000 },
      { id: 'b3', name: 'Customer Operations', used: 640, limit: 2500 },
      { id: 'b4', name: 'Cloud runtime · daily', used: 12.84, limit: 60 },
    ],
    wikiSummaries: [
      {
        id: 'wiki-eng-team',
        projectId: eng,
        scope: 'team',
        headline: 'Engineering is focused on secure runtimes and PR throughput',
        overview: 'The team is converging on the secure VM background-work milestone while keeping review latency low. Jira delivery signals, GitHub pull requests, and Slack incident threads agree that the runtime approval path is the critical dependency this week.',
        highlights: [
          'Secure VM request flow is in review; 18 runtime tests are passing.',
          'PR review automation analyzed 183 files and raised two medium findings.',
          'Model Router cost controls are ready for a staged rollout.',
        ],
        blockers: [
          'Security sign-off is required for persistent workspace secrets.',
          'Two Jira issues are waiting on API ownership decisions.',
        ],
        sourceIds: ['svc-jira', 'svc-gh', 'svc-slack', 'kn-github'],
        updatedAt: now - 18 * 60_000,
      },
      {
        id: 'wiki-corp-team',
        projectId: corp,
        scope: 'team',
        headline: 'Corporate workflows are expanding governed self-service',
        overview: 'Operations and engineering are standardizing permission-aware agent workflows. The current emphasis is knowledge freshness, model routing policy, and making every protected write auditable.',
        highlights: [
          'SharePoint knowledge index covers 1,240 internal items.',
          'Morning operations brief is active for Customer Operations.',
          'US-region model policy is applied to regulated workflows.',
        ],
        blockers: ['SCIM provisioning remains in pilot.', 'Restricted-source indexing needs an owner review.'],
        sourceIds: ['svc-slack', 'kn-sharepoint', 'kn-drive'],
        updatedAt: now - 42 * 60_000,
      },
      {
        id: 'wiki-member-ad',
        projectId: eng,
        scope: 'member',
        memberId: 'user-ad',
        headline: 'Driving secure runtime delivery',
        overview: 'Akash is coordinating the secure VM background feature and the approval gateway changes needed to ship it safely.',
        highlights: ['Reviewed the VM provisioning diff.', 'Aligned runtime budget checks with the Model Router project.'],
        blockers: ['Needs final security approval for persistent secrets.'],
        sourceIds: ['svc-jira', 'svc-gh'],
        updatedAt: now - 22 * 60_000,
      },
      {
        id: 'wiki-member-maya',
        projectId: eng,
        scope: 'member',
        memberId: 'user-maya',
        headline: 'Improving workflow UX and documentation',
        overview: 'Maya is refining agent workflow states and documenting how teams should request protected actions.',
        highlights: ['Drafted the approval-state UX.', 'Updated the secure runtime onboarding guide.'],
        blockers: ['Waiting for API ownership guidance on two Jira issues.'],
        sourceIds: ['svc-jira', 'svc-slack', 'kn-github'],
        updatedAt: now - 31 * 60_000,
      },
      {
        id: 'wiki-member-jordan',
        projectId: eng,
        scope: 'member',
        memberId: 'user-jordan',
        headline: 'Reviewing automation quality and policy',
        overview: 'Jordan is validating coding-agent findings and checking that automated comments remain within read-only policy.',
        highlights: ['Reviewed PR #1932 findings.', 'Validated the GitHub webhook monitor timeline.'],
        blockers: [],
        sourceIds: ['svc-gh', 'svc-jira'],
        updatedAt: now - 35 * 60_000,
      },
    ],
    wikiSettings: {
      individualSummariesEnabled: false,
      selectedProjectId: eng,
      refreshCadence: 'daily',
    },
    folders: [
      { id: 'folder-eng-src', projectId: eng, name: 'src', path: 'src', description: 'Application source' },
      { id: 'folder-eng-ops', projectId: eng, name: 'ops', path: 'ops', description: 'Runbooks and infra' },
      { id: 'folder-coding', projectId: coding, name: 'runtime', path: 'src/runtime', description: 'Secure runtime package' },
    ],
    sources: [
      { id: 'src-gh-opensaddle', projectId: eng, kind: 'github', name: 'opensaddle', externalId: 'AkeBoss-tech/opensaddle', url: 'https://github.com/AkeBoss-tech/opensaddle', status: 'connected', branch: 'main', lastSyncAt: now - 40 * 60_000 },
      { id: 'src-gh-interface', projectId: coding, kind: 'github', name: 'opensaddle-interface', externalId: 'AkeBoss-tech/opensaddle-interface', url: 'https://github.com/AkeBoss-tech/opensaddle-interface', status: 'connected', branch: 'main', lastSyncAt: now - 12 * 60_000 },
      { id: 'src-jira-eng', projectId: eng, kind: 'jira', name: 'Engineering board', externalId: 'ENG', status: 'connected', lastSyncAt: now - 18 * 60_000 },
      { id: 'src-slack-eng', projectId: eng, kind: 'slack', name: '#engineering', externalId: 'C0ENG', status: 'connected', lastSyncAt: now - 8 * 60_000 },
    ],
    workflows: [
      {
        id: 'wf-pr-review', projectId: coding, name: 'PR opened → review', description: 'Coding agent reviews new pull requests and posts findings.',
        trigger: 'source_event', schedule: 'GitHub pull_request.opened', agentIds: ['agent-coder'],
        steps: [
          { id: 's1', label: 'Load repository context', kind: 'context' },
          { id: 's2', label: 'Run coding harness', kind: 'agent' },
          { id: 's3', label: 'Post review comments', kind: 'tool' },
        ],
        status: 'active', approvalRequired: false, createdAt: now - 10 * day, lastRunAt: now - 2 * hour,
      },
      {
        id: 'wf-morning-brief', projectId: cust, name: 'Morning operations brief', description: 'Research agent summarizes overnight ops signals.',
        trigger: 'cron', schedule: 'Weekdays · 8:00 AM', agentIds: ['agent-research'],
        steps: [
          { id: 's1', label: 'Pull Jira + Slack', kind: 'tool' },
          { id: 's2', label: 'Synthesize brief', kind: 'agent' },
          { id: 's3', label: 'Publish wiki summary', kind: 'write' },
        ],
        status: 'active', approvalRequired: false, createdAt: now - 20 * day, lastRunAt: now - day,
      },
      {
        id: 'wf-claims', projectId: claims, name: 'High-sev claim draft', description: 'Draft claim responses for human approval.',
        trigger: 'source_event', schedule: 'Salesforce high-sev case', agentIds: ['agent-claims'],
        steps: [
          { id: 's1', label: 'Read case', kind: 'tool' },
          { id: 's2', label: 'Draft response', kind: 'agent' },
          { id: 's3', label: 'Request approval', kind: 'approval' },
        ],
        status: 'paused', approvalRequired: true, createdAt: now - 14 * day,
      },
    ],
    workflowRuns: [
      { id: 'wfr-1', workflowId: 'wf-pr-review', projectId: coding, agentId: 'agent-coder', status: 'completed', startedAt: now - 2 * hour, finishedAt: now - 2 * hour + 9 * 60_000, summary: 'Reviewed PR #1932 · 2 findings' },
      { id: 'wfr-2', workflowId: 'wf-morning-brief', projectId: cust, agentId: 'agent-research', status: 'completed', startedAt: now - day, finishedAt: now - day + 4 * 60_000, summary: 'Published ops brief to wiki' },
      { id: 'wfr-3', workflowId: 'wf-claims', projectId: claims, agentId: 'agent-claims', status: 'waiting', startedAt: now - 45 * 60_000, summary: 'Waiting for human approval' },
    ],
    agentSessions: [
      { id: 'asess-1', agentId: 'agent-coder', projectId: coding, status: 'running', harness: 'Coding', model: 'Claude Opus', startedAt: now - 12 * 60_000, title: 'Secure VM background feature' },
      { id: 'asess-2', agentId: 'agent-research', projectId: corp, status: 'idle', harness: 'Research', model: 'GPT-5.6', startedAt: now - 3 * hour, title: 'Model gateway architecture' },
      { id: 'asess-3', agentId: 'agent-claims', projectId: claims, status: 'waiting', harness: 'Browser', model: 'Claude Sonnet', startedAt: now - 40 * 60_000, title: 'At-risk renewals draft' },
    ],
    permissionGrants: [
      { id: 'grant-ad-org', principalKind: 'user', principalId: 'user-ad', resourceKind: 'organization', resourceId: 'org-acme', action: 'administer', effect: 'allow', inheritance: 'direct', createdAt: now - 30 * day, createdBy: 'user-ad' },
      { id: 'grant-ad-eng', principalKind: 'user', principalId: 'user-ad', resourceKind: 'project', resourceId: eng, action: 'administer', effect: 'allow', inheritance: 'direct', createdAt: now - 20 * day, createdBy: 'user-ad' },
      { id: 'grant-maya-eng-write', principalKind: 'user', principalId: 'user-maya', resourceKind: 'project', resourceId: eng, action: 'write', effect: 'allow', inheritance: 'direct', createdAt: now - 18 * day, createdBy: 'user-ad' },
      { id: 'grant-maya-coding-write', principalKind: 'user', principalId: 'user-maya', resourceKind: 'project', resourceId: coding, action: 'write', effect: 'allow', inheritance: 'inherited', createdAt: now - 18 * day, createdBy: 'user-ad' },
      { id: 'grant-maya-coding-exec', principalKind: 'user', principalId: 'user-maya', resourceKind: 'project', resourceId: coding, action: 'execute', effect: 'allow', inheritance: 'direct', createdAt: now - 18 * day, createdBy: 'user-ad' },
      { id: 'grant-maya-corp-exec', principalKind: 'user', principalId: 'user-maya', resourceKind: 'project', resourceId: corp, action: 'execute', effect: 'allow', approvalRequired: true, inheritance: 'direct', createdAt: now - 18 * day, createdBy: 'user-ad' },
      { id: 'grant-jordan-eng-read', principalKind: 'user', principalId: 'user-jordan', resourceKind: 'project', resourceId: eng, action: 'read', effect: 'allow', inheritance: 'direct', createdAt: now - 18 * day, createdBy: 'user-ad' },
      { id: 'grant-jordan-coding-read', principalKind: 'user', principalId: 'user-jordan', resourceKind: 'project', resourceId: coding, action: 'read', effect: 'allow', inheritance: 'inherited', createdAt: now - 18 * day, createdBy: 'user-ad' },
      { id: 'grant-jordan-coding-exec', principalKind: 'user', principalId: 'user-jordan', resourceKind: 'project', resourceId: coding, action: 'execute', effect: 'allow', approvalRequired: true, inheritance: 'direct', createdAt: now - 15 * day, createdBy: 'user-ad' },
      { id: 'grant-priya-corp-read', principalKind: 'user', principalId: 'user-priya', resourceKind: 'project', resourceId: corp, action: 'read', effect: 'allow', inheritance: 'direct', createdAt: now - 12 * day, createdBy: 'user-ad' },
      { id: 'grant-priya-claims-deny', principalKind: 'user', principalId: 'user-priya', resourceKind: 'project', resourceId: claims, action: 'read', effect: 'deny', inheritance: 'override', createdAt: now - 12 * day, createdBy: 'user-sec' },
      { id: 'grant-coder-repo', principalKind: 'agent', principalId: 'agent-coder', resourceKind: 'repository', resourceId: 'src-gh-interface', action: 'write', effect: 'allow', inheritance: 'direct', approvalRequired: true, createdAt: now - 10 * day, createdBy: 'user-ad' },
      { id: 'grant-coder-exec', principalKind: 'agent', principalId: 'agent-coder', resourceKind: 'project', resourceId: coding, action: 'execute', effect: 'allow', inheritance: 'direct', createdAt: now - 10 * day, createdBy: 'user-ad' },
      { id: 'grant-ad-coding-exec', principalKind: 'user', principalId: 'user-ad', resourceKind: 'project', resourceId: coding, action: 'execute', effect: 'allow', inheritance: 'inherited', createdAt: now - 10 * day, createdBy: 'user-ad' },
      // agents may execute inside their own project scope (users inherit via org administer)
      { id: 'grant-research-exec', principalKind: 'agent', principalId: 'agent-research', resourceKind: 'project', resourceId: corp, action: 'execute', effect: 'allow', inheritance: 'direct', createdAt: now - 8 * day, createdBy: 'user-ad' },
      { id: 'grant-claims-exec', principalKind: 'agent', principalId: 'agent-claims', resourceKind: 'project', resourceId: claims, action: 'execute', effect: 'allow', inheritance: 'direct', approvalRequired: true, createdAt: now - 6 * day, createdBy: 'user-ad' },
      { id: 'grant-cold-exec', principalKind: 'agent', principalId: 'agent-cold', resourceKind: 'project', resourceId: cold, action: 'execute', effect: 'allow', inheritance: 'direct', approvalRequired: true, createdAt: now - 6 * day, createdBy: 'user-ad' },
      { id: 'grant-router-exec', principalKind: 'agent', principalId: 'agent-router', resourceKind: 'project', resourceId: router, action: 'execute', effect: 'allow', inheritance: 'direct', createdAt: now - 7 * day, createdBy: 'user-ad' },
      { id: 'grant-audit-exec', principalKind: 'agent', principalId: 'agent-audit', resourceKind: 'project', resourceId: audit, action: 'execute', effect: 'allow', inheritance: 'direct', createdAt: now - 5 * day, createdBy: 'user-ad' },
      { id: 'grant-claims-sf-deny', principalKind: 'agent', principalId: 'agent-claims', resourceKind: 'tool', resourceId: 'salesforce', action: 'write', effect: 'deny', inheritance: 'override', createdAt: now - 6 * day, createdBy: 'user-ad' },
      { id: 'grant-claims-sf-read', principalKind: 'agent', principalId: 'agent-claims', resourceKind: 'tool', resourceId: 'salesforce', action: 'read', effect: 'allow', approvalRequired: true, inheritance: 'direct', createdAt: now - 6 * day, createdBy: 'user-ad' },
      { id: 'grant-ad-github', principalKind: 'user', principalId: 'user-ad', resourceKind: 'tool', resourceId: 'github', action: 'write', effect: 'allow', approvalRequired: true, createdAt: now - 5 * day, createdBy: 'user-ad' },
      { id: 'grant-coder-github', principalKind: 'agent', principalId: 'agent-coder', resourceKind: 'tool', resourceId: 'github', action: 'write', effect: 'allow', approvalRequired: true, createdAt: now - 5 * day, createdBy: 'user-ad' },
      { id: 'grant-ad-github-read', principalKind: 'user', principalId: 'user-ad', resourceKind: 'tool', resourceId: 'github', action: 'read', effect: 'allow', createdAt: now - 5 * day, createdBy: 'user-ad' },
      { id: 'grant-coder-github-read', principalKind: 'agent', principalId: 'agent-coder', resourceKind: 'tool', resourceId: 'github', action: 'read', effect: 'allow', createdAt: now - 5 * day, createdBy: 'user-ad' },
      { id: 'grant-folder-deny', principalKind: 'agent', principalId: 'agent-coder', resourceKind: 'folder', resourceId: 'folder-eng-ops', action: 'write', effect: 'deny', pathPrefix: 'ops/secrets', createdAt: now - 4 * day, createdBy: 'user-sec' },
    ],
    settings: {
      theme: 'dark',
      displayName: 'Akash Dubey',
      email: 'akash@acme.com',
      timezone: 'America/New_York',
      routingPref: 'quality',
      askAboveCost: 0.5,
      enterpriseModelsOnly: false,
      keepDataLocal: false,
      notifications: { email: true, desktop: true, budgetAlerts: true, permissionRequests: true, runFailures: true },
      retentionDays: 365,
      toolRetentionDays: 90,
      region: 'United States',
      trainingDisabled: true,
      approvedModels: ['sonnet', 'claude', 'gpt', 'llama'],
      ssoEnabled: true,
      scimEnabled: false,
      piiRestricted: true,
      networkPolicy: 'Deny egress for restricted environments; allowlist for sandboxes',
      demoMode: true,
    },
    // Populated from actual usage — opening or creating a chat adds it here.
    recentChatIds: [],
    activeProjectId: corp,
    activeChatId: chatNew,
  }
}
