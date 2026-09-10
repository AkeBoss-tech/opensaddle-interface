# Interface invariants

- **LOCAL-PROJECT-EMPTY-START-1** — A new Interface workspace contains no fabricated Projects, people, machines, Runs, or conversations. Local Projects appear only after the authoritative local service registers a user-selected folder and remain available after the service restarts.
- **AUTHORIZED-CONTEXT-INSPECTOR-1** — A Run Inspector shows only a currently reauthorized immutable launch packet whose packet, request, capability, Project, and Run identities match the admitted Run. Protected packet content is cleared before refresh and synchronously on authority, Project, or Run replacement; denial and malformed responses reveal only an unavailable state.
- **RUN-CANCELLATION-AUTHORITY-1** — An active Run offers cancellation only to its exact requester or a current Project manager. After Core records the request, authoritative refresh replaces the action with a pending-cancellation status.
- **PORTABLE-CONTINUATION-RECOVERY-1** — A current Project manager can continue a paused Run only from its current verified checkpoint to an explicitly selected Project machine. Interface durably records the connection-, caller-, Project-, and Run-scoped intent before submitting, replays that exact request after an ambiguous response or reload, and never replaces its target or idempotency key. A definitive client rejection clears the intent; server and transport ambiguity retain it. Portable continuation starts a new worker attempt and never claims to resume the provider's native session.
- **PROTECTED-COMMAND-RESULT-1** — A fresh protected command invocation clears the prior result before its authorization request begins. If current authorization denies the invocation, no prior result identifier, summary, receipt, or derived bytes remain visible; this does not claim idle revocation polling.
- **DESKTOP-RUNTIME-PACKAGE-1** — Desktop packaging requires a complete validated Core, Knowledge/KRAIL, and Python runtime whose manifest binds exact source revisions and wheel digests. Missing or malformed inputs fail before replacing a previously valid staged runtime; the installed smoke runs without a source checkout or inherited developer PATH.
- **PERSONAL-RUNTIME-AUTHORITY-1** — Interface exposes personal-runtime status and lifecycle controls only after exact v2 capability negotiation. Every mutation uses the displayed authoritative revision; rejection retains the readable prior state and attempts an authoritative refresh. Missing capability, unavailable Knowledge, stale readiness, and failed refresh remain explicit. Server-reported UI-independent ownership is not evidence that work survived an actual UI close.
- **PERSONAL-RUNTIME-COMMISSION-1** — Commissioning requires an existing authoritative local Project, an installed and ready harness with an exact executable path, and explicit bounded CPU, memory, and concurrency. Missing Projects, unavailable providers, malformed limits, and an unavailable desktop bridge cannot produce a launch request.

- **PERSONAL-DEVICE-INVENTORY-UI-1** — Personal device inventory is negotiated from owner-scoped Core capabilities, remains outside Project navigation, distinguishes metadata/pairing/contact from task permissions, retains exact registration intent across uncertain responses, and hides previous account/connection data on authority replacement. Owning UI/client journeys: `src/features/devices/DeviceInventory.test.tsx`. The HTTP adapter is controlled; the production client parsing and mounted UI remain real. This new surface has no pre-existing UI baseline.

- **PERSONAL-DEVICE-PAIRING-UI-1** — Pairing requires an owner-issued expiring challenge, a separate device claim, and an explicit exact-fingerprint match before confirmation. The consumed code is removed from the view, and unpair uses the displayed enrollment revision after a deliberate confirmation action. Owning mounted client/UI journeys: `src/features/devices/DevicePairing.test.tsx`; Core cryptographic proof is covered separately by its device enrollment and CLI tests.

## PERSONAL-DEVICE-ACCESS-UI-1

Owner policy proposals explicitly name audience, sources and adapters. Proposal does not implicitly accept project access. Acceptance uses the server-authenticated viewer role and the displayed revision. Revocation remains available when project context cannot be read. DeviceAssignments.test.tsx exercises the mounted component and actual transport client; Core test_device_assignments.py owns enforcement. New UI contract; existing pairing tests do not exercise assignment consent.

## PROJECT-DEVICE-REVIEW-UI-1

A project manager reviews another owner’s exact saved audience, sources, adapters and revision before accepting or removing project device access. Ordinary members receive no decision controls. Replacing the project invalidates its review and late responses. ProjectDevicesPage.test.tsx exercises the mounted view through the real transport client; Core owns authorization. This new project-side workflow is not covered by the personal owner editor tests.

## PROJECT-DIRECTORY-UI-1

Directory clients follow complete cursor pages, reject mixed viewer identities and stale local account responses, and do not return silently truncated data. projectDirectory.test.ts covers these transport contracts; browser evidence covers rail and device picker integration. Existing registration discovery does not cover projects without a checkout.

## PRESENTATION-EDITOR-1

PresentationEditor.test.tsx verifies that saving sends the displayed scope revision, preserves unedited Perspective keys, supports inheritance reset and disables further saves after a conflict until reload. Core test_presentation_settings.py owns authorization and persistence. Browser evidence covers effective theme and compact navigation application.

## PROJECT-PERSPECTIVES-1

Registered Dialogue and Dispatch surfaces consume the same immutable project task projection and route task opening through host callbacks. project/perspectives tests render both through PerspectiveHost and check identity, mismatch rejection and unavailable-preference fallback. Browser evidence verifies persisted selection after remount and canonical run navigation. Built-ins are trusted compiled code, not sandboxed third-party plugins.

PROJECT-DEVICE-REVIEW-UI-1 now includes a named-Team policy: the review identifies the Team and explicitly requires Project membership. The saved revision and acceptance/removal protocol stay unchanged. Team selection now uses the authenticated Team directory; existing policies can also be retained or changed to other audience types.

## TEAM-UI-1

Recipients must review and explicitly accept the displayed invitation revision before joining a Team. TeamsPanel.test.tsx exercises the mounted UI and actual transport client, controlling only external HTTP. Existing device tests do not cover invitation consent. This is a new surface, with no prior UI regression baseline. Browser verification separately covers Team creation, saved Team preferences after navigation, and a named-Team device proposal against disposable Core data; it does not prove real remote execution.

## PROJECT-TEAM-UI-1

TeamProjectReviews requires an explicit publication review before sending the displayed association revision. A conflict removes decision controls until reload. ProjectTeamSettings.test.tsx mounts the real client and UI with HTTP controlled at the external boundary. Standalone Team invitation tests do not cover project publication. New UI contract, no prior regression baseline. Browser verification on disposable Core data covered project proposal, Team acceptance, inherited light theme with Team provenance, and detach restoring default theme. Renderer and Electron builds passed; this is local browser/API evidence, not production or remote task proof.

## INSTALLED-PROJECT-VIEW-1

An installed project view receives only the host project projection. Exact renderer bytes and active frame identity gate messages; only projected task IDs can open host task details. InstalledProjectView.test.tsx mounts the real host and integrity reader with a controlled content response and frame adapter. Built-in Perspective tests do not cover executable packages. This is a new protocol, not a prior regression baseline. Signed-package loopback browser evidence proves discovery, rendering and persisted selection; it does not prove native desktop or live revocation behavior.

INSTALLED-PROJECT-VIEW-1 now requires current catalog authorization before honoring navigation. The identical mounted test failed against 4bd8d10 with an extra `updated:R` navigation after disabling the renderer; it passes with the gate. Baseline used an isolated git archive with the current test overlaid and shared dependencies; Core's pytest-only prove_regression.py does not accept this src-based TypeScript test. Browser proof disabled the signed fixture package through Core (201), observed an empty renderer catalog, then observed frame removal without refreshing. Evidence: out/screenshots/view-revocation-20260910/revoked.png. Two focused tests and renderer/Electron builds passed.

## INSTALLED-PROJECT-STATE-1

Installed project view state is schema/size validated and accepted only from the
ready, currently authorized frame. Tab persistence is scoped by server, principal,
Project, application instance and exact package/schema version. The mounted
InstalledProjectView test verifies save/remount restoration, invalid-state
rejection and scope separation. Storage failure is visible; no upgrade migration
or cross-device persistence is claimed.

## INSTALLED-PROJECT-MIGRATION-1

The mounted installed view receives migrated state only from an unambiguous
destination-declared schema migration within the same authority/application/package
scope. A visible notice accompanies transfer. Prior exact-package data survives
for rollback; missing migrations and other package IDs cannot import it. Covered
by InstalledProjectView.test.tsx and the applicationState interpreter suite.

INSTALLED-PROJECT-MIGRATION-1 also covers a same-schema-version package update:
the mounted destination gets prior state only for an identical validated schema
contract, independent of property order. Undeclared required-field changes and
tighter destination byte caps refuse transfer. The same mounted assertion fails
on e3d2d85; receipt: receipts/perspective-compatible-state-20260910.json.

## PROJECT-TASK-FEED-1

The host supplies every Project Perspective with a periodically refreshed,
Project/account/connection-bound task projection. A settled read schedules the
next after five seconds; unchanged data preserves object identity. A failed or
15-second-expired read removes the projection and its rendered children. Late
responses after a scope change or deadline cannot restore it. Requests never
overlap within one feed; an unresolved request requires eventual settlement or
an explicit workspace refresh. Timers are cleared on unmount.

`ProjectTaskFeed.test.tsx` exercises the mounted production feed with the Dispatch
surface and deferred Journey adapter responses. Timer advancement is deterministic
fault injection. This adds a live-feed boundary; the older static Perspective
checks only established navigation identity and did not cover status changes,
loss of access during polling, or hanging reads. The ten focused Perspective and
state tests pass. Browser evidence remains pending while the Mac is locked.

## INSTALLED-PROJECT-LIVE-1

An installed package opting into `projection` messages receives changed canonical
Project data in its initialized frame only after current exact-package authority
is confirmed. Nonce/generation/package fences remain fixed and each update has
an increasing positive revision. Removed tasks cannot be opened through old
frame messages. Revocation removes the frame without delivering new data.
Legacy init-only packages retain reload behavior. Mounted coverage is in
InstalledProjectView.test.tsx; baseline 29210a1 fails the no-reload assertion,
and the same test passes with the repair (receipts/perspective-live-20260910.json).

## DASHBOARD-EDITOR-1

Saved personal dashboard widget order determines rendered DOM order; hiding a
widget removes its content without changing permissions. Draft edits apply only
after a successful revision-checked save. Failed saves retain the draft. Account
or client replacement hides old layout immediately and fences late saves. Missing
widget IDs render unavailable placeholders, never executable code. Covered by the
mounted CommandCenterSurface journey and DashboardSettingsClient adapter tests.
Baseline 4a334a5 fails the saved-order assertion; the identical test passes with
the editor. Receipt: receipts/dashboard-editor-20260910.json. Browser keyboard and
visual checks remain pending while the Mac is locked.

## MANAGER-SCOPE-UI-1

The manager scope chooser lists current membership-directory entries, begins with
no selection, and previews only the explicitly selected IDs (up to 32). Selection,
account or client changes remove old context and fence delayed responses. The
client rejects broadened scope, extra payload fields, invalid bounds and execution
authority claims. Truncation and unverified outcomes remain visible, and preview
starts no tasks. Covered by mounted ManagerScopePanel and ManagerContextClient
adapter tests. A live disposable Core/Interface-client HTTP check also passes:
receipts/manager-context-client-20260910.json. Browser verification remains pending.

## MANAGER-CONVERSATION-UI-1

The landing-page manager can create/reopen owner-private conversations, save user
messages and explicitly apply Project selections to future messages. Failed writes
retain the draft; changing checkboxes alone does not edit conversation scope.
Saved messages remain distinct from provider execution. Account changes clear old
content; client intent creation must not submit after identity changes. Pagination
has finite limits and refuses repeated cursors. Mounted UI and client checks pass.
Actual client-to-Core HTTP verification lost one post-commit response deliberately,
recreated the client and retried without a duplicate, then preserved old/new scope
revisions and denied another owner. Receipt:
receipts/manager-conversation-client-20260910.json. Browser checks remain pending.

## PROJECT-TASK-COMPOSER

Every Project Perspective's New task host action opens the project-bound task
composer. The focused surface reuses the existing Journey delegation form and
source/adapter/context validation without showing invitation, machine enrollment,
or capacity configuration. Failed submission preserves the draft; successful
submission clears it and reports submission, not execution completion. Mounted
ConnectedJourneySurface tests exercise these behaviors. The baseline renders the
old setup heading; the identical new test passes after the change. See
receipts/project-task-composer-20260910.json. Native/browser proof is pending.

## PROJECT-TASK-DETAIL

Project Perspective task opening uses a host-owned, Project/Run-bound route. The
shared authoritative detail surface rejects mismatched Run or Project identities
before rendering task text or action controls, while preserving the workspace
return route. Existing global Run navigation remains compatible. Mounted tests
cover scope mismatch, identity substitution, normal cancellation, lost access and
late replacement responses. The identical substituted-identity assertion fails on
the baseline and passes after the repair; see receipts/project-task-detail-20260910.json.
Browser/native proof remains pending.

## PROJECT-TASK-RESULT

Completed non-coding tasks show a published text artifact in the shared task page.
The real Journey/MalleableShell reader bounds UTF-8 bytes and verifies SHA-256;
the Journey reader checks the same authenticated account and Run/Project after
content arrives. The panel renders text literally and removes it on failed access
or integrity checks. Reads are sequential, every five seconds after settlement,
with a fifteen-second display deadline. This is neither a full transcript nor a
correctness or acceptance judgment. TaskResultJourney.test.tsx mounts the real
client and surface with only HTTP substituted. It verifies literal text, corrupt
bytes and account replacement; the baseline result-display assertion fails. See
receipts/project-task-result-20260910.json. Browser/native verification is pending.

## PERSPECTIVE-DISPATCH

Bundled Dispatch and the generated independent renderer classify provisioning and
verification as Working, and paused/approval waits as Needs attention. Finished
execution remains separate from verification. The mounted builtins suite checks
canonical task navigation and these lifecycle groups. Core's generated-script
protocol/signature evidence is recorded in perspective-dispatch-renderer-20260910.json
in the Core repository. New-column browser/keyboard proof remains pending.

## UI-HOST-CONTRACT

An incompatible signed UI declaration is excluded from Project view discovery and
cannot trigger renderer content loading. Current catalog reauthorization also
checks compatibility. The mounted InstalledProjectView test proves zero byte
requests for a future API and checks compatible, missing-capability and wrong-scope
selection. Existing legacy mount tests remain valid. The baseline performs a byte
request and fails the identical assertion. See receipts/ui-host-contract-20260910.json.

## MANAGER-DISPATCH-UI

Saved manager messages expose child dispatch only when Core advertises it and the
Journey service is present. Users explicitly select a current-scope Project,
source and ready native agent. Opening the controls never dispatches. The client
sends saved message identity and selected arguments, not replacement text or owner
claims. A pending request blocks repeated submissions and closing its controls.
Task links preserve canonical Project/Run identity. Status refreshes clear failed
reads; the existing server retry identity survives client recreation. Mounted
controls/client tests pass, with baseline absence proved in
receipts/manager-dispatch-ui-20260910.json. Real HTTP response-loss/retry and outsider
denial are recorded in receipts/manager-dispatch-client-20260910.json. Browser and
native execution from this manager UI remain pending.


## MANAGER-DASHBOARD-INDEPENDENCE

Unavailable, failed or refreshing dashboard projections must not unmount an
authorized manager conversation or discard its draft. The independent conversation
capability works without context preview. Disconnect must hide private content and
fence late projection reads. Verified through reopening and saving a message in
`CommandCenterPage.mounted.test.tsx`; receipt:
`receipts/manager-dashboard-independence-20260910.json`.


## PROJECT-WIDGET-DASHBOARD

Personal widget placement must persist through the existing owner layout API,
load no code before saving, and resolve only current Project widget catalogs.
The mounted frame receives only its own Project tasks; revocation prevents further
navigation and removes the frame. Unavailable placement survives reload. Other
Projects are not fetched merely because they appear in the directory. See
`receipts/project-widget-dashboard-20260910.json`.
