# OpenSaddle thread-first interface redesign

## Decision

OpenSaddle should adopt the interaction model of Codex and Claude Code without copying their branding or reducing OpenSaddle's capabilities.

The primary product object becomes a durable **thread representing one outcome**. A thread contains the conversation, plan, agent runs, runtime/session, approvals, changed files, checks, artifacts, cost, and follow-up work. Projects provide shared context; Work is the cross-project attention inbox; technical and administrative detail moves into contextual inspectors or Admin.

The target shell is:

```text
┌────────────────┬────────────────────────────────┬──────────────────┐
│ Navigation     │ Thread                          │ Inspector        │
│ New task       │ Conversation                    │ optional         │
│ Search         │ Plan and current activity       │ Changes          │
│ Work           │ Evidence and results            │ Checks           │
│ Projects       │ Composer                        │ Activity         │
│ Recent threads │                                  │ Environment      │
└────────────────┴────────────────────────────────┴──────────────────┘
```

The inspector is closed by default and opens when the user requests detail or when work needs attention.

## Options considered

1. **Visual reskin only**
   - Lowest initial cost.
   - Rejected because the current overload comes from information architecture and overlapping domain objects, not colors or spacing.

2. **Navigation consolidation only**
   - Reduces the sidebar and groups existing pages beneath Work, Projects, and Admin.
   - Better than a reskin, but leaves chat, task, run, session, workflow run, and environment as disconnected concepts.

3. **Thread-first staged migration**
   - Introduces a canonical presentation model, centralizes run lifecycles, builds one complete thread flow, and then consolidates secondary pages.
   - Recommended because it changes the mental model while preserving existing services and shipping in reversible slices.

4. **Full rewrite**
   - Could produce a cleaner codebase.
   - Rejected because the existing interface already implements valuable routing, permissions, runtimes, diffs, sites, workflows, and persistence behavior. A rewrite would discard working product knowledge and multiply regression risk.

## Product invariants

The redesign is not complete unless all of these remain available:

- Nested projects, context inheritance, members, and project routing defaults
- Reusable agents and agent configuration
- Chat creation, rename, archive, delete, fork, sharing, and resume
- Auto/manual provider, model, harness, and runtime selection
- Local, browser, sandbox, VM/cloud, Electron, and KRAIL execution paths
- Permission preflight, scoped approval, deny rules, and auditability
- Streaming run activity, plans, tool calls, verification, and failures
- File-level and hunk-level diff review
- Artifacts, sites, dashboards, APIs, custom interfaces, and wiki content
- Scheduled/background work, workflow definitions and runs, and secure VM handoff
- Session import/adoption
- Plugins/connections and contextual capability discovery
- Usage, budget, route explanation, cost, environment, and diagnostics
- Local storage and remote workspace persistence

These features may move, collapse, or become contextual. They must not disappear.

## Interaction model

### Primary surfaces

1. **Thread**
   - The default work surface.
   - Conversation, plan, current action, compact run summary, approvals, evidence, composer.
   - Optional Changes, Checks, Activity, Environment, Access, and Terminal panels.

2. **Work**
   - Cross-project operational inbox.
   - Needs attention, Running, Scheduled, Completed.
   - Absorbs runs, approvals, background jobs, workflow executions, and resumable sessions.

3. **Projects**
   - Project list and project-scoped overview.
   - Recent work, context, members, chats, knowledge, automations, apps, and settings.
   - The navigation tree contains projects only; it does not mix projects, agents, sites, and wikis.

4. **Admin**
   - People, permissions, tools, models, runtimes, usage, audit, storage, and developer settings.
   - Reached from the account/workspace menu rather than permanent primary navigation.

### Thread state model

```text
draft
  → planning
  → ready_to_run
  → running
  → needs_input | needs_approval | blocked
  → running
  → reviewing
  → completed | failed | stopped
```

Plan, activity, and evidence are separate:

- **Plan:** intended steps and their state
- **Activity:** what is happening now
- **Evidence:** files, checks, artifacts, links, cost, and audit outcomes

### Composer

Default controls:

- Project/context
- Attach or `@` mention
- Permission mode: Plan, Ask, Edit, Auto
- Execution target: Auto, Local, Worktree, Browser, Cloud
- Send/Stop

Advanced controls such as provider, model, harness, tool set, route explanation, and estimated cost live in a popover.

While a run is active:

- **Steer** changes the current run.
- **Queue** adds an editable follow-up above the composer.
- Stop remains visible.

### Activity density

Support three transcript levels:

- **Summary:** final responses and evidence only
- **Normal:** collapsed tool/action summaries
- **Verbose:** commands, tool I/O, logs, and intermediate events

Normal is the default. Approval requests, failures, and user questions are never hidden by density.

### Review

Conversation explains intent and progress. A dedicated Changes panel owns exact code acceptance:

- Last turn, unstaged, staged, commit, and branch scopes when Git is available
- File and hunk navigation
- Accept/reject or stage/unstage/revert according to the underlying runtime
- Inline comments that return to the same thread as follow-up context
- Checks and PR/publish actions adjacent to the diff, not buried in activity logs

## Additional researched UI elements

Official Codex documentation supports project-scoped outcome threads, Local/Worktree/Cloud execution, worktree isolation for parallel chats, composer permission controls, plan mode, steer-versus-queue follow-ups, review panels, integrated terminals, and expandable subagent threads. Official Claude Code documentation supports resumable/branchable sessions, visible permission modes, editable plans with explicit execution exits, transcript density controls, background Tasks, line-level diff feedback, checkpoints/rewind, and context-aware attachments.

The following are strong OpenSaddle adaptations:

- A compact `Local · main · 3 changes · $0.12` status row
- Status priority: Needs input, Blocked, Ready, Running
- A `3 files · +82 −19` change summary that opens review
- Permission cards naming requester, exact action, data boundary, risk, and scope
- A plan artifact with Keep planning, Review each edit, Edit automatically, and Auto exits
- Background task rows with owner, status, duration, Open output, and Stop
- Subagent rows nested beneath the parent run, with an inspectable child thread
- Per-thread panel restoration for Changes, Terminal, Browser, Plan, and Activity
- Resume previews showing title, project, branch/environment, recency, and a return recap
- Checkpoint/rewind and branch-from-here after the core migration is stable
- Command palette actions for rare destinations and advanced configuration

Exact colors, pane sizes, animation, and a mandatory plan approval gate are OpenSaddle design decisions, not documented Codex/Claude requirements.

## Multi-agent implementation plan

One integration lead owns the migration sequence and existing shared entry points. Subagents work in isolated branches/worktrees and return bounded commits. They should not simultaneously edit `src/App.tsx`, `src/data/store.tsx`, `src/types/index.ts`, `src/pages/ChatPage.tsx`, or `src/styles/app.css`.

### Agent A — Domain and migration contracts

**Mission:** Create a thread-centered presentation/domain layer without immediately rewriting persisted data.

**Owns:**

- `src/features/thread/domain/**`
- `src/data/migrations/**`
- Domain and migration tests

**Deliverables:**

- `ThreadSummary`, `ThreadDetail`, `RunRecord`, `RunPresentation`, `AttentionItem`, and event types
- Selectors/adapters over current `Chat`, `Message`, `AgentRunBlock`, `Task`, `WorkflowRun`, and `AgentSession`
- Stable IDs linking run → thread → turn/message
- Explicit persisted-data migration instead of reset-on-version-mismatch
- Compatibility notes for frontend and control-plane event unions

**Gate:** Existing seed/local/remote data loads without loss, and old chat/run data renders through the new selectors.

### Agent B — Run lifecycle controller

**Mission:** Extract execution from the page and make runs survive navigation.

**Owns:**

- `src/features/runs/**`
- Runtime event reducer/registry tests
- Narrow adapters around existing runtime clients

**Deliverables:**

- Central registry keyed by thread and run ID
- Routing, permission preflight, start, subscribe, stop, reconnect, and event folding
- Multiple simultaneous runs without a single page-local subscription
- Derived plan/activity/evidence states
- Recovery for refreshed or resumed threads
- Compatibility with simulation, control plane, Codex, Claude, browser, and VM paths

**Depends on:** Agent A contracts.

**Gate:** Start two runs, navigate between threads, and observe both reach correct durable states.

### Agent C — Design system and interaction primitives

**Mission:** Build the quiet desktop visual language independently of page migration.

**Owns:**

- `src/ui/**`
- `src/styles/tokens.css`
- `src/styles/primitives.css`
- Story/demo states and accessibility tests

**Deliverables:**

- Tokens for surfaces, typography, spacing, radius, semantic state, motion, and focus
- Button, IconButton, Menu, Select, Tabs, Status, Tooltip, Dialog, Drawer, EmptyState, SplitPane, and VirtualList primitives
- Custom form controls replacing native-looking controls
- Dark, light, high-contrast, reduced-motion, keyboard, and screen-reader behavior

**Gate:** Components cover idle, hover, focus, disabled, loading, success, warning, failure, and approval states at WCAG AA contrast.

### Agent D — Shell and navigation

**Mission:** Replace the architecture-first shell with work-first navigation while retaining route reachability.

**Owns:**

- `src/features/shell/**`
- `src/features/search/**`
- Shell navigation tests

**Deliverables:**

- New task, Search, Work, Projects, Recent
- Project-only hierarchy
- Thread status/attention indicators
- Account menu leading to Admin
- Command palette access to all demoted legacy capabilities
- Responsive collapsed rail and Electron-compatible browser/panel hooks

**Depends on:** Agent A selectors and Agent C primitives.

**Gate:** Every current route remains reachable by visible context, command palette, or Admin; published sites still bypass the workspace shell.

### Agent E — Thread workspace

**Mission:** Build the complete prompt-to-result vertical slice.

**Owns:**

- `src/features/thread/components/**`
- `src/features/composer/**`
- `src/features/review/**`
- Thread interaction tests

**Deliverables:**

- Thread header, transcript, composer, plan, run card, approval card, evidence summary
- Summary/Normal/Verbose density
- Steer/Queue/Stop semantics
- Inspector tabs: Overview, Changes, Checks, Activity, Environment, Access
- Diff and artifact review using current accept/reject/save behavior
- Attachments, routing/permission mode, execution target, and route-details popovers
- All idle, planning, running, approval, blocked, failed, stopped, and completed states

**Depends on:** Agents A, B, and C.

**Gate:** A user can prompt, review a plan, run, approve access, inspect changes, see checks, and request a revision without leaving the thread.

### Agent F — Work, Project, and Admin consolidation

**Mission:** Build the three supporting information-architecture surfaces.

**Owns:**

- `src/features/work/**`
- `src/features/projects/**`
- `src/features/admin/**`

**Deliverables:**

- Work inbox combining approvals, active runs, scheduled work, workflow runs, failures, and completed outcomes
- Project overview with recent threads, context, members, knowledge, automations, apps, and settings
- Admin sections for access, tools, models, runtimes, usage, storage, developer settings, and audit
- Attention-first sorting and contextual deep links into threads

**Depends on:** Agents A, C, and D.

**Gate:** Existing runs/tasks/workflows/approvals appear once in Work, with no duplicate or contradictory status.

### Agent G — Specialized capability migration

**Mission:** Preserve specialized surfaces while removing them from primary navigation.

**Owns:**

- Contextual wrappers for Wiki, Agents, Workflows, Files, Sessions, Environments, Plugins, Usage, Sites, Dashboards, APIs, and Interfaces
- Feature-level migration tests

**Deliverables:**

- Files in Project context, Changes in Thread context
- Runtime/environment controls inside Thread or Admin
- Session import as a New task/Resume flow
- Plugins surfaced contextually when a task requires a capability, with catalog in Admin
- Compact scan-first agent/workflow/site lists and focused detail views
- Provenance/source inspectors for wiki and dashboards
- Existing published-site and Electron native-browser behavior preserved

**Depends on:** Agents C, D, E, and F.

**Gate:** The capability matrix shows no functional loss, and no infrastructure test page remains a normal primary destination.

### Agent H — Verification and release confidence

**Mission:** Prove behavioral parity and interaction quality continuously.

**Owns:**

- Frontend unit/integration tests
- End-to-end user journeys
- Accessibility and visual regression suites
- Migration and route-reachability audits

**Deliverables:**

- Tests for thread CRUD/fork/share, routing, approvals, event reduction, background navigation, diff actions, persistence migration, and Electron/browser modes
- Visual snapshots for every thread state and core surface
- Keyboard-only and screen-reader passes
- Performance checks for long transcripts, large diffs, and concurrent runs
- Final capability-preservation report

**Starts with:** Agent A; continues through every wave.

**Gate:** All required journeys pass in browser and packaged Electron modes, with no unexpected console errors or inaccessible critical actions.

## Execution waves

### Wave 0 — Baseline and contracts

Integration lead:

- Freeze a capability-preservation matrix from current routes and screenshots.
- Record browser and Electron golden journeys.
- Define ADRs for thread identity, run identity, attention state, permission mode, and persistence migration.
- Establish branch/worktree and shared-file ownership rules.

### Wave 1 — Foundations in parallel

- Agent A: domain adapters and migration tests
- Agent C: tokens and primitives
- Agent H: baseline tests and visual fixtures

No user-facing route replacement yet.

### Wave 2 — Execution backbone and shell

- Agent B: centralized run lifecycle
- Agent D: shell/navigation built against selectors and fixtures
- Agent H: run survival and route-reachability tests

Integration lead wires shared entry points only after both packages pass their gates.

### Wave 3 — One complete thread

- Agent E implements the thread vertical slice.
- Integration lead mounts it behind a feature flag and keeps the current thread as fallback.
- Agent H tests the full prompt → plan → run → approval → changes → checks → revision flow.

Do not redesign secondary pages until this flow feels complete.

### Wave 4 — Work, Projects, and Admin

- Agent F implements the supporting surfaces.
- Agent D removes obsolete primary navigation only after deep links and command-palette coverage exist.
- Agent H verifies attention sorting and object-to-thread links.

### Wave 5 — Specialized surfaces

- Agent G migrates one capability family at a time.
- Existing routes remain as redirects or compatibility views until their replacement passes the preservation gate.
- Agent H updates the capability matrix after each family.

### Wave 6 — Removal and hardening

- Remove the old ChatPage orchestration only after the new run controller has parity.
- Remove unused global CSS only after visual regression passes.
- Complete performance, accessibility, persistence, Electron, and remote-control-plane verification.
- Ship through a feature flag with a reversible data migration.

## Integration rules

- The integration lead alone edits shared route wiring, root store composition, global type exports, and legacy removal.
- Subagents add new modules; they do not refactor unrelated legacy files while building their slice.
- Every handoff includes code, tests, screenshots for visible states, migration notes, and known gaps.
- Read-heavy research and test work may run in parallel. Write-heavy work touching the same contract or surface must be serialized.
- No old route is removed until replacement reachability and preservation tests pass.
- No persisted schema change lands without forward migration and rollback behavior.
- Avoid broad rewrites of `src/styles/app.css`; layer the new system and retire selectors incrementally.

## Acceptance criteria

### Core journey

A user can:

1. Start a task from any project.
2. See or edit a short plan.
3. Select an understandable permission mode and execution target.
4. Watch compact progress while work continues across navigation.
5. Steer, queue a follow-up, stop, or resume.
6. Approve an exceptional action with a narrow scope.
7. Review files, checks, artifacts, cost, and route details.
8. Comment on or reject a change and continue in the same thread.
9. Publish/open the final artifact or PR.

No other page is required for this journey.

### Information hierarchy

- Primary navigation contains New task, Search, Work, Projects, and Recent.
- The default thread does not show provider, model, harness, storage, database, raw IDs, or event logs.
- Action-required items visually outrank status; status outranks metadata.
- Lists show at most the fields needed to choose; details explain the object after selection.

### Quality

- Browser and Electron behavior are equivalent where capabilities overlap.
- Active runs survive route changes and refresh/reconnect when supported.
- Existing data migrates without silent reset.
- Long transcripts and diffs remain responsive.
- Critical flows are keyboard accessible, screen-reader labeled, and WCAG AA.
- Reduced-motion mode removes nonessential animation.
- Every preserved capability is reachable and covered by the final audit.

## Main remaining risks

1. The frontend and control-plane run-event contracts are not identical.
2. Run state is currently embedded in assistant messages and page-local subscriptions.
3. Persisted data currently resets on version mismatch rather than migrating.
4. The sidebar encodes a hidden rule that leaf projects are agents.
5. The monolithic store clones and saves the full workspace on every update.
6. The global stylesheet and inline styles make visual changes leak across pages.
7. The current working tree already contains broad uncommitted changes, so redesign work must begin from a named baseline and isolated worktrees.

## If nothing changes

OpenSaddle will continue to look increasingly polished while still asking users to understand its internal platform architecture. Every new runtime, agent type, or artifact will add another visible concept, and the sidebar, store, and ChatPage will become harder to evolve safely.

## Primary research

- [OpenAI Codex projects](https://learn.chatgpt.com/docs/projects)
- [OpenAI Codex environment modes](https://learn.chatgpt.com/docs/environments/modes)
- [OpenAI Codex Git worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [OpenAI Codex code review](https://learn.chatgpt.com/docs/code-review?surface=app)
- [OpenAI Codex approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)
- [OpenAI Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [OpenAI Codex prompting and queued follow-ups](https://learn.chatgpt.com/docs/prompting)
- [OpenAI Codex long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [OpenAI Codex plan-mode best practices](https://learn.chatgpt.com/guides/best-practices)
- [Anthropic Claude Code sessions](https://code.claude.com/docs/en/sessions)
- [Anthropic Claude Code desktop](https://code.claude.com/docs/en/desktop)
- [Anthropic Claude Code permission modes](https://code.claude.com/docs/en/permission-modes)
- [Anthropic Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode)
- [Anthropic Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing)
