# OpenSaddle interface capability baseline

## Purpose and scope

This document freezes the pre-redesign interface contract for Agent H and the integration lead described in [`INTERFACE_REDESIGN_PLAN.md`](./INTERFACE_REDESIGN_PLAN.md). It records what is currently routed, what a user can actually do, which behavior is simulated or shell-specific, and what must be reverified as the thread-first interface replaces legacy surfaces.

Baseline date: **2026-07-26**

Evidence inspected:

- Route wiring in `src/App.tsx`
- Navigation in `src/components/layout/Sidebar.tsx`, `Topbar.tsx`, and `CommandPalette.tsx`
- All files in `src/pages/`
- Store, persistence, permissions, runtime capability, and Electron bridge code
- The 27 checked-in images in `screenshots/`
- The 21-route audit set in `out/screenshots/claude-ui-audit/`

This is a read-mostly code and artifact audit. The existing screenshots were inspected as the visual baseline; this pass did not recapture them or execute browser automation. The existing screenshot audit states that its 21 routes were captured on 2026-07-23 with zero console errors.

### Capability labels

- **Durable:** mutates the local workspace and, when a compatible remote workspace is connected, participates in workspace persistence.
- **Runtime-backed:** calls a browser, desktop, KRAIL, or control-plane service; availability depends on runtime and sidecars.
- **Session-only:** updates component state only.
- **Simulated:** demonstrates the interaction with seeded data or a toast, but does not complete the advertised external operation.
- **Read-only:** displays current or seeded state without a mutation path.
- **Store-only:** a data operation exists but has no current user-facing control.

These labels are part of the baseline. A redesign must not accidentally turn durable behavior into a simulation, and it must not claim parity by preserving only a nonfunctional control.

## Current shell and routing contract

- Web uses `BrowserRouter` with basename `/opensaddle-interface`.
- A packaged `file://` renderer uses `HashRouter`; deep links must remain reloadable in Electron.
- `/` redirects to `/start`. Unknown workspace routes redirect through `/` to `/start`.
- `/published/:slug` bypasses the sidebar, demo banner, top bar, command palette, toasts, and native browser pane.
- The normal workspace shell contains the sidebar, demo banner, browser-style top bar, current page, toast stack, command palette, project-create modal, and an optional Electron native-browser split pane.
- `Cmd/Ctrl+N` creates a chat in the active project. Search/command palette is exposed by the shell and sidebar with `Cmd/Ctrl+K` copy.
- Sidebar collapsed state, project-tree collapsed state, and legacy pin migration use local storage.
- Current primary sidebar items are New chat, Search, Runs, Agents, Sites, More workspace tools, Pinned, Projects, and Recent.
- The project tree currently mixes projects, wikis, and sites. A project with no child projects is treated as an agent: clicking it opens or creates an agent chat; its settings gear opens the project page.
- The command palette is the complete fallback for legacy destinations. It exposes Start, chat creation, Runs, Wiki, Agents, Workflows, Sites, Harness, Sessions, Browser runtime, Files, Permissions, Environments, Plugins, Usage, Settings, Admin, up to eight projects, project creation, theme cycling, and demo reset.
- Admin is route-gated by the current member role. A non-admin requesting `/admin` is redirected to `/settings`.

## Route-to-capability matrix

| Route | Current surface and reachability | Current capabilities | Behavior class and parity notes |
|---|---|---|---|
| `/start` | Start here; palette and unknown-route fallback | Create project plus chat, create quick chat, create an agent for the active project, open Runs or Settings | Project/chat/agent creation is durable |
| `/chat` | Palette/deep link; resolves to active chat or creates one | Redirect to a concrete chat | Durable chat selection |
| `/chat/:chatId` | New chat, Recent, project/agent/site/dashboard/interface links | Create messages; auto/manual provider, model, harness, and runtime routing; server estimate; attach files; choose tool toggles; simulated or live run; permission prompt; activity inspector; fork, rename, delete, share visibility; accept/reject diff hunks; save reports; simulated PR creation | Core mixed surface. Messages, fork, rename, delete, visibility, attachments, and hunk status are durable. Runtime is runtime-backed with mock fallback. Tools selection is session-only. PR creation is simulated. Archive exists store-only. Active live subscription is page-local and is removed on unmount |
| `/project/:projectId` | Project tree/settings gear, palette project results | Project-scoped chat composer; chat and nested-project lists; workflow clues; create/open agents, quick APIs, dashboards, interfaces; site creation/generation; knowledge/services; routing defaults; access summary | Mostly durable. Share and attach controls are simulated. Generated-site model call may be runtime-backed, with workspace site/version creation durable |
| `/runs` | Primary sidebar and palette | Inspect scheduled/background/monitor/cloud tasks; pause/resume seeded schedules; pause background item; simulated retry; inspect monitor timeline; cloud runtime summary; open create-task modal | Status changes are durable. Task creation, monitor pause/retry, and background retry are simulated |
| `/wiki` | More workspace tools, project-tree wiki, palette | Select project/perspective/tabs; refresh summaries; toggle individual summaries; inspect cited sources; create team-agent chat | Wiki settings and refresh timestamps/content are durable; article opening is simulated; summary content is primarily read-only seeded state |
| `/agents` | Primary sidebar and palette | Search/filter shared agents; inspect permission-aware cards; open chat/detail; run test | Chat creation is durable; test is runtime-backed |
| `/agents/:projectId` | Project-scoped deep link | Same library filtered to a project subtree | Same as `/agents` |
| `/agent/:agentId` | Agent library, project library, site settings | Inspect prompt, sessions, recent chats, workflows/sites, configuration, knowledge, effective access; open chat; test run | Read-only detail plus durable chat creation and runtime-backed test |
| `/workflows` | More workspace tools and palette | Create workflow; pause/activate; run now; inspect definitions and work clues | Definition/status/run records are durable; runtime execution is represented by store workflow-run behavior |
| `/workflows/:projectId` | Project workflow clues and agent detail | Same workflow actions scoped to a project | Same as `/workflows` |
| `/sessions` | Palette only | Enter Codex/Claude/other session reference and path; select source-managed/OpenSaddle-managed/hybrid authority; prepare continuation | Session-only UI plus toast. It intentionally does not import a transcript; no binding is added to workspace data |
| `/harness` | More workspace tools and palette | Choose repo path and CLI preset; desktop repository picker; estimate/start a run; stream events; show verification and diff | Runtime-backed. Safe/local or control-plane behavior depends on services. Subscriptions and polling are page-local but now cleaned up on unmount |
| `/browser-runtime` | Palette only | In Electron, open native browser; invoke Worker, file read/write, and HTTPS fetch; inspect structured invocation trace | Runtime-backed. Native-browser action is desktop-only; invocation availability is capability- and permission-gated |
| `/files` | More workspace tools and palette | Browse OPFS tree; import, create, edit, save files; run Worker JS against virtual FS | Runtime-backed and persistent in OPFS where supported; permission-gated. Page renders an unavailable state if file storage is unavailable |
| `/permissions` | More workspace tools and palette | Select project; inspect grants/effective access; create allow/deny grant with optional approval and path scope; revoke grant; inspect folders/sources; connect GitHub | Grants are durable and remote-aware. GitHub source attachment is durable after a mock OAuth/connect flow |
| `/permissions/:projectId` | Chat options/project context | Same permission management scoped to a project | Same as `/permissions` |
| `/environments` | More workspace tools and palette | Inspect environments; start/stop seeded environments; create KRAIL browser or PTY session; request a secure VM/background task; open Runs | Environment status and secure-VM/task records are durable; KRAIL is runtime-backed; cloud provisioning is represented in workspace state rather than verified infrastructure |
| `/plugins` | More workspace tools and palette | Search/filter catalog; install plugin; open configuration sheet | Install flag is durable. Credential, scope, allowed-project, and permission form values are not persisted; save is simulated |
| `/usage` | Workspace menu and palette | Inspect seeded spend, budgets, breakdown, and routing outcomes; export workspace JSON | Read-only seeded analytics; export is functional browser download |
| `/settings` | Workspace/account menu and palette | Connect remote control plane; explicitly initialize remote workspace; return to demo; edit profile, theme, routing, notification, retention, region, and training settings; export/reset workspace | Settings and local cache are durable; remote save is runtime-backed. Reset is destructive and confirmed |
| `/admin` | Workspace/account menu and palette; admin role required | Inspect members; toggle SSO, SCIM, PII restrictions, approved models; edit network policy; invite/export audit | Settings toggles are durable. Invite and audit export are simulated |
| `/sites` | Primary sidebar and palette | List sites and versions; create a site for a project | Durable |
| `/site/:siteId` | Sites list, project tree/library, agent detail | Preview draft/version; configure details and embedded agent; edit slug/accent/pages/cards; create version; publish/restore; share/open public preview; use embedded chat; continue in full chat | Site, draft, versions, publish, rollback, configuration, and full-chat creation are durable. Share copies the URL. Embedded mini-chat is session-only |
| `/published/:slug` | Public URL, no workspace shell | Load published snapshot locally or from control plane; navigate published pages | Read-only public rendering; must remain isolated from workspace chrome and must never expose drafts |
| `/api/:apiId` | Project library | GET, POST, DELETE, run transform; inspect records and history | Workspace mutation is durable; operations are local quick-API simulations, not a deployed HTTP endpoint |
| `/dashboard/:dashboardId` | Project library | Inspect KPI/chart/table widgets; click a widget to create a scoped chat | Read-only visualization plus durable chat creation |
| `/interface/:interfaceId` | Project library | Render configured form/document/chat layout; open full agent chat; submit form or side-chat | Full-chat creation is durable. Form submission and embedded side-chat are simulated |
| `*` | Any unknown route | Redirect to `/`, then `/start` | Route safety invariant |
| Shell-only native browser pane | Top bar globe and `/browser-runtime`, Electron only | Open URL in `WebContentsView`; resize, collapse/restore, close; back/forward/reload; zoom; find; print; screenshot; clear browser data | Runtime-backed through the Electron preload/IPC bridge; it is not a routed page |

## Cross-cutting capability contract

### Projects and context

- Projects can be nested and retain lineage, context, routing defaults, agents, workflows, sites, APIs, dashboards, interfaces, knowledge, services, grants, folders, and sources.
- Active project and active chat remain synchronized when entering a concrete chat or project.
- Recent chats omit archived chats; up to eight are shown.
- Pinned projects, wikis, and sites remain navigable even if their primary placement changes.
- Current leaf-project-as-agent behavior is a legacy navigation rule, not a domain invariant. The redesign may remove the rule only after explicit agent and project routes remain reachable.

### Chat/thread lifecycle

- Creation, message append/update, rename, delete, fork, visibility, and recent-chat tracking must retain stable IDs and timestamps.
- Fork currently clones the chat and its messages. This is the minimum semantic baseline for branch-from-current-history.
- Archive is represented in the store and filtering but has no current UI control. It must not be lost during migration even though it is not a golden UI action yet.
- Delete currently removes the chat and its messages and then navigates home.
- Visibility supports private, shared, and project, with a shared-user list.
- Attachments are imported into workspace Files and added to the composer context.

### Routing and execution

- Automatic and explicit provider/model/harness/runtime choices are supported.
- Project routing defaults can supply provider, model, runtime, and review provider.
- A connected control plane can estimate and return the actual route; otherwise local derivation/mock behavior is used.
- Providers exposed by chat include OpenSaddle, Codex App Server, Claude Code, Cursor, Gemini CLI, OpenCode, Antigravity CLI, and custom/auto concepts.
- Runtime kinds include local, browser, sandbox, VM, GPU, and restricted.
- Run output can contain plan steps, tool calls, streamed output, diff files, verification, artifacts, status, route explanation, and cost.
- Current chat execution is not navigation-durable: the page owns one subscription and unsubscribes on unmount. The redesign acceptance criterion is stronger—active runs must survive route changes and reconnect where the backend supports it.
- Harness execution and chat execution currently implement separate page-local lifecycle handling. The thread-first controller must preserve both event shapes while consolidating ownership.

### Permissions and approvals

- Effective access is evaluated from user, agent, project/resource, action, path, inheritance, and allow/deny grants.
- Deny remains authoritative; user and agent permission boundaries are both evaluated where an agent participates.
- Execute permission is checked before chat runs and harness runs.
- File and site writes remain permission-gated.
- Approval-required grants can request and resolve control-plane approvals.
- The prompt-derived permission card offers once/chat/project/always scopes, but the chosen scope is currently not persisted as a grant. Preserve the visible decision flow while replacing it with auditable semantics.
- Approval requests, denials, blocked actions, and failures must never be hidden by transcript-density controls.

### Files, diffs, checks, and artifacts

- OPFS/browser file storage and virtual filesystem behavior must remain distinct from Git diffs produced by runs.
- File import, create, edit, save, directory navigation, and sandbox execution require explicit unavailable/error states.
- Diff hunks support pending, accepted, and rejected states. Hunk state must remain associated with the correct message/run/file.
- Reports can be saved to project Files where the service exists.
- Verification checks and run artifacts remain inspectable even after a run completes.
- Current PR creation is simulated; the redesign must not label it as a working Git operation unless an implementation is connected.

### Work, automation, and sessions

- Scheduled tasks, background tasks, monitors, workflow definitions, workflow runs, agent sessions, environments, and approvals remain distinguishable even if Work presents them in one inbox.
- Status must not be duplicated or contradicted across Work, Project, and Thread views.
- Secure VM requests create both environment and background-task records before navigating to Runs.
- KRAIL browser/PTY sessions and control-plane harness runs remain optional sidecar-backed capabilities.
- Session linking must retain the authority choice and privacy boundary. Current behavior is only a preparation mock; transcript import must remain an explicit separate action.

### Sites and custom resources

- Sites retain project ownership, draft editing, immutable version snapshots, published-version identity, restore/rollback, public slug, visibility, accent, pages, sections, embedded agent, and placement.
- Public routes render only the selected published snapshot and work without the workspace shell.
- APIs, dashboards, and custom interfaces remain project-owned and reachable from project context even after they leave primary navigation.
- Dashboard-to-thread and interface/site-to-thread handoffs keep their originating project and agent scope.

### Persistence

- Local workspace data uses `opensaddle-data-v5`; Files use OPFS independently.
- Every workspace mutation currently serializes the full workspace to local storage.
- A compatible remote control plane can load/save workspace data and is authoritative after connection.
- Remote initialization is explicit: demo data is not uploaded until the user chooses Initialize remote workspace.
- The current loader silently replaces local data with seed data on parse error or version mismatch. This is a known baseline risk, not acceptable migration behavior. The redesign requires an explicit forward migration and recoverable rollback rather than preserving the reset.
- Bearer tokens are held in the connection session and are not part of exported workspace data. Model-provider keys belong in the backend.

### Browser and Electron equivalence

- Shared workspace routes and data semantics must behave equivalently in web and Electron.
- Browser mode can use OPFS, Worker sandbox, HTTP control plane, and mock fallback but cannot claim native repository, PTY, CLI, or embedded browser capabilities.
- Electron exposes runtime info, repository picker, open path, and native browser operations through the preload bridge.
- Closing/collapsing the browser pane must not navigate or destroy the workspace route.
- BrowserRouter basename and Electron HashRouter behavior are both release gates.

## Golden journeys

Each journey should be automated where feasible and repeated manually before removing its legacy route.

### Browser journey B1 — prompt to reviewed result

1. Enter `/start`, create or select a project, and start a chat.
2. Verify the concrete `/chat/:chatId` route and correct active project.
3. Attach a file and confirm it appears in Files.
4. Open route details; exercise auto and an explicit provider/model/harness/runtime choice.
5. Send a prompt that produces a plan, tool activity, verification, diff, and artifact.
6. For a privileged prompt, deny once; rerun, allow with a narrow scope, and verify the decision is visible.
7. Navigate away during an active run and return. Legacy baseline exposes the current failure; the new controller must retain/reconnect the run.
8. Accept one hunk, reject another, save a report, inspect checks and route/cost details, and request a revision in the same thread.
9. Fork, rename, change visibility, reload, and verify both parent and fork histories persist.
10. Delete the disposable fork and verify it disappears from Recent and project lists.

### Browser journey B2 — project and specialized resources

1. Create a nested project and verify context/lineage.
2. Create an agent, Quick API, dashboard, and interface.
3. Open each detail route and return to the same project.
4. Create and run a workflow; pause/resume it and inspect its run clue from Project.
5. Inspect Wiki perspectives and sources, refresh summaries, and open a team-agent chat.
6. Verify every specialized route remains reachable from context, Admin, or command palette after navigation consolidation.

### Browser journey B3 — site publication boundary

1. Create a site and edit slug, accent, pages, and sections.
2. Create a draft version, publish it, and copy/open the public link.
3. Verify `/published/:slug` has no workspace shell and contains only the published snapshot.
4. Edit a new draft and verify the public route remains unchanged.
5. Publish the new version, restore an archived version, and verify public content follows the selected published version.
6. Use the embedded agent and continue to full chat with correct site project/agent context.

### Browser journey B4 — permissions, files, and persistence

1. Create scoped allow, approval-required, and deny grants; verify effective access and deny precedence.
2. Revoke a grant and verify affected controls become blocked.
3. Import/create/edit/save a file and run the Worker sandbox.
4. Reload and verify workspace and OPFS file state survive.
5. Export workspace JSON.
6. Connect a test control plane, verify compatible remote hydration, edit and observe saved state, then return to demo.
7. Present an incompatible remote schema and verify the redesign offers migration/recovery without silently uploading or resetting data.

### Browser journey B5 — Work and background activity

1. Create/run a workflow, request a secure VM task, and start a chat run.
2. Verify each item appears once with consistent status and a deep link to its owning thread/project.
3. Pause/resume or stop where supported.
4. Verify Needs input, Needs approval, Blocked, Running, Scheduled, Failed, and Completed ordering.
5. Reload/reconnect and verify durable status and evidence.

### Electron journey E1 — local coding flow

1. Launch the packaged app and verify `file://` plus hash routing.
2. Open Harness, pick a repository with the native dialog, and verify detected CLIs.
3. Start `safe_local`, then an available external CLI run.
4. Verify estimate, live events, completion/failure, diff, and checks.
5. Navigate between routes during a run and return without duplicate subscriptions or lost final state.
6. Use open-path behavior on an emitted file if exposed by the redesigned review panel.

### Electron journey E2 — native browser split

1. Open the split browser from the top bar and load a page that rejects iframes.
2. Resize to minimum and maximum bounds; collapse, restore, and close.
3. Exercise back, forward, reload, zoom, find/clear-find, screenshot, print, and clear-data.
4. Toggle full-screen browser presentation if retained.
5. Verify the workspace route, composer draft, inspector state, and active run are not lost.

### Electron journey E3 — runtime and background handoff

1. Start KRAIL browser and PTY sessions when the sidecar is available; verify explicit offline states otherwise.
2. Request a secure VM/background task and land in Work/Runs.
3. Navigate elsewhere while it runs, then return to its durable status/evidence.
4. Link a Codex or Claude session with each authority mode and verify no transcript is imported before explicit consent.

### Electron journey E4 — route and persistence parity

1. Deep-link/reload Thread, Project, Work, Settings, Site, and specialized detail routes.
2. Repeat chat CRUD/fork/share, permission, Files, and site publication checks supported by the desktop runtime.
3. Restart the packaged app and verify local/remote workspace state, OPFS files, collapsed navigation, pinned items, and public-route behavior.

## Visual regression states to capture

Use deterministic seed data, fixed time, stable IDs, disabled animation, a consistent font environment, and masked run IDs/cost timestamps. Capture dark, light, and high-contrast themes for the core thread and shell; capture reduced-motion behavior separately.

### Existing named baseline images

- Workspace: `web-01-start.png`, `web-02-chat.png`, `web-03-project.png`, `web-04-runs.png`, `web-05-wiki.png`, `web-06-agents.png`, `web-07-workflows.png`
- Runtime/governance: `web-08-harness.png`, `web-09-sessions.png`, `web-10-browser-runtime.png`, `web-11-files.png`, `web-12-permissions.png`, `web-13-environments.png`, `web-14-plugins.png`, `web-15-usage.png`, `web-16-settings.png`, `web-17-admin.png`
- Artifacts: `web-18-sites.png`, `web-19-agent-detail.png`, `web-20-site-experience.png`, `web-21-dashboard.png`
- Shell overlays: `web-22-command-palette.png`, `web-23-create-project-modal.png`, `web-24-workspace-tools-menu.png`
- Desktop: `desktop-04-coding-flow.png`, `desktop-05-secure-vm-background-run.png`, `desktop-06-native-browser-fullscreen.png`

The route audit set adds API and custom-interface baselines under `out/screenshots/claude-ui-audit/`.

### Required new thread-first snapshots

- Shell: expanded/collapsed sidebar, no recents, long project names, deep project hierarchy, pinned items, command palette query/no results, account/Admin menu, narrow viewport, offline/syncing/error badges.
- Composer: empty, multiline, attachment, `@` mention, advanced route popover, each permission mode, each execution target, disabled send, active-run Steer, active-run Queue with editable queued item, Stop.
- Thread lifecycle: draft, planning, ready to run, running, needs input, needs approval, blocked, reviewing, completed, failed, stopped, reconnecting, resumed.
- Transcript density: Summary, Normal, and Verbose with the same run; permission/failure/user-question cards visible in all three.
- Plan: no plan, short plan, long plan, active step, completed, failed, edited, approval exit choices.
- Activity: streaming output, collapsed tool summary, expanded command/output, nested subagent, background task, long log, retried step.
- Approval: requester/action/data boundary/risk/scope; allow once/chat/project/always; deny; pending remote reviewer; expired/revoked.
- Evidence: no changes, one file, many files, binary file, accepted/rejected/pending hunks, staged/unstaged scopes, checks passing/failing/running, artifact/report/site/PR link, route and cost.
- Inspector: closed, Overview, Changes, Checks, Activity, Environment, Access, Terminal/Browser where available; restored per thread.
- Work: empty, mixed statuses, Needs attention first, concurrent runs, scheduled items, failed item, completed item, duplicate-source reconciliation.
- Project: empty and populated; nested project; context/members/knowledge/automations/apps/settings; permission-restricted state.
- Admin/specialized: permissions, tools/plugins, models, runtimes, usage, storage, audit; site draft/published/restore; public site unavailable and published; Files unavailable and editor; session resume preview.
- Desktop: native browser expanded/collapsed/full screen, repository picker result, detected/no CLI, KRAIL online/offline, HashRouter deep link.
- Responsive and accessibility: 200% zoom, 320 CSS-pixel width where applicable, keyboard focus rings, high contrast, reduced motion, long localized labels, empty/error/loading states.

## Automated verification checklist

### Baseline commands

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run build`
- [x] `npm run electron:build`
- [ ] `npm run server:typecheck`
- [ ] `npm run server:test`
- [ ] `npm run server:build`
- [ ] `npm run real:check`
- [ ] Packaged Electron smoke test (`npm run desktop:package` followed by launch)

### Frontend coverage to establish

The root package currently has no frontend unit, integration, end-to-end, accessibility, or visual-regression test script. Agent H should add a test runner and browser automation before route replacement.

- [ ] Route manifest test covers every route pattern, admin redirect, unknown redirect, web basename, Electron hash deep links, and public-shell bypass.
- [ ] Reachability audit proves every legacy capability has a visible contextual link, command action, or Admin destination.
- [ ] Store contract tests cover chat CRUD/archive/fork/visibility, project nesting, artifacts, workflow runs, secure VM records, site versions, hunk state, and stable IDs.
- [ ] Migration tests load each supported persisted version, preserve all collections, reject corrupt input recoverably, and test rollback/export.
- [ ] Remote persistence tests prove no implicit demo upload, authoritative hydration, debounced saves, save errors, reconnect, and incompatible schema handling.
- [ ] Permission tests cover user-agent intersection, deny precedence, inheritance, path scope, approval required, revoke, and audit records.
- [ ] Runtime reducer tests replay mock, control-plane, Codex, Claude, browser, VM, completion, failure, reconnect, duplicate, and out-of-order events.
- [ ] Concurrent-run tests start at least two runs, navigate between threads, reload/reconnect, stop one, and prove isolation.
- [ ] Thread tests cover all lifecycle states, plan/activity/evidence separation, Steer/Queue/Stop, density modes, and inspector restoration.
- [ ] Diff tests cover multiple files/hunks, accepted/rejected state, large/binary diffs, comments, checks, and safe action scoping.
- [ ] Work tests reconcile task/workflow/session/approval/run records once and sort attention before ordinary status.
- [ ] Site tests prove immutable published snapshots, draft isolation, publish/restore, sanitized links/content, and public shell isolation.
- [ ] Files tests cover unavailable OPFS, import/create/edit/save, paths, permission denial, quota errors, and sandbox timeout.
- [ ] Accessibility automation checks WCAG AA contrast, accessible names, dialog focus trapping/restoration, tab semantics, tree controls, keyboard-only critical flows, reduced motion, and live status announcements.
- [ ] Visual tests cover the state inventory above in deterministic browser and Electron fixtures.
- [ ] Performance tests set explicit budgets for long transcripts, large diffs, command-palette search, initial bundle/load, and concurrent streaming updates.
- [ ] Console/network audit fails on unexpected errors, unhandled rejections, duplicate subscriptions, unsafe mixed content, and unauthorized requests.

## Manual verification checklist

### Every pull request

- [ ] Test the changed surface in dark and light themes.
- [ ] Complete its primary action with mouse and keyboard.
- [ ] Verify loading, empty, blocked, error, success, and destructive confirmation states.
- [ ] Inspect the browser console and failed network requests.
- [ ] Reload the route and verify persisted and transient state behave intentionally.
- [ ] Navigate away during active work and return.
- [ ] Verify the command palette and contextual navigation still reach displaced capabilities.
- [ ] Confirm focus is visible and restored after menus, dialogs, drawers, and inspector panels close.

### Every execution or permission change

- [ ] Compare displayed provider/model/harness/runtime with the route actually started.
- [ ] Exercise allowed, denied, approval-required, approval-pending, failed, and stopped outcomes.
- [ ] Verify an approval states exact action, boundary, risk, and scope.
- [ ] Verify no hidden density level suppresses an actionable card.
- [ ] Confirm events, plan, output, diff, checks, artifacts, cost, and failures attach to the correct run and thread.
- [ ] Start concurrent runs and verify no cross-thread event leakage.

### Before retiring a legacy route

- [ ] Mark every matrix row capability as preserved, intentionally improved, or explicitly deferred.
- [ ] Verify redirects/deep links and saved bookmarks.
- [ ] Compare the replacement against its existing screenshot and required new states.
- [ ] Repeat relevant Browser and Electron golden journeys.
- [ ] Confirm public site routes and published content are unaffected.
- [ ] Confirm existing local and remote workspaces open without silent loss.
- [ ] Record known gaps and a rollback path in the handoff.

### Release candidate

- [ ] Run all automated suites and `npm run real:check`.
- [ ] Test web production output under `/opensaddle-interface/`, not only the dev server.
- [ ] Test a packaged Electron build, not only Electron dev mode.
- [ ] Test with control plane and KRAIL available and unavailable.
- [ ] Test compatible, old, corrupt, empty, and remote workspace data.
- [ ] Complete B1-B5 and E1-E4.
- [ ] Run keyboard-only and screen-reader passes on Thread, Work, Projects, Admin, approval, diff review, and site publication.
- [ ] Test 200% zoom, high contrast, reduced motion, long transcripts, large diffs, and two concurrent runs.
- [ ] Verify zero unexpected console errors and no inaccessible critical action.
- [ ] Verify feature-flag rollback leaves workspace data readable by the previous interface.

## Baseline command results and known gaps

Commands were run against the current dirty working tree on 2026-07-26:

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with 8 warnings |
| `npm run build` | Passed |
| `npm run electron:build` | Passed |

Lint warnings:

1. `src/runtime/fs/memory.ts`: `typescript(no-this-alias)`
2. `src/components/common/CommandPalette.tsx`: `react(only-export-components)`
3. `src/components/common/ProviderLogo.tsx`: two `react(only-export-components)` warnings
4. `src/pages/FilesPage.tsx`: `react-hooks(exhaustive-deps)` for `refresh`
5. `src/data/store.tsx`: `react(only-export-components)`
6. `src/data/store.tsx`: `react-hooks(exhaustive-deps)` for `persistenceStatus`
7. `src/pages/ChatPage.tsx`: `react-hooks(exhaustive-deps)` for a complex dependency expression

The production build also warns that the main JavaScript chunk is larger than 500 kB: approximately **567.43 kB minified / 155.46 kB gzip**. This is the initial-load performance baseline.

Known baseline gaps that verification must expose rather than bless:

- No root frontend test, browser E2E, accessibility, or visual-regression harness is configured.
- Active chat runs are owned by `ChatPage` and do not survive navigation.
- Persistence resets to seed on local parse/version mismatch instead of migrating.
- Several visible actions are simulated, as labeled in the route matrix.
- Chat archive is store-only.
- Prompt-derived approval scope is displayed but not persisted as an auditable policy grant.
- The root store clones and saves the full workspace for every mutation.
- Public and workspace routes share one application bundle despite public shell bypass.
- Current CSS is predominantly global, so unrelated visual regressions are plausible.

This baseline is complete when future Agent H reports update each route row and golden journey with evidence, not when screenshots merely look similar.
