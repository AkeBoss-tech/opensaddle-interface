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


## WIDGET-OVERVIEW-INDEPENDENCE

A missing, failing or refreshing overview projection must not unmount independently
authorized Project widgets. Old overview content must clear; widget revocation
must still remove its frame. The mounted round-trip test and
`receipts/widget-overview-independence-20260910.json` cover these boundaries.


## PROJECT-TASK-FEED

Project task presentation can load under current non-owner membership without
global or administrative projections. Only the selected Project is returned;
revocation, account changes and invalid pagination fail closed. Execution status
does not imply result acceptance. Before/after receipt: `receipts/project-task-feed-20260910.json`.


## DEFAULT-PERSPECTIVE-SETTINGS

Scoped editors expose supported default views, exclude widget mounts, preserve
other appearance keys and remove only the view key when returning to inheritance.
The public mounted editor regression and `receipts/default-perspective-settings-20260910.json`
verify selection and persisted request behavior without implying plugin activation.


## RENDERER-SETTINGS-EDITOR

Signed plugin declarations generate host-owned fields. Private overrides must save
with their exact Project, package and expected revision, inherit shared defaults
when removed, and retain drafts on conflicts. Shared settings respect read-only
roles. Unsupported declarations are excluded; invalid values, changed identities,
package substitutions and inconsistent effective values are rejected.
`src/features/settings/RendererSettingsEditor.test.tsx` exercises mounted catalog
forms through the real HTTP client with transport responses injected. This is a
new feature; no missing-module baseline is represented as regression evidence.


## RENDERER-SETTINGS-DELIVERY

Installed Project views receive current exact-package resolved preferences on
initialization and sequenced settings messages. Shared/private storage metadata
and credentials never enter that payload. Authorization loss removes the frame;
updates preserve it. Generated board/dialogue plugins apply card limits and
finished-task visibility, ignoring stale or incorrectly framed messages.
See `receipts/renderer-settings-delivery-20260910.json`; generated JavaScript runs
against a minimal DOM adapter, not a browser rendering acceptance test.


## RENDERER-SETTINGS-LIVE

The generated editor, actual HTTP settings client, mounted host, and signed plugin
JavaScript must agree on a saved private override. Resetting it restores inherited
behavior; another member's preferences stay private, shared writes respect roles,
and removing the configured plugin removes its frame.
`node --import tsx scripts/prove-renderer-settings-live.tsx STATE_DIR RECEIPT_PATH`
runs against Core's disposable `dev_project_perspective_fixture`. It removes that
fixture's selected environment. No injected HTTP responses or replacement settings
store are used. A minimal DOM/message adapter is used instead of a browser.
Receipt: `receipts/renderer-settings-live-20260910.json`.


## RENDERER-SETTINGS-SCOPES

Signed plugin user defaults apply across Projects privately; accepted Team defaults
apply only while two-sided association authority remains current. Resolution is
signed defaults, user, accepted Team, Project, then private Project overrides.
Team writes require Team manager membership plus exact Team/association revision;
stale pages cannot target a replacement association. Cross-Project persistence,
private isolation, role denial, precedence, detach and CAS are verified through
the signed-package API and mounted editor. Receipt:
`receipts/renderer-settings-scopes-20260910.json`.


## STANDALONE-PLUGIN-EDITOR

Personal and Team plugin forms must use standalone routes, preserve revisioned
drafts on conflicts, hide previous-account data and reject a substituted Team
directory. Team read-only roles disable edits. No iframe or Project data service
is needed. `StandalonePluginSettings.test.tsx` mounts the real form and HTTP
client with transport responses injected; Core separately verifies the real
authority/storage API. This is a new UI surface, so missing-module baseline
failures are not counted as regression evidence.


## PROJECT-VIEW-RECOVERY

Reported installed-view failures must notify the host and restore the built-in
view only after new Project authority/data reads. Recovery does not overwrite
the saved package preference; explicit refresh retries it. Revoked Project access
clears protected content. The mounted workspace uses real clients with transport
responses injected. Baseline proof covers the existing frame failure callback:
`receipts/project-view-recovery-20260910.json`. This does not prove detection of
every post-ready runtime hang/crash.


## PROJECT-DIALOGUE

Dialogue must create/read/save anchored Project conversations through Project
routes only. The client checks current and historical scopes, excludes scope
edits and rejects cross-Project task operations before sending. UI omits internal
Project switching, clears revoked content, and uses digest-checked result routes.
Existing global manager idempotency namespaces remain unchanged. Receipt:
`receipts/project-dialogue-20260910.json`; mounted/client tests inject only HTTP
transport, while Core separately verifies durable storage and admission.


## PROJECT-CONVERSATION-NAVIGATION

Selecting or creating a Project conversation stores its ID in the Project URL.
Dialogue restores it only after the authorized conversation directory confirms
the ID. Switching Perspectives preserves selection and host-owned unsaved text;
a workspace remount restores saved messages but discards memory-only drafts.
Conversation work disables the view selector and workspace refresh while pending.
The mounted workspace regression fails on the previous revision at the missing
URL assertion. Receipt: `receipts/project-conversation-navigation-20260910.json`.

## PROJECT-SOURCE-SDK

An installed view may explicitly request bounded source metadata only when its
signed UI contract requires `read.project-sources.v1` and accepts `resources`
input. The host fixes the Project and checks package authorization before and
after the read. The existing member-only source endpoint is the authority;
frames receive only validated IDs, labels, kinds, revisions and snapshot digests.
A denied/invalid read clears the frame; changing principal or Project rejects
stale data. Mounted tests use the real HTTP client and inject transport only.
Receipt: `receipts/project-source-sdk-20260910.json`. Task-only tests did not
cover resource reads, metadata filtering or revocation during this additional
read boundary. Snapshots are limited to 100 items and do not claim completeness.

## PROJECT-DEVICE-SDK

Installed views with signed `read.project-devices.v1` capability may read only
the mounted Project's bounded device assignments. Personal inventories, owner
identities, selected subjects and credentials are never forwarded. Assignment
consent is copied from Core and must never be represented as task admission or
machine connectivity. The projection explicitly says `task_admission:
not_evaluated`, including when consent is true. Malformed, duplicate, oversized,
cross-Project and contradictory records are rejected. Mounted tests use the real
HTTP client; existing source SDK tests cover the shared reauthorization/failure
path. Receipt: `receipts/project-device-sdk-20260910.json`.

## PROJECT-VIEW-RUNTIME-FAILURE

Installed Project frames include a host error bridge before package markup.
Uncaught error/unhandled rejection events produce one generic failure envelope;
startup failures wait for initialization identity. Only the exact active frame
can fail its generation. Failure removes the frame, notifies the workspace for
fresh-authority fallback, and prevents subsequent navigation. Raw diagnostics
are not forwarded. Mounted/VM bridge proof is recorded in
`receipts/project-runtime-error-20260910.json`. Earlier load/ready failure checks
could not catch errors after readiness. Frozen loops and OS/browser process
crashes remain outside this evidence.

## RUN-APPROVAL-UI

The host task page offers review only through the advertised server-bound Run
admission capability. A user explicitly loads the exact task/source/requester and
policy before a digest-only approval request. Repeated clicks cannot duplicate
an in-flight decision; failed/stale reviews are cleared and must be loaded again.
Current non-approvers have no approval button. Successful approval refreshes
canonical task status; cross-identity or mismatched responses are rejected.
Mounted task-page/client evidence: `receipts/run-approval-ui-20260910.json`.
The baseline includes the new client only to avoid a missing import; it fails at
the unchanged page's missing review control. Native visual verification is pending.

### RUN-APPROVAL-UI live transport evidence

`receipts/run-approval-live-20260910.json` records the mounted task host and real
approval/journey clients against isolated Core over HTTP. A reader cannot grant,
a reviewer admits one task, a recreated client sees durable state, and demotion
after displaying a second review denies its submission and removes the control.
Fresh repository inspection finds exactly one review decision and no model-call
leases. `scripts/prove-run-approval-live.tsx` uses the separately started Core
`dev_run_approval_fixture`; it never installs workers. This is not browser proof.

The settings live proof now executes every script in the generated host document
in one VM context and retains all event listeners, including the host runtime
error bridge. `receipts/renderer-settings-live-runtime-bridge-20260910.json`
records all nine settings checks passing with this current document structure.


## PROJECT-CONTEXT-UI

Context must start unchecked and require explicit selection after explaining
Project task visibility. Default wire requests remain unchanged; opted-in
requests carry only the flag, not caller-built history. Unsupported/global
clients reject the mode, and pending dispatches restore and lock their original
choice. Mounted real-client proof: `receipts/project-context-ui-20260910.json`.

### PROJECT-CONTEXT-UI native execution evidence

`receipts/conversation-context-native-20260910.json` records two real Codex tasks:
a generated code and its exact recall by the contextual follow-up. Real Core
admission includes the first output and artifact identity; distinct provider
sessions both terminate completed. Retry retains the second Run. This uses real
HTTP/client/worker/artifact paths, not a provider fixture. Cleanup verifies stopped
processes, revoked fixture worker credentials and an unchanged empty workspace.
It is not browser proof, provider-session resume or device-policy requalification.


## CONVERSATION-LIVE-PREVIEW

An active saved-message task may render unverified Core output only after its
conversation/message/Project/Run binding is confirmed. The reader validates Run
identity, event order, lease/worker identity, chunk order and bounded UTF-8 size.
Text renders as text. Invalid or ended streams clear previews, account changes
stop delivery, and closing the message cancels the reader. The final result panel
continues to use the artifact/digest path. Mounted tests use the real client with
a Core stream fixture; receipt `receipts/conversation-live-preview-20260910.json`
records an actual pre-change assertion failure. Real-provider streaming and
browser visual acceptance are separate remaining gates.


Native follow-up for CONVERSATION-LIVE-PREVIEW: Core starts durable SSE events at
sequence zero. The reader must accept this metadata event before output chunks.
`receipts/conversation-preview-zero-sequence-20260910.json` reproduces the actual
native-run failure against the prior Interface head and verifies the repair.
`receipts/conversation-stream-native-20260910.json` verifies real Codex/Core SSE
through the mounted host: 99 rendered updates while running, 621 ordered chunks
before final publication, matching digest-checked output, and explicit cleanup.
This is not a browser visual or keyboard acceptance result.


## PROJECT-APPROVAL-SDK

Signed approval-reading views receive only pending Run admission metadata from
the mounted Project, after paginated task/membership reads and package rechecks.
The queue cannot grant approvals or expose policy bodies/credentials. Existing
host task navigation leads to exact review. Mounted/client tests prove pagination,
field filtering, foreign Project rejection by host binding, unsupported grant
requests and package revocation during read. Receipt:
`receipts/project-approval-sdk-20260910.json`. This is bounded discovery, not live
approval cursors or tool/model-call approval support.


## PROJECT-VIEW-RESPONSIVENESS

A ready installed frame must respond to current fenced host challenges. Missing
responses trigger removal/recovery; stale and late responses cannot keep or revive
the frame. Hidden windows suspend this check. Mounted tests execute the injected
bridge, control timers and deliberately omit message delivery; they do not freeze
a real browser process. Receipt: `receipts/project-view-responsiveness-20260910.json`.


## PROJECT-RESOURCE-SUBSCRIPTIONS

Signed resource subscriptions retain the frame, deliver bounded authorized full
snapshots with per-subscription cursors, suppress unchanged data, support explicit
resync, and stop in-flight delivery on unsubscribe/revocation. At most three may
be active. Mounted tests use the real client and controlled Core responses/clock;
receipt `receipts/project-resource-subscriptions-20260910.json` includes baseline
assertion evidence. This is not durable server event replay or browser proof.


Live PROJECT-RESOURCE-SUBSCRIPTIONS evidence:
`receipts/project-resource-subscriptions-live-20260910.json` exercises actual signed
plugin JavaScript and real Core reads/approval/source mutations through the mounted
host. Same-frame updates, resync, unsubscribe and environment revocation passed;
fixture server stopped and Runs are terminal. Device assignments were empty.
This is a DOM-adapter integration proof, not browser visual/keyboard acceptance.


## PROJECT-COMMAND-SDK

Installed views may discover typed artifact-read commands and exact artifact refs,
then invoke only the current descriptor against a projected Run in the mounted
Project. Core retains input/authority validation. Duplicate in-flight calls do not
repeat, and post-call package revocation withholds the bounded receipt. Mounted
client/transport evidence and baseline assertion are recorded in
`receipts/project-command-sdk-20260910.json`. Actual signed command integration,
write/execute expansion and browser verification remain separate work.


Live PROJECT-COMMAND-SDK evidence:
`receipts/project-command-live-20260910.json` compares actual signed plugin and
built-in client commands against real Core and checks durable receipt readback.
The walkthrough found that receipt.resource_digest hashes canonical ResourceRef
JSON. `receipts/project-command-resource-digest-20260910.json` proves the repair
against the prior implementation. Sixteen focused checks/build pass; both fixture
servers stopped and Runs are terminal. Browser visuals remain unverified.

PROJECT-VIEW-RECOVERY also restores focus to the fallback notice when frame
removal leaves the document body active. It must not steal focus from another
host control. Mounted DOM-adapter baseline evidence is recorded in
`receipts/project-view-focus-recovery-20260910.json`; browser keyboard acceptance
remains separate.

## PROJECT-VIEW-SCOPE

Project changes remount the workspace state boundary. Recovery of a failed
package in Project P must not suppress the same package selected in Project Q.
Pending Q authority reads show neither P tasks nor P recovery state, and Q must
load its own authorized package bytes without rewriting either preference.
The mounted workspace test uses real clients with a delayed Q HTTP response.
Baseline assertion and repaired run: `receipts/project-view-scope-recovery-20260910.json`.

PROJECT-VIEW-SCOPE applies equally to account and connection changes. The host
mount key includes the presentation client's connection/subject scope and current
identity. A failed package under one principal or Core connection cannot suppress
the next scope's selected package. The shared three-transition test replaces the
Project-only case; `receipts/project-view-identity-recovery-20260910.json` records
real pre-fix failures for account/connection transitions and repaired passes.

## STANDALONE-PLUGIN-ENROLLMENT

Personal and Team settings expose an explicit exact-reference setup form without
Project navigation. The client submits one POST with signed package coordinates,
application ID and empty presentation overrides; duplicate clicks cannot repeat
creation. The response must bind the current subject and Team, exact contribution
and initial revision. Account changes withhold the response. After any failure
the form requires directory reload rather than blindly retrying creation.
Mounted real-client evidence and pre-feature missing-form assertions are in
`receipts/standalone-plugin-setup-form-20260910.json`. Core authority is separately
covered by its signed-catalog HTTP test. Live combined and browser proof remain open.

STANDALONE-PLUGIN-ENROLLMENT now has live Core HTTP and mounted production
form evidence in `receipts/standalone-preferences-live-20260910.json`. The
walkthrough enables overrides, waits for the actual completed editor state,
checks fresh-client reads, duplicate rejection and member write denial. Separate
database inspection confirms revision-2 layers and zero package enablements.
Both disposable servers were stopped. This is not browser visual proof.

PERSONAL-DEVICE-INVENTORY-UI-1 requires every listed or newly registered device
to match the current account, including a uniformly wrong-owner page. The mounted
UI must neither display that device nor confirm registration. Real-client fault
injection and baseline assertions: `receipts/device-owner-response-20260910.json`.
This client defense does not imply the server returned foreign data in production.

## DEVICE-ACTIVITY-UI

Personal inventory explicitly opens bounded owner-bound activity. Agent reports
distinguish expired/current observations from task permission. Active Core Run
links preserve exact Project and Run identity without claiming process liveness.
Closing/unmounting stops polling; access failures clear prior activity. Response
parsing rejects substituted owner/device identity and invalid, duplicate or
over-limit rows. Mounted client/UI baseline: `receipts/device-activity-ui-20260910.json`.
Combined live and browser acceptance remain separate.

DEVICE-ACTIVITY-UI combined evidence is recorded in
`receipts/device-activity-live-20260910.json`: live Core with a signed disposable
device binding and real lease, mounted inventory showing its exact Run, automatic
refresh after consent withdrawal and unpair, and fresh-client verification.
Independent database inspection confirms terminal/unassigned work and revoked
consent/enrollment. No native provider was launched; the fixture server stopped.

DEVICE-ACTIVITY-UI also expires readiness independently of HTTP completion and
clears a snapshot after 15 seconds without a successful refresh. A stalled read
cannot retain active task links indefinitely; closing prevents its late response
from scheduling another poll. Controlled clock/HTTP fault injection and baseline
assertion proof: `receipts/device-activity-expiry-20260910.json`.

## DEVICE-CONSENT-EXPIRY-UI

Owner controls distinguish keeping, setting and explicitly removing a consent
deadline. Keep omits the field; setting serializes local input to exact UTC;
removal sends null. The server response must confirm that deadline. Both owner
and Project review show the saved timestamp, never interpreting an older server's
missing field as indefinite consent. Mounted baseline assertions and repaired
checks: `receipts/device-consent-expiry-ui-20260910.json`.

## DEVICE-CONSENT-IDLE-EXPIRY

An open owner policy and Project acceptance review must update when the saved
consent deadline passes without user interaction or an HTTP response. Expired
consent cannot retain active wording or submit acceptance from a stale handler.
Revocation and decline remain available. `ConsentExpiry.test.tsx` exercises both
mounted production views with the real client and controlled Date/timers.
Baseline receipt: `receipts/device-consent-idle-expiry-20260910.json`.

## DEVICE-OWNER-RESOURCE-UI

Owners explicitly keep, set or remove assignment resource limits. Saved limits
appear exactly in Project review; invalid integers disable proposal and omitted
server confirmation cannot be treated as a successful limit change. Mounted
owner/manager journeys use the real client with HTTP fixtures. Baseline receipt:
`receipts/device-owner-resource-ui-20260910.json`.

## DESKTOP-LOCAL-RECONNECT-1

If initial API discovery fails, the desktop retries local health as well as v2
capabilities. A late local onboarding server becomes connected and hydrates its
registered Projects without a reload. An established v2-only connection retains
its authenticated v2 probe. The mounted store test uses a real loopback server
and controlled retry timer. Receipt: `receipts/desktop-local-reconnect-20260910.json`.

## DESKTOP-RUNTIME-SETUP-1

A connected local onboarding server without Command Center offers personal
runtime setup, not an ineffective data retry. A disconnected or incompatible
server offers connection settings. The setup request permits only the current
personal runtime's supported concurrency of one. Mounted home states and request
validation are covered by `receipts/desktop-runtime-setup-20260910.json`.

## DESKTOP-PERSONAL-LAUNCH-1

The desktop production commissioning path can launch the real Core personal
runtime, receive its private handoff, adopt the same identity, read authenticated
Command Center data and observe a ready native worker. Unauthenticated dashboard
reads are rejected. `scripts/prove-personal-runtime-launch-live.ts` checks these
boundaries with isolated temporary state and stops its process group afterward.
Receipt: `receipts/personal-runtime-launch-live-20260910.json`. This is launch and
readiness evidence, not task execution or a visual desktop walkthrough.

## DESKTOP-PERSONAL-TASK-1

The optional `--task` mode of `scripts/prove-personal-runtime-launch-live.ts`
creates a disposable Git repository, commissions the real personal Codex worker,
submits an explicitly bounded single-file task through `RemoteJourneyClient`,
and reads its artifact through `CodingResultReviewClient`. Execution and exact
verification must complete, the patch must contain the expected change, and the
result remains unapproved. Receipt: `receipts/personal-runtime-task-live-20260910.json`.
This checks the real protocol/client journey, not visual interaction, streaming
presentation, native session resumption, or a human approval decision.

## SCOPED-RENDERER-TRANSPORT-1

The production shell exposes user/Team renderer selection, signed content and
host reporting without synthetic Project identities. The real Core fixture and
`scripts/prove-scoped-renderers-live.ts` verify exact references, stale revision
rejection, account fences, Team manager selection, member hosting, cross-subject
report rejection, disablement and built-in recovery. Receipt:
`receipts/scoped-renderer-transport-20260910.json` includes an actual baseline
assertion failure. This is client/server evidence, not a mounted executable view
or a visual desktop acceptance. Settings list the scoped catalog and retain the
server's explicit display-support limitation.

## LOCAL-DISCOVERY-ADMISSION-1

Agent discovery and Project rescans share a bounded queue in the authoritative
local client, coalescing identical concurrent requests and releasing admission on
failure. Slow startup discovery must leave browser connections available for
health and navigation. Discovery HTTP requests have a 60-second bound. The real
loopback transport test delays discovery and fails one scan; the before/after
receipt records nine simultaneous requests reduced to one, duplicate read
coalescing, and continuation after failure. This is admission evidence, not an
OS resource cap or a claim that all provider probes finish within that deadline.

## DESKTOP-WORKSPACE-DISCOVERY-1

The adopted-runtime proxy permits the production Project directory's bounded
100-item cursor query and explicit manager context preview. Arbitrary extra query
parameters, malformed cursor encoding and execution suffixes stay rejected.
Main-process credentials remain private. The receipt records the actual pre-fix
assertion, owning tests and an actual desktop restart, adopted directory and
manager preview. This does not establish complete Project workspace transport.

## DESKTOP-PROJECT-CONVERSATIONS-1

The personal desktop proxy carries Project task-feed pagination, presentation
preferences, renderer discovery, and private manager/Project conversation
creation, reads, messages, scope updates and explicit dispatch/result operations.
Only named routes and bounded page queries are accepted. Core retains scope,
revision and execution authorization. The receipt records actual desktop
conversation persistence and dispatch to the real Codex worker. Buffered IPC
is not evidence of live streaming support.

## DESKTOP-PERSONAL-DEVICES-1

The adopted desktop proxy admits bounded personal inventory, activity, owner
pairing/confirmation/revocation and Project consent routes, while rejecting
unbounded queries, credential paths and client claim routes. Core enforces owner,
proof and revision requirements. Actual desktop inventory registration must not
claim pairing, connectivity or Project access. The receipt distinguishes that
observed journey from transport-only coverage of pairing and consent mutations.

## DESKTOP-SCOPED-VIEWS-1

The adopted desktop transport admits exact user/Team renderer lifecycle requests,
retains the desktop-owned account credential, and forwards a bounded renderer host
report token only to scoped observation endpoints. Content requests require all
seven reference fields without duplicate or extra query parameters. Core remains
authoritative for membership, enablement, revision and report-session checks.
Regression: scoped clients work over HTTP while desktop IPC blocks their routes
or drops the report credential. Covered by `test/scopedDesktopTransport.test.ts`
and `scripts/prove-scoped-desktop-live.ts` against a disposable real Core.
These checks do not prove Electron IPC delivery, iframe mounting or visual state.

## SCOPED-HOST-1

Explicit user/Team selection mounts only exact signed content authorized for the
current environment. The opaque sandbox receives scoped metadata without tokens
or fabricated Project context. Source/nonce/generation/package fences gate ready
messages. Host reports revalidate authority every five seconds; failure or loss
of selection removes the frame while parent recovery controls remain available.
Only signed views requiring no additional SDK capabilities are accepted currently.
`script` capability requirements are not silently treated as implemented.

`scripts/prove-scoped-host-live.tsx` exercises the real settings component and
scoped client against real Core for both scopes. Only the browser frame messaging
boundary is simulated. It verifies selection, ready reporting, revocation, default
recovery and listener cleanup. This new host slice has no prior implementation;
no baseline assertion is claimed. Actual browser execution, full-page placement,
state persistence, responsiveness monitoring and owner-device SDK remain separate
acceptance work.

### SCOPED-HOST-1 — full workspace placement

The personal Home route and `/teams/:teamId` use the selected scoped view as
main content. Host-owned view settings, local default escape and durable reset
remain outside the iframe. Local escape must not mutate a shared Team selection.
Failure/revocation restores default content, and retry can remount the selection.
The real-Core component proof now also checks replacement, local escape with
unchanged authoritative selection, retry and full-page revocation recovery.
Current rendered browser behavior remains a separate acceptance check.

### SCOPED-HOST-1 — real browser execution

Manual CUA browser verification used `scripts/scoped-workspace-browser.html`
and the production scoped components against Core's signed executable fixture.
The plug-in acknowledged initialization and updated a counter on click/Enter;
selection survived reload, local escape restored defaults and Core disablement
removed the Team frame. Screenshot/limitation receipt:
`docs/testing/receipts/scoped-browser-20260910.json`. This unstyled harness is not
packaged Electron or complete application visual acceptance.

## SCOPED-VIEW-STATE-1

Scoped presentation state is local convenience, not authority. Its key includes
server/account, scope kind/ID, package version/manifest, application/instance and
schema version. The host accepts state only from its fenced ready frame and
revalidates its Core session before writing. Restores and writes validate the
signed bounded schema and 8192-byte maximum; corrupt/denied storage is tolerated.
Exact-package state survives remount/reload; automatic cross-version migration
is not implemented by this slice.

Evidence: storage-boundary `src/perspectives/scoped/state.test.ts`; expanded
real-Core component journey `scripts/prove-scoped-host-live.tsx`; real CUA browser
reload showing the counter retained in `out/screenshots/scoped-state-20260910`.
This is a new persistence feature, so no pre-fix regression failure is claimed.

### SCOPED-VIEW-STATE-1 — declared upgrades and rollback

When an exact-package record is absent, the host may restore the prior state
for the same server/account/scope/package/application/instance only if the new
candidate declares acceptance of that schema version. Different versions require
one matching declarative migration through the shared bounded migration engine.
Equal versions require identical schema declarations. Exact package records take
precedence, preserving rollback state. Prior metadata is bounded and validated.
The storage-boundary regression covers both user/Team scopes, declaration denial,
ambiguous migration denial, account/package isolation and exact rollback. This
uses candidate metadata fixtures, not a signature-verification or live-upgrade
proof; signed-package UI upgrade remains separate acceptance work.

## SCOPED-HOST-LIVENESS-1

After readiness, the scoped host probes its frame every five seconds. A matching
source/nonce/generation/package envelope and unique request ID must return within
three seconds. Missing or stale replies remove the view and retain parent recovery
controls. Probe/deadline timers and listeners are cancelled on failure or unmount.
Failure reporting may complete after frame removal only for the same authenticated
account; Core still validates the original scoped session.

`scripts/prove-scoped-liveness-live.tsx` runs the production component against real
Core with a simulated renderer peer and real timers. It tests a responsive peer,
then silence with repeated stale pong messages, fallback and the Core error
receipt. The original implementation failed the silent-frame removal assertion.
This does not prove recovery when JavaScript blocks the parent/browser event loop;
process isolation and packaged desktop termination remain separate release checks.

## OWNER-DEVICE-SDK-1

A signed personal view declaring owner device reads receives only its authenticated
owner's bounded inventory projection. Team scope cannot use the capability.
Activity additionally requires the activity capability and a device delivered
to that frame. Host-session authorization brackets reads and account changes
prevent delivery. Payloads omit credentials and retain task-authority uncertainty.
Only one resource request is in flight; known device IDs are bounded at 200.

`scripts/prove-owner-device-sdk-live.tsx` runs production host/services against
real signed Core fixtures with owner and outsider inventory. It verifies inventory
isolation, Core denial of outsider activity, no bearer in frame payloads, explicit
activity selection and cleanup. Only iframe messages are simulated. This is a new
SDK capability, not a preexisting bug; no baseline failure is claimed.

### OWNER-DEVICE-SDK-1 — browser walkthrough

A signed executable personal view requested inventory only after Refresh devices,
showed the sole owner device, then requested that device's activity with Enter.
It preserved unpaired/unknown connection and authority/termination uncertainty.
The independent outsider device was absent. The Team fixture mounted without
personal inventory controls. Receipt: `owner-device-sdk-browser-20260910.json`;
evidence is from an isolated production-component harness, not packaged Electron.

## DESKTOP-READOPTION-1 — pending requests belong to one adoption

A desktop HTTP response may be delivered only while its exact runtime adoption
is current. Re-adopting another account/runtime and then returning to identical
identity values must still reject the old response. This closes an A→B→A hole in
value-based identity comparisons during reconnect/account transitions.

Boundary: `src/services/personalRuntimeTransport.test.ts`, production fetch
transport with the external Electron IPC response held pending. On pre-fix
`eabf78f`, the new regression failed with `Missing expected rejection`; the same
test passes after adoption-reference fencing. Existing tests cover credential
ownership, a direct identity switch and abort behavior. This is transport evidence,
not a desktop disconnect walkthrough.

### DESKTOP-READOPTION-1 — dispatch after asynchronous request bodies

Cancellation or re-adoption while a POST body is being consumed must prevent
IPC dispatch, not merely reject the eventual response. The public fetch test
uses a real delayed ReadableStream for both transitions. On `52e43cf`, both
cases dispatched once instead of zero; the identical cases pass after the
pre-dispatch check. Abort also races body consumption, and the transport removes
its abort listener when the request settles. An abort after IPC dispatch still
does not promise cancellation of an already accepted server-side mutation.

## SCOPED-DISABLE-1 — scope-owned package disablement

The personal and Team view catalogs expose package disablement only for the
enabled version and submit its exact enablement revision to Core. The action
applies to all package views in that scope, preserves saved selection, and allows
the host's existing unavailable-view fallback. Refresh and other catalog actions
are disabled while mutation is pending. Authorization remains server-owned.

`scripts/prove-scoped-disable-live.tsx` mounts the production catalog and client
against a disposable signed user/Team fixture. Both UI actions produce disabled
revision 2 after enabled revision 1. See the corresponding receipt. This is a new
control, not a claimed repair of a prior behavioral regression. The test does not
mount a real browser frame or establish desktop visual acceptance.

## SCOPED-SDK-1 — scoped browser helper wire contract

`packages/scoped-view-sdk/index.test.js` exercises the public helper with an
external parent-message boundary: source/envelope fencing, request correlation,
capability denial, bounded concurrency, liveness, timeout and disposal. The helper
must never copy initialization data or credentials into its outgoing envelope.
This new helper does not replace host-side authorization. Bundled signed-browser
execution remains separate from this protocol test.

## SCOPED-SETTINGS-1 — exact scoped presentation reads

A signed `view.settings.read` capability delivers only settings for the selected
package/version/manifest/application and its declared user or Team scope. Core
validates standalone membership; the host validates the declaration and reports
session authorization before and after reading. Settings confer no task authority.
`scripts/prove-scoped-settings-live.tsx` uses real signed Core packages, persisted
distinct user/Team overrides, production host/client and simulated external frame
messages. Both receive their own revision-2 values. No plug-in write API is added.

## DESKTOP-SCOPED-SETTINGS-1 — standalone preferences through Electron transport

Personal/Team plug-in preference GET and POST routes, and PUT to an exact
64-character settings key, must cross the adopted desktop proxy. Neighboring
paths, query expansion and wrong methods remain rejected. Core owns membership,
signed-package validation and revision conflicts; credentials remain in main.

The new public-proxy regression failed on `da06d86` with a supported-route
`doesNotReject` assertion before the allowlist repair. All 18 proxy/transport
checks pass after it. `scripts/prove-scoped-settings-desktop-live.ts` separately
verifies personal and Team enrollment, revision-2 update and scoped value delivery
through the production client/transport/proxy against real disposable Core. IPC is
an in-process adapter; this does not claim actual Electron UI acceptance.
