# Interface planner status

Updated: 2026-09-07 11:43 America/New_York

## Current status — unified Project operations first slice

The connected shell now mounts `/operations?project={project_id}` as a read-only Project operations view. It reads managed Run identities from the existing authenticated `GET /api/v2/command-center` projection and explicitly registered external sessions from `GET /api/v2/projects/{project_id}/external-sessions`. Active and outcome rows are deduplicated strictly by authoritative Run ID. External session records remain separate unless Core supplies an exact `run_id`; no title/time heuristic correlates them. Authority modes are translated without widening them: `opensaddle_managed` is Managed, `hybrid` is Cooperative, and `source_managed` is Observed.

Every Run shows the Core projection source and its own freshness when available, plus a `/runs?run={run_id}` evidence link. `RunsPage` consumes that exact query identity, and the connected-local shell now mounts the route rather than dropping it through the fallback. Every session shows the Core external-session registry source and `updated_at`; `/operations?project=…&session=…` opens only the selected item from the freshly authorized list, including external identity, locators, authority hash, checkpoint availability, and capability coverage. An unknown or revoked selection clears details and fails closed.

Core currently exposes no permission-scoped worker read projection or usage/quota projection. The view therefore labels worker online/offline/trust/capacity/lease status unknown and usage/quota unavailable; it does not infer a healthy worker, zero spend, zero quota, cooldown, or reset. Worker controls, checkpoint lineage, quota controls, and connector health are called out as unavailable. The production view contains no drain, revoke, scheduling, account connection, or other operations mutation.

The external-session transport rejects both a mismatched response envelope Project and any cross-Project row. One generation fence owns initial loads, route/client transitions, Retry, and manual Refresh. It synchronously replaces protected rows with loading state and prevents a delayed prior refresh from restoring them after project change or revocation. Mounted tests cover exact Run-ID deduplication, all three authority labels, source/freshness and unavailable semantics, exact Run/session links, missing selection, route/client revocation clearing, and delayed manual-refresh fencing. Transport tests cover the authenticated Project route, exact mapping, revocation, and Project substitution.

Live fixture proof used Core 8903 v4 and private 0600 token paths without printing token contents. The disposable fixture was seeded once through Core's public owner-authorized external-session endpoint with a `source_managed` session whose capabilities explicitly say metadata true, transcript false, and usage false. A member read returned 200 for Command Center and external sessions, with three distinct Project Run IDs and the observed session at its exact `updated_at`. No worker or usage/quota read route exists in this composition, so those live states remain truthfully unavailable.

Final local evidence: focused operations tests passed; full repository tests 377/377 passed (313 workspace plus 64 feature/service); typecheck passed; production build passed with the existing large-chunk advisory; `git diff --check` passed. Isolated Chrome headless rendered the authenticated Core 8903 operations and participant inbox journeys without using the user's browser profile. The inspected 390 x 844 pass exposed sidebar clipping; the connected-local shell now uses a compact five-destination mobile nav and a source guard test prevents hiding it. Exact result navigation now uses React Router so the configured `/opensaddle-interface/` base path is retained. The saved desktop operations screenshot is under `docs/agents/evidence/`; no post-fix mobile screenshot is retained because the fixture connection could not be re-established after the final hot reload. It does not claim a physical touch device or production deployment.

## Current status — durable reviewer participant

Independent mounted review then caught three state/identity defects. The exact new assertions failed 4/4 before their owner changed: React StrictMode effect replay left the participant surface permanently non-live; a route change during a pending lifecycle mutation left the new reviewer controls permanently busy; completed inbox links omitted the invocation identity; and the resulting review destination restored a different invocation from the same source Run. The same assertions now pass. Effect setup restores the live flag, route/client changes synchronously release stale busy state while generation fencing still ignores the old completion, and completed links carry `invocation`. The registered review surface loads that durable invocation directly and accepts it only through the existing exact Project, Run, artifact digest, command version, and descriptor checks; it cannot fall back to an unrelated Run invocation when an explicit invocation was requested.

`/participants/review` now owns the complete Interface boundary for Core's `opensaddle.participant.v1` reviewer. An owner can create a reviewer from an explicit Project, and any authorized Project member can open a known durable participant ID. The loaded surface shows the server-owned participant, owner, source, lifecycle revision, and exact command version and descriptor digest; Interface does not invent a reviewer catalog because Core exposes create/get rather than a Project participant-list route.

Artifact review submission requires the exact query-bound `{project_id,run_id,artifact_id,digest}` and current participant revision. One client-generated intent key remains stable across an unknown-response retry. A successful accepted/replayed handle rotates that key for the next deliberate submission and is deduplicated by `message_id` in the durable inbox. Accepted or running work is explicitly shown without a result; completed messages link through their exact Project and Run to the existing durable command-result surface. Refresh reloads participant and message state from Core. Waiting is described as configuration rather than model activity, and page unmount sends no lifecycle or cancellation mutation.

Pause, resume, and terminal retire controls send the currently rendered revision and accept only the response for the same active client/route generation. The same generation fence protects participant/message loading and owner creation so deferred work from an old route cannot replace the current reviewer. Core owner/admin denials and other authoritative errors remain visible.

Mounted React coverage now exercises stale route/client completion, unknown-response replay with the same key and one displayed message, owner creation denial plus deliberate ID discovery, unmount without cancellation/lifecycle mutation, exact resource rendering, queued/running versus completed result display, and revision 0→1→2→3 pause/resume/retire transitions. Transport coverage protects the exact message body, revision, identity/auth headers, idempotency header, owner create route, full participant command identity, and durable single-message reopen route.

Final local evidence after the independent fixes: focused participant plus review-surface tests 22/22 passed; full repository tests 367/367 passed (311 workspace plus 56 feature/service); typecheck passed; lint passed with the same 19 pre-existing warnings outside this slice; production build passed with the existing large-chunk advisory; `git diff --check` passed.

Real HTTP verification used Core's disposable 8903 fixture and private token paths without printing token contents. A member create attempt returned the expected 403 owner/admin denial. Owner creation returned 201/revision 0; member discovery returned the same participant and exact command descriptor. Exact artifact submission returned 202 with a queued Run; replay with the same key returned 200 with the same message and Run. Durable inbox reload exposed queued and completed states, the completed message reopened its exact invocation, and the invocation retained the fixture's exact resource (the first automated comparison was order-sensitive JSON text; a field-level inspection confirmed equality). A separate created participant moved deliberately through paused revision 1, waiting revision 2, and retired revision 3.

The earlier no-headless limitation is superseded: the installed Chrome binary completed isolated localhost rendering without an unlock or package installation.

## Current status — immutable proposal approval

Interface now has a deep-linkable governed review at `/proposals/review?proposal={proposal_id}`. It consumes the Command Center’s scoped `proposal_id` and `record_digest`, loads the authoritative immutable operation-proposal record, and shows exact targets and versions, protected-input and record digests, effects and bounds, policy, validation, blockers, required approvals, expiry, and cost before the user can grant approval.

The only mutation is `POST /api/v2/krail/proposals/{proposal_id}/approval` with a bounded `ttl_seconds`; the page sends no execution request. The immutable proposal ID is Core’s approval precondition and Core persists the record-digest binding. Expired proposals, self/non-approver denials, unavailable records, and failures are terminal UI states with no automatic retry. A returned replay whose own approval expiry has elapsed is explicitly not presented as current execution authority; Core remains responsible for execution-time membership, digest, and expiry rechecks.

Focused transport/model tests and typecheck are green. A live Core 8902 read-only check confirmed an approver-scoped Command Center attention item has `proposal_id`, 64-hex `record_digest`, and `approve`, and that its referenced proposal loads as an immutable record. The browser-only screenshot gate remains blocked by the locked Mac; no screenshots are claimed.

## Current status — extension command seam

Interface owns the renderer and remote-client integration for Core's project-scoped extension commands. The single registered `artifact-review` surface selects from server discovery and uses one generic command selector and renderer for the two package commands; it does not import, branch on, or execute a package.

The client now sends Core's exact invocation preconditions from the selected descriptor: `expected_version` and `expected_descriptor_digest`. A stale descriptor response is shown as **Command descriptor changed** and tells the user to refresh; it does not retry automatically. Focused transport and mounted tests cover the body shape, the selected command identity, and one stale failure without a second invocation. Current focused checks are green; standard typecheck, lint, full test, and production build remain pending after this edit.

Core supplied opt-in loopback fixtures at 8900 (enabled) and 8901 (disabled); their tokens remain in private 0600 files and are not recorded here. Direct live HTTP verification against 8900 discovered exactly `example.artifact.size_band` and `example.artifact.summarize`, invoked both with their discovered version/digest preconditions, and recovered exactly two durable completed results. A deliberately stale descriptor digest returned `409` with `stale_command_descriptor` and did not add an invocation. At 8901 both extension commands were omitted from project discovery and direct invocation returned `404 command not found`.

The remaining browser-only gate is currently blocked by the locked Mac: CUA cannot unlock it, so the production Interface cannot be connected to the fixtures and no screenshots can truthfully be saved. When the desktop is unlocked, run the real browser journey: invoke each command, reopen the durable result without reinvoking, inspect disabled and stale/failure states, and save screenshots under `docs/agents/evidence/`. The persistent 8877 fixture remains untouched and does not expose this package-backed contract.

## Current slice

Mount the first malleable review application on the real Core command, artifact, durable invocation, and environment APIs. The review surface must retain exact server identities, share one palette/shortcut action, recover results after closing without reinvocation, and preview/apply/revert environment definitions without owning execution authority.

## Product decisions

- `/home` remains the default outcome/responsibility-first Command Center in both shells. It shows Need Akash, active work, Projects, recent outcomes with evidence status, and explicit server capability gaps.
- A Command Center outcome links `/review` with its exact Project and Run. The review surface enumerates only artifacts returned by `GET /api/v2/runs/{run_id}/artifacts`; it never creates an artifact identity or digest.
- The command inspector exposes the public command id, version, descriptor digest, effect, required server actions, exact resource, invocation id, and receipt. `verified:false` renders as **Not verified**.
- Palette and `Cmd/Ctrl+Shift+R` use one `openArtifactReview` action. From Command Center the action resolves the first Run-backed outcome from a fresh authoritative projection; from an already selected review it preserves the exact query.
- Review invocations are recovered from Core's durable project invocation list. Browser storage is not an invocation authority, and reopening never invokes the command.
- Environment preview and apply bind both the numeric base revision and `base_definition_digest`. Definitions use exact `{command_id, version, descriptor_digest}` refs. Runtime health remains explicitly unavailable when Core has no adapter.
- Closing the review surface only unmounts renderer UI. It sends no Run cancellation and does not change the artifact or durable invocation.
- No renderer eval, package execution, fabricated result, mock fallback, or implicit verification was added.

## Files

- `src/features/command-center/CommandCenterPage.tsx`
- `src/features/command-center/command-center.css`
- `src/features/shell/ReviewWorkspacePage.tsx`
- `src/services/remoteCommandCenter.ts`
- `src/services/remoteCommandCenter.test.ts`
- `src/services/remoteMalleableShell.ts`
- `src/services/remoteMalleableShell.test.ts`
- `src/services/contracts.ts`
- `src/services/index.ts`
- `src/App.tsx`
- `src/data/store.tsx`
- `src/features/projects/ConnectedLocalSettingsPage.tsx`
- `src/features/shell/ThreadFirstSidebar.tsx`
- `test/connectedLocalBoundary.test.ts`

## Test-first acceptance evidence

The latest instruction required a real pre-fix failure for remaining behavior. The observable invariant was: palette and shortcut entry must resolve the same authoritative Run-backed review selection rather than open an inert surface. Existing client tests did not cover browser navigation.

- Pre-fix browser command: connect seeded Core, open populated Command Center, press `Ctrl+Shift+R`.
- Intended assertion: URL contains the exact Run and Project from the current server outcome and the resource inspector loads that artifact.
- Actual pre-fix failure: browser landed at `/review` and visibly rendered **Choose a completed outcome**.
- Owner fixed: `src/App.tsx`, by replacing the two palette lambdas and keyboard lambda with one production `openArtifactReview` callback that refreshes the authoritative projection.
- Identical post-fix browser command: passed; it landed at `/review?run=run_5ed4dc20b38e42949365be0aa20f68ba&project=command-center-demo` and rendered exact artifact `art_575eb1ba0a87486d9a35bf97375f0693` with its server digest.
- No production-only test hook or renderer fixture was introduced.

## Checks

- `npm run typecheck`: passed.
- `npm exec --prefix packages/control-plane -- tsx --test src/services/remoteCommandCenter.test.ts src/services/remoteMalleableShell.test.ts`: 6 passed. These protect exact artifact mapping, durable invocation read/list paths, revision-and-digest-bound preview/apply bodies, authentication headers, and fail-closed errors.
- `npm run lint`: passed with the repository's existing 19 warnings; no warning is in the new Command Center, review surface, or remote clients.
- `npm test`: 311 passed.
- `npm run build`: passed. Vite retains its existing large-chunk advisory.
- Real populated Command Center at `127.0.0.1:8877`: passed with one approval, two active Runs, one Project, one artifact-backed outcome labelled `Unverified`, and priority/work/recurring jobs/inbox declared unavailable.
- Real review invocation: `inv_9eb3b6bf4f6d47dbbf4d3c7e057b6504` returned **Not verified**. Navigating Home and reopening through the shared shortcut recovered that same invocation id and receipt from Core without pressing Review again.
- Real environment preview: passed with an exact proposed digest and `Service health: no runtime health adapter configured`.
- Real environment apply: passed from revision 0 to revision 1 while the existing invocation result remained visible.
- Real environment revert: after Core’s test-first revision-zero fixes, passed from revision 1 to a new revision 2 restoring canonical revision 0. Invocation `inv_9eb3b6bf4f6d47dbbf4d3c7e057b6504` and its receipt remained visible and unchanged.
- Real palette journey: `Ctrl+K` → **Review selected artifact** resolved the same exact Run/Project and recovered the same durable invocation as the keyboard shortcut.
- Chrome accessibility-tree and visual inspection passed for disconnected, populated Command Center, exact review, recovered review, preview, and applied states. Screenshots were inspected inline. The current CUA surface exposes screenshot bytes but not a filesystem save path, so no local screenshot path is claimed.

## Cross-repository dependency

Core supplies `GET /api/v2/command-center`, command discovery/describe/invoke, exact Run artifacts, durable invocation get/list, and environment get/preview/apply/revert. Interface consumes those contracts without lifecycle authority.

Two live revision-zero contract defects were found and resolved test-first in Core during browser proof: first revision `parent_revision` dropped integer zero, and revert request validation rejected target revision zero. Core captured the intended failures, fixed both owners, restarted the disposable server, and the final Interface journey passed. Interface separately captured `[object Object]` from structured 422 details before hardening error formatting; the focused regression now requires readable structured detail. No blocker remains for this slice.

## Unsupported portions

- Package installation is unavailable when Core has no installed/enabled package catalog adapter. Interface sends no package refs.
- Environment scope layering and observed runtime health remain unavailable in the current contract.
- Recurring jobs, Inbox triage, and durable priority editing remain server-declared unavailable.

## Next slice

Add a package-backed application only when Core exposes an installed/enabled exact package manifest; keep public command/resource inspection and renderer non-authority intact.

### 2026-09-07 00:08 independent renderer hardening

Independent review found four renderer identity failures that transport tests could not catch. Before changing the owner, `npm exec --prefix packages/control-plane -- tsx --test src/features/shell/reviewWorkspaceModel.test.ts` ran four real assertions and failed 4/4 for the intended reasons: artifact A remained selected while the restored invocation belonged to B; a command-id-only match retained an obsolete version/digest; a P1/R1 state survived the start of a P2/R2 transition; and an authoritative unavailable reason was reduced to a generic sentence.

The new `reviewWorkspaceModel.ts` owns these invariants and `ReviewWorkspacePage.tsx` consumes it. Durable recovery now requires exact Project, Run, artifact id, artifact digest, command version, and descriptor digest, then deliberately selects that invocation's artifact. Environment proposals replace any same-id id with the exact discovered descriptor ref. Every resource, command, result, preview, apply, and revert control is gated by the current route identity while loading; stale promise completions retain the existing effect cancellation. Artifact changes clear a result that belongs to another artifact. Unavailable descriptors announce their server reason.

Post-fix evidence:

- Identical focused model command: 4/4 passed.
- Model plus real transport clients: 8/8 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with the same 19 pre-existing warnings outside this slice.
- `npm test`: 311/311 passed.
- `npm run build`: passed with the existing chunk-size advisory.
- `git diff --check`: passed.
- Fresh Chrome connection to the persistent seeded server: shared shortcut resolved the exact outcome; review recovered artifact `art_575eb1ba0a87486d9a35bf97375f0693`, exact descriptor version 1/digest, and unchanged durable invocation `inv_9eb3b6bf4f6d47dbbf4d3c7e057b6504` after the earlier environment revert. No reinvocation occurred.

The seeded server has only one Run-backed outcome and an available descriptor, so B-versus-A recovery, deferred cross-route resolution, and unavailable-reason variants are covered at the renderer state boundary rather than falsely claimed as live-server variants. No blocker remains from these findings.

### 2026-09-07 00:18 mounted surface and connector discovery

The earlier model tests were insufficient as mounted renderer proof. `ReviewWorkspaceSurface` is now a production input boundary used by `ReviewWorkspacePage` through the existing `SurfaceHost` registry. Four mounted tests use actual React effects and deferred service promises without source-string assertions or test-only component hooks:

- `ReviewWorkspacePage.test.tsx`: selects artifact B when the exact durable invocation belongs to B, despite A being first.
- Same file: clicks the mounted Preview control and asserts the submitted definition contains the discovered version/digest instead of the stale environment ref.
- Same file: updates mounted P1/R1 to P2/R2 while P2 artifacts are deferred and proves old invocation, digest, Preview, and Revert are absent until P2 resolves.
- Same file: proves a disabled mounted command announces the server-provided unavailable reason.

The review application is registered as `artifact-review` and takes explicit client/Run/Project inputs. Its inspectable application config exposes `opensaddle.review.workspace.v1`, the command id, and optional exact package provenance. Since Core's current command descriptor has no package provenance, the live surface says so rather than inventing a package. Registration is idempotently guarded for Vite hot reload; an actual browser red observation caught the unguarded duplicate registration before this fix.

Core's agreed `opensaddle.connector.v1` discovery is consumed through `GET /api/v2/runs/{run_id}/connectors`. The connected-resource inspector uses the server's action title, description, effect, required input, protocol version, status, and reason. It offers no connector execution control in this read-only slice, hides discovered actions while offline, and shows an explicit no-capability state. A focused mounted test first failed because no connected-resource section existed, then passed after implementation. A second mounted test protects offline action hiding; a transport test protects the exact Run-scoped path.

Final evidence: 17/17 focused mounted/model/transport tests passed; typecheck passed; lint retained the 19 pre-existing warnings; 311/311 repository tests passed; production build and diff check passed. Fresh Chrome proof through the registered `SurfaceHost` recovered the existing exact artifact/descriptor/invocation and rendered `Connected resources — No connected-resource capability was granted for this Run.` The seeded immutable Run has no granted GitHub capability, so no connector or live GitHub result is claimed.

### 2026-09-07 00:42 connected read invocation control

The connected-resource surface now invokes only server-discovered, Run-granted read actions through Core's existing broker route. It renders the immutable Run id, connector/protocol/status, exact action id and effect, then derives bounded text/number/enum inputs from the server schema. Dispatch uses `POST /api/v2/runs/{run_id}/connectors/{connector}/{action}` with `{arguments:{...}}`; no arbitrary URL, flag, OAuth, permission widening, or renderer-side action registry exists.

Test-first evidence:

- The new mounted success test initially failed at the intended UI boundary because the discovered server action was descriptive text and no action button existed (`open` was undefined).
- After implementation, mounted renderer coverage passes for exact `get_repository` argument dispatch, schema pattern/max-length preservation, returned result display, broker denial without a receipt, executor-offline action hiding, and the no-grant path.
- Broker receipts are labelled as dispatch/response binding and explicitly separated from artifact verification.

Checks:

- Focused mounted, model, Command Center, and transport suite: 21/21 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with the same 19 pre-existing warnings outside this slice.
- `npm test`: 311/311 passed.
- `npm run build`: passed with the existing chunk-size advisory.
- Live Chrome against the seeded Core server: Command Center outcome navigation reached the exact durable review result, then rendered `Run grant run_5ed4dc20b38e42949365be0aa20f68ba` and `No connected-resource capability was granted for this Run.` No connector action appeared.

Browser acceptance limitation: Core confirms the current CLI composition has no connector adapter, credential lease issuer, or disposable granted fake-executor server, so a truthful Chrome success/offline/denied dispatch journey cannot yet run. Interface proves those states at the mounted renderer/service boundary; live Chrome proves the actual no-grant path. The CUA screenshot was visually inspected, but this CUA surface returned bytes without writing the requested filesystem path, so no saved screenshot path is claimed.

Next slice: rerun the same live browser journey against a Core-provided disposable server with an immutable granted Run and fake broker/lease adapter; capture success, offline, and denied states without changing Interface authority.

### 2026-09-07 01:18 final HTTP-backed connector browser acceptance

Core supplied three opt-in loopback fixture servers with separate state, bearer tokens, immutable Runs, fake GitHub adapters, and no live-provider traffic. The production Interface was connected through its settings UI for every scenario.

A browser red observation exposed a navigation defect before the fixture could be exercised: the granted connector identity belonged to the active Run, while the seeded artifact outcome belonged to a separate completed Run, and Command Center only linked active Runs to the Run Registry. There was no production navigation path to open the connected-resource surface with the granted Run. Command Center now retains the Run Registry link and adds a distinct **Connected resources** link whose query binds the exact active Run and Project. The focused route contract verifies escaping and identity binding; the same browser journey then reached the granted surface.

HTTP-backed Chrome evidence:

- Success fixture: exact Run `run_e59aa20c7cb445de9720d150b252b102`, `github/get_repository`, owner `AkeBoss-tech`, repo `opensaddle`. The UI rendered the fake adapter result (`default_branch: main`, `visibility: public`) and the Core broker receipt with request digest, response digest, and opaque credential lease. It explicitly rendered **Not artifact verification**.
- Broker denial: on that same discovered grant, repo selector `not-authorized` passed the declared syntax bounds but failed Core's exact-resource authorizer. The UI rendered `connector action denied by policy` and rendered no Read result or Broker receipt.
- Offline fixture: exact Run `run_c69e06a9f674405792a958fda11159e1` rendered `github · Offline · executor_offline`; no action or dispatch control was present.
- No-grant fixture: exact Run `run_7934c595153c4c16814c6db263d7b8a9` rendered `No connected-resource capability was granted for this Run`; no action or dispatch control was present.
- These are disposable fake-executor results. No live GitHub connectivity, OAuth, or provider credential is claimed.

Visual inspection used fresh CUA screenshots and accessibility trees at the exact routes. The available screenshot call returned image bytes for inline inspection but did not persist the requested path, so no filesystem screenshot is claimed.

Validation after the navigation fix: focused connector/navigation renderer and transport tests 16/16; typecheck passed; lint retained 19 pre-existing warnings; repository tests 311/311; production build and `git diff --check` passed.

Remaining M0/M1 acceptance gaps:

- Personal daily-use connected work still lacks a real installed provider/authentication journey; current proof intentionally uses a fake adapter.
- The connection shell still polls an unsupported `/api/health` compatibility route and emits misleading repeated “Task recovery unavailable” notices while v2 capability and connector requests are succeeding.
- Authoritative priority, Work items, recurring jobs, and Inbox remain server-declared unavailable, limiting the outcome/responsibility-first home.
- Package provenance/catalog activation is unavailable; the review application remains built-in and reports missing package provenance.
- Environment service definitions remain dormant configuration rather than supervised processes with observed health.
- KRAIL transfer/provenance integration, hosted/multiplayer behavior, and the generalized extension lifecycle remain outside this local acceptance.

### 2026-09-07 01:52 capability-negotiated recovery health

Browser red evidence on the real v2 fixture showed repeated “Task recovery unavailable” notices every reconciliation interval even though `/api/v2/capabilities`, Command Center, artifacts, commands, and connectors were healthy. The recovery owner was `RunRegistryProvider`: it always called the legacy runtime client's `listRuns()`, which first probed unsupported `/api/health`. The connection liveness owner also continued polling that legacy path after v2 negotiation.

The service bundle now records explicit conversation Run recovery support. A successful legacy `/api/health` preserves the existing recovery reconciler. A successful v2 capability negotiation with no legacy health marks conversation recovery unsupported, skips `listRuns()` entirely, emits one truthful notice for that server identity, and uses only `/api/v2/capabilities` for subsequent liveness checks. A reconnect/server identity change resets the notice. A disconnected/unknown server produces no unsupported-capability notice.

Browser green evidence: connecting to v2 fixture 8892 rendered exactly one `Task recovery unavailable — Conversation task recovery is not advertised by this v2 control plane.` notice. After eight seconds (multiple former poll intervals), it expired and did not recur. The server stayed Connected and the v2 application surfaces remained available. Switching fixture identity emitted one new notice, as intended.

Test discovery was also corrected. The previous `npm test` ran only `test/*.test.ts` (311 tests) and silently excluded the new mounted/model/transport suites under `src`. It now runs `test:workspace` plus `test:features`; the standard command passes 311 workspace tests and 28 feature tests. Focused recovery negotiation covers v2 suppression and preserved legacy support. Typecheck and production build pass; lint has the same pre-existing warnings and no new recovery dependency warning; diff check passes.

Concrete M0 Home dependency sent to Core: reuse command-center.v1 and project its priority from the single explicit ProjectGoalStore authority only when exactly one authorized active Goal is selected. Populate objective, criteria, status, and updated time from that Goal; project activity may combine authoritative Goal events and Run transitions. Keep next_action null until an explicit Goal metadata contract exists. Outcomes remain unverified absent a verification receipt; Work, recurring jobs, and Inbox may remain explicitly unavailable.

### 2026-09-07 02:04 Goal-backed M0 Home

Core's existing command-center.v1 projection now supplies `section_status.priority` with available/empty/ambiguous/unavailable and, when available, an exact `goal_revision`. Interface maps those fields without ranking projects or deriving next actions.

Test-first evidence: the new public client test sent all four server states plus Goal revision 7 to the existing `RemoteCommandCenterClient`. Before implementation it failed on the intended assertion because `priorityStatus` was undefined and the revision was dropped. After mapping, the identical test passed. Mounted presentation tests then cover revision replacement (7 to 8 without retaining 7), two-project ambiguity with no invented #1 objective, configured empty, and unavailable Goal authority.

Home now renders one explicitly selected active Goal with objective, exact Project/Goal identity, lifecycle, revision, updated time, and up to three acceptance criteria. Server reason codes `no_active_goal`, `multiple_active_goals`, and `goal_store_unavailable` are translated to clear nontechnical states. Project cards retain each authoritative objective and goal activity; `next_action` remains “No next action recorded” because Core has no next-action authority. Need Akash and exact links remain unchanged.

Browser proof used four disposable real HTTP projections:

- Available: objective “Ship the authoritative Command Center”, lifecycle Ready, exact Goal identity, revision 0, two criteria, Project link, zero human actions.
- Revised: the next server snapshot rendered the revised Goal identity, lifecycle Planning, and revision 1; revision 0 was absent.
- Configured empty: rendered “No active objective is recorded.” Priority was not listed as unavailable.
- Ambiguous two-project: rendered “Multiple active objectives exist. Home will not choose one without an explicit selection.” Both Project objectives remained navigable and neither was labelled priority.
- Earlier unconfigured 8877 proof remains valid: priority unavailable is listed as a capability gap.

No fixture is a production provider claim. CUA accessibility and rendered screenshots were inspected inline; the available screenshot mechanism still does not persist a filesystem path.

Validation: focused client/mounted Goal tests 6/6; standard `npm test` passes 311 workspace tests plus 32 feature tests; typecheck, lint, production build, and diff check pass. Lint retains only the repository's pre-existing warnings; Vite retains the existing chunk-size advisory.

### 2026-09-07 02:27 Goal create/revise loop (browser fixture pending)

Test-first red evidence: the mounted configured-empty Home test failed because no Project action existed (`No instances found with node type: "a"`). The identical test now passes and links the sole authoritative Project to **Create objective**. Ambiguous Home continues to expose the existing Project objective links without choosing a rank.

The connected Project page now mounts a small Goal editor against the typed Project Goal client. It records an objective and newline-separated acceptance criteria, renders the exact Goal id/revision after reads and writes, and explicitly says that saving direction does not start work. V2 uses `GET` for current/404-empty, `POST` to create, and `PUT` with `expected_revision` to revise. A 409 becomes a typed revision conflict; the UI retains the draft and offers an explicit **Reload latest** action. Denials retain the draft and render the server error. No Run, schedule, or renderer-side Goal authority is created.

Mounted tests cover create payload/no-execution language and exact-revision conflict with retained draft. Standard `npm test` passes 311 workspace plus 34 feature tests; typecheck and production build pass; lint retains the same 19 pre-existing warnings.

Core's disposable 8899 HTTP fixture completed the browser journey. Configured-empty Home linked exact Project `goal-proof`. The Project page initially failed as `Project not found` because the authoritative Command Center Project was not duplicated in the renderer's local workspace graph; the route now mounts the Goal editor from exact URL identity when the v2 Goal client is available and labels the Project by its server id. Owner create produced Goal `goal_b4fd930f0e8540d2a0fa134ea7537c4b` revision 0; Home immediately showed the objective and two criteria; owner revise retained that Goal id and advanced revision 1. An out-of-band fixture revision advanced the server to revision 2, after which the still-open revision-1 editor kept `Keep this local draft`, rendered the conflict, and offered **Reload latest**. Reconnecting as the Project member loaded revision 2, rejected a revision attempt with `project owner or admin role required`, kept `Member draft must not save`, and produced no revision 3. Command Center showed no active Run throughout.

Rendered screenshot evidence was inspected inline through CUA at the exact Project route after revision 1. The CUA surface did not persist a file path, so no saved screenshot path is claimed. Core has stopped the prior disposable 8891-8898 fixtures after Interface confirmed they were no longer needed; 8877 was left untouched.
### 2026-09-07 09:41 exact artifact across two Perspectives

Test-first red evidence: a new mounted public behavior test loaded one exact artifact and its durable invocation, then failed because the review application exposed no second Perspective (`assert.ok(evidence)` failed). The same test is green after adding keyboard-native Review and Evidence tabs to the existing registered review surface. Both presentations retain the exact Project, Run, artifact id, artifact digest, command descriptor, invocation id, receipt and unverified state; no copied resource or second renderer authority exists.

The Evidence Perspective adds a compact lineage projection for verification work. Switching presentation never reinvokes the command. A durable invocation for a different artifact/version/digest is explicitly stale. Artifact access errors distinguish revoked/denied from unavailable/not-found, and every load clears prior actionable resources immediately so an old Project result cannot remain usable while authority is rechecked. Mounted coverage proves exact cross-Perspective identity plus stale, revoked, unavailable and disabled-action behavior.

Real browser proof against the persistent 8877 fixture followed Command Center -> exact completed outcome -> Review workspace. Review and Evidence tabs showed artifact `art_575eb1ba0a87486d9a35bf97375f0693`, digest `bbbb…`, durable invocation `inv_9eb3b6bf4f6d47dbbf4d3c7e057b6504`, and **Not verified** without rerun. Desktop and narrow-window screenshots are saved at `docs/agents/evidence/review-evidence-perspective-desktop-2026-09-07.png` and `docs/agents/evidence/review-evidence-perspective-mobile-2026-09-07.png`. The narrow layout retains native tab semantics and the existing single-column breakpoint; CUA's tab viewport remained fixed while the host Chrome window was resized, so this is narrow-window rather than device-emulation proof.

Validation: standard `npm test` passes 311 workspace tests and 36 feature tests; typecheck, production build and `git diff --check` pass. Remaining #25/#32/#35 acceptance includes a second independently registered application consuming the resource ref, real KRAIL evidence/revocation invalidation, package-backed first/third-party conformance, clone/edit/reload attribution, and plugin teardown/recovery. These issues remain partial.
