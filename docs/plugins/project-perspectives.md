# Installed project Perspectives

A trusted signed `application_renderer` contribution can declare
`input_schema.$id = "opensaddle.project-tasks.v1"`. Once its exact package is enabled
and selected in the Project environment, the host's View menu includes it as
`plugin.<application_id>`. IDs must satisfy the persisted preference identifier
format and remain unique. Artifact renderers without this contract stay out of
the project menu. Built-in Dialogue and Dispatch remain available when catalog
loading fails; an unavailable preference is preserved and falls back to Dialogue.

The host verifies renderer size, media type and SHA-256 through the existing exact
content endpoint. Browser execution uses an opaque-origin `allow-scripts` iframe,
no host services or credentials, and the existing renderer CSP. This retains the
trusted-signed-publisher requirement; it does not claim complete network isolation
or safe execution of arbitrary untrusted publishers. Navigation is detected after
a frame load and stops the view. The surrounding host view selector remains.

Initialization uses `opensaddle.application.v1`, kind `init`, and the existing
nonce, generation, instance_id, connection_key and package_ref fields. Its
`projection` is `{schema: "opensaddle.project-tasks.v1", model: {projectId, tasks}}`.
Each task contains id, title, status, verified, and source (active_run or result).
This is a project projection, not an artifact byte-verification claim.

The frame echoes the exact identity fields with kind `ready`. After readiness,
kind `request` supports `action: "open_task", task_id: "<projected run ID>"`, or
`action: "new_task"`. The first navigates through the host only for a projected
ID; the second opens the existing host task-creation workflow. Neither executes
a task or changes permissions. Messages from another frame, nonce, generation or
package are ignored; processing is bounded to 32 messages per second. View-local
state and arbitrary commands are not yet supported in this project contract.

Verification: mounted InstalledProjectView.test.tsx covers the real byte loader,
framed requests and host navigation. Disposable browser verification used a real
signed package installed/enabled through Core with a fixed loopback fixture owner,
confirmed one projected task and selection persistence after refresh. Local image:
`out/screenshots/installed-view-20260910/signed-project-view.png`.

Remaining: native desktop verification and lifecycle integration,  authoring scaffolds, richer conversation projections, state
persistence, and migration/replacement checks for project Perspectives. Do not
infer those from existing artifact-renderer tests.

## Active authorization

The view rechecks the exact application instance, package identity, manifest and
content digests after loading bytes, before navigation requests, and every five
seconds while idle. Catalog checks have a five-second timeout and concurrent
checks share one request. Disablement, replacement, lost membership, network errors
or timeouts remove the frame and invalidate its message generation. Reopening
requires host refresh; revocation never silently reinstates a view. These are
browser timer intervals, not a wall-clock guarantee while the browser is suspended.
Already-disclosed task text cannot be recalled; execution APIs retain their own
current authorization checks.

## Desktop verification (2026-09-10)

The built Electron application was exercised with an isolated user-data directory,
first against a Vite origin and then with the production renderer bundle served by
opensaddle://bundle. A disposable signed package loaded its project task projection;
its New task button navigated to the host delegation page, and returning restored
the installed view. Disabling the package through Core removed the idle frame in
both paths. Local images are in out/screenshots/desktop-perspective-20260910.

Direct Core servers must explicitly configure allowed_origins with
opensaddle://bundle (CLI --allowed-origin opensaddle://bundle); other custom
origins remain rejected. The stable serve-api wrapper already allows that desktop
origin. Verification used a fixed disposable owner, not production authentication.
This does not certify a distributed installer, native separate-process project
rendering, state migration, or actual remote task execution.

## Starter generator

Core now provides `python -m opensaddle.perspective_starter` to generate an unsigned
board or single-column task-list package. See Core's
`docs/plugins/project-perspective-starter.md` for the authoring command and a
reusable signed loopback fixture. The generated package was visually verified in
this Interface with filtering and canonical run navigation. Its local screenshot
is `out/screenshots/starter-20260910/board.png`. The starter does not yet supply
conversation transcripts, persistent state or automatic signing/trust changes.

### View state within a tab

After `ready`, send the normal fenced envelope with `kind: "state"` and a
`state` object matching the signed `state_schema` and `state_max_bytes` (host cap
8 KiB). The host rechecks catalog authority before storing. Subsequent `init`
messages include optional `state`. Invalid messages leave the saved value alone.

Storage is browser sessionStorage, scoped to server, user, Project, application
instance and exact package version/digest/schema version. It survives navigation
and refresh within the tab; it is not synced, durable across closing the tab, or
automatically transferred to another package version without a declared migration. Do not put credentials or execution
authority in it. A save failure appears in the host. Storage is a presentation
convenience and does not replace server authorization.

### Declared state migration

When an exact-version snapshot is absent, the host may restore the latest saved
state for the same server, user, Project, application instance and package ID.
The destination's authorized signed descriptor must contain exactly one validated
`state_migrations` entry from the saved schema version to its new schema version.
The existing declarative rename/drop/default interpreter validates both schemas
and the final state/byte limit. Missing or ambiguous migrations, undeclared schema changes within the same schema version, and invalid output start without transferred state.

The old exact-package snapshot remains available for rollback. The host displays
a migration notice. Rendering does not overwrite the old snapshot; the new
package's later valid state message saves its own snapshot. This protocol is
presentation-only and does not run migration code supplied by a plugin.

Package versions that retain the same schema version may reuse the prior scoped
state only when the validated schema contracts are identical. Property/required
field ordering does not matter; field types, limits, required fields and maximum
property count do. The destination byte cap still applies. This path does not
transform data or display a migration notice, and retains the old exact snapshot.

### Host-owned task updates

The Project host now refreshes canonical task data five seconds after the prior
read settles. Unchanged projections retain their object identity. Read failure
or a 15-second deadline removes rendered task views until a fresh valid read;
old Project/account responses are ignored. A hung request is not retried in
parallel: use Refresh workspace to start a new feed if it never settles.

Legacy init-only packages reload their verified frame when task data changes,
restoring last acknowledged tab-local state. Packages declaring `projection` in
the signed input schema kind enum receive in-place updates after exact-package
reauthorization. Updates carry the original frame fence and a monotonically
increasing `projection_revision`; they contain no saved-state replacement. The
host checks task navigation against its latest model, including after asynchronous
authorization. Unchanged polls do not reload either package type. Browser
verification of live refresh remains pending (Mac locked on 2026-09-10).

Generated starters accept only updates from their original parent, frame identity,
package and Project with a newer positive revision. They retain the filter input
and restore focused task buttons when the same task remains. Host protocol and
signed-schema tests pass; actual keyboard focus preservation is not yet visually
verified. A package declaration is compatibility opt-in, not additional authority.

### Shared task creation

All Project Perspectives now open `/project/:projectId/new-task` for the host
`onNewTask` action. This focused page uses the existing Journey task-admission
form and stays bound to the current Project. It exposes source, agent and reviewed
context choices without Project switching or administrative setup forms. Plugins
receive no new execution capability. Submission success means the request was
accepted; users return to their selected Workspace Perspective for task status.
Mounted checks and production build cover this change; Mac lock prevents current
browser verification.

### Shared task inspection

Task cards in built-in and installed Perspectives now use the host route
`/project/:projectId/tasks/:runId`. The shared task page preserves project
navigation and returns to the saved Workspace Perspective. It checks that both
identities match the authoritative response before displaying task text or actions.
Existing cancellation, launch-context inspection and coding-result review remain
owned by the same host surface. This adds no plugin permission or independent
execution path. Non-coding artifact inspection still opens the existing review
workspace; a full conversational task transcript remains future work.

### Published result text

The shared task page now displays non-coding result artifact text inline, with
bounded UTF-8 decoding, SHA-256 verification and current Run/account checks through
the existing host client. Text is never executed as markup. A failed recheck clears
it; refreshes are sequential, with a display timeout. Exact artifact identity stays
available in a disclosure, and the existing review workspace link remains for
further inspection. Coding tasks retain their dedicated patch/check/human-review
panel. This output is not a reconstructed provider conversation or evidence of
correctness, human acceptance, or a completed global manager agent.

### Dispatch status groups

Dispatch now separates Queued, Working, Needs attention, Finished and Other.
Provisioning and verification are work in progress; paused and approval-waiting
Runs need attention. Unknown server statuses remain visible. The independently
packaged board generated by Core's Perspective starter uses the same grouping,
with task navigation delegated to the host. This provides a concrete alternate
layout through the public package contract; it introduces no scheduling authority.

### Signed host requirements

A renderer may declare `descriptor.ui_contract` with schema version
`opensaddle.ui-contract.v1`, `mount_kind`, `scope`, inclusive integer
`host_api_min`/`host_api_max`, and unique `required_capabilities`. The Project host
supports API 1, mount `perspective`, scope `project`, and:

- `projection.project-runs.v1`
- `projection.live.v1`
- `navigation.task.open.v1`
- `navigation.task.create.v1`

Discovery filters incompatible declarations, the renderer host checks before
fetching code, and catalog reauthorization repeats the check. These are UI
capabilities, not permission to execute tasks. Legacy packages without a declaration
retain the existing `opensaddle.project-tasks.v1` contract. Required but unsupported
features cannot silently degrade. Global widgets and settings mounts are described
by the shared schema but are not supported by this Project host. New starter
packages declare their requirements inside the existing signed descriptor, so
legacy signature canonicalization is unchanged.


## Project-scoped widget packages

The existing generator accepts `--mount widget` (default remains `perspective`):

```sh
python -m opensaddle.perspective_starter ./task-widget \
  --package-id org.example.task-widget --publisher-id org.example.publisher \
  --application-id task-widget --title "Project tasks" --mount widget
```

This creates an unsigned package declaring mount `widget`, scope `project` and
the existing `opensaddle.project-tasks.v1` projection. Normal publisher signature,
package installation, Project enablement and environment configuration still
apply. Generation neither installs nor enables it. Changing the signed scope
invalidates the signature. A widget is excluded from Project Perspective selection
and rejected before executable bytes load in that mount.

Ten generator/catalog checks and three mounted renderer checks pass. The public
widget CLI assertion fails on the preceding Core revision and passes with this
change; see `docs/testing/receipts/project-widget-package-20260910.json` in Core.
This is authoring and mount-boundary support, not dashboard widget execution.

The next host slice must discover authorized Project widget instances, persist
the user's placement separately from package activation, and render each through
the existing exact-byte/frame/revocation checks with only its Project projection.
A missing or revoked instance remains an unavailable saved preference. The host
must resolve navigation against current projected task IDs. Personal/global-data
widgets need a separate owner-scoped catalog; do not simulate it by giving a
Project package all dashboard data or by inventing a shared pseudo-Project.


## Personal dashboard placement of Project widgets

The connected dashboard now includes **Add project widgets**. Select a current
Project to discover its configured, enabled signed widget instances, then enable
and order them in **Customize dashboard** and save. Discovery never fetches code.
Only saved placements mount a renderer. Existing layout revisions, conflict
handling, hide/reorder controls and authenticated ownership remain authoritative.

A placement ID is `widget.<project-hash>.<instance-hash>` using the first 32 hex
characters of SHA-256 for each part. The second hash covers the package ID,
application ID and instance ID. This bounded opaque identifier is a preference,
not authority. On reload, current membership resolves Project hashes and only
Projects referenced by saved placements or the explicit picker are queried for
widgets. Ambiguous identifiers fail discovery. Package version upgrades retain
placement while exact content/signature and package state rules still apply.

The host accepts signed API-1 mount `widget`, scope `project` packages using
`opensaddle.project-tasks.v1`. It reuses the Perspective host's exact-byte checks,
sandbox frame protocol, current catalog reauthorization, task feed freshness and
host-owned navigation. A widget gets one Project task model; no dashboard-wide
projection, credentials or execution client is passed to its frame. Widget state
uses a separate dashboard namespace under the existing account/package state key.

Unavailable or revoked placements remain saved and show a placeholder. Existing
frames revoke on failed authorization before navigation or projection updates.
Personal/global-data widgets still need a separate owner-scoped catalog and are
not supported by this Project widget host. Dashboard placement and widget loading
are independent of the Command Center overview projection.

Thirteen mounted/client checks and a production build pass. The regression flow
fails on the prior Interface revision and passes here: discover P without querying
Q, save, render only P's tasks, revoke the frame, reload and retain the unavailable
placement. Receipt: Interface `docs/testing/receipts/project-widget-dashboard-20260910.json`.
This is mounted protocol evidence. Actual signed-package server/browser acceptance
and keyboard verification remain pending.


## Signed package and live Core verification — 2026-09-10

The disposable renderer fixture now accepts `--mount widget`. It generates and
signs a package, installs it through the real catalog, enables it for its Project
and selects the exact package in the Project environment. Private fixture bearer
tokens remain in mode-0600 files outside the repository.

A mounted Interface dashboard used the real directory, renderer, Journey and
dashboard-settings clients over HTTP to discover the widget, save placement and
reopen it from Core. The host loaded the exact signed fragment and initialized
only the `renderer-proof` Project projection. Removing the environment selection
through the ordinary owner API revoked the mounted frame on reauthorization.
Saved placement remained unchanged, and unauthenticated catalog access returned
401. The fixture server was stopped and the temporary client script removed.

Receipt: Core `docs/testing/receipts/project-widget-live-20260910.json`. This closes
the mocked-catalog gap for discovery, persistence, byte loading and revocation.
Frame messaging was simulated by the mounted test; it does not prove browser
execution, visuals, keyboard behavior or network isolation. Desktop access was
retried and the Mac remained locked. Four package-generator checks also passed.


## Overview-independent widget hosting

The dashboard layout and Project widget host now remain mounted while the Command
Center projection loads, fails or is not advertised. Built-in overview widgets
show unavailable content without retaining stale protected snapshots. Project
widgets continue using their independent current catalog and task-feed authority.
Disconnect still removes the dashboard, and account changes preserve the existing
identity fences. This separation prevents an unrelated overview refresh from
destroying a widget frame or interrupting layout editing.

Nine mounted dashboard checks and the production build pass. The widget round-trip
regression now additionally proves same-frame retention after overview failure and
capability removal, followed by successful enforcement of widget revocation. It
fails on the preceding Interface commit and passes with the change; receipt:
Interface `docs/testing/receipts/widget-overview-independence-20260910.json`.
Browser verification remains pending.


## Dedicated Project task feed

Core advertises `project_task_feed_v1` only when the store implements the feed.
`GET /api/v2/projects/{id}/task-feed?after=<run-id>&limit=100` returns Project-local
Run IDs, task titles, lifecycle statuses and `verification: not_assessed`. It reads
no global overview, goals, worker roster, invitations or source registry. Current
Project membership is required even for a platform operator and is rechecked
after reading. No source paths, policy contents or credentials are projected.

The SQLite implementation pages by stable Run ID, with limits 1–200. Interface
collects at most 1,000 tasks, rejects duplicate/non-progressing pages and mismatched
Project/account identity, then rechecks membership before publishing. Oversized
feeds report unavailable rather than silently showing an incomplete task list.
Pages are live reads, not an atomic historical snapshot. Verification is explicitly
unassessed here; detailed result review remains the authority for acceptance.

Perspectives and dashboard widgets use this feed when advertised, retaining the
existing onboarding feed for older servers. Thus removing Command Center no longer
breaks the underlying widget data read on supported Core servers. PostgreSQL
support is not claimed; unsupported stores advertise false and return 501.

Validation: 31 Core/API checks, 16 Interface mounted/client checks, both before/after
regression proofs and the build pass. A real Interface HTTP client authenticated as
a non-owner auditor read a Project while Command Center returned 503 and was denied
an unrelated Project. Its disposable server stopped afterward. Core receipts:
`docs/testing/receipts/project-task-feed-20260910.json` and
`docs/testing/receipts/project-task-feed-live-20260910.json`. Browser acceptance is
still pending.


## Default Perspective controls

The scoped appearance editor now includes **Default view** beside theme and
spacing. Personal and Team layers offer the built-in Dialogue and Dispatch views.
Project and private per-Project layers additionally discover compatible installed
Project Perspectives from the current catalog. Widget packages are excluded.
Unavailable stored preferences remain visible and can be preserved or replaced.
Catalog failure leaves built-in choices available; it does not activate packages.

Selecting **Inherit** removes only the Perspective key, retaining theme and density.
Saving uses the existing exact scope, expected revision and server `can_write`
contract. Reset still clears the entire layer explicitly. Choosing a plugin
preference grants no installation, enablement or execution authority; the Project
host continues to resolve and reauthorize it independently.

Two mounted editor checks, two Core scope/inheritance checks, the actual baseline
regression assertion and production build pass. Receipt: Interface
`docs/testing/receipts/default-perspective-settings-20260910.json`. Browser and
keyboard acceptance remain pending.


## Signed plugin settings declaration

Application renderer packages may include `descriptor.settings_contract`. It is
separate from temporary `state_schema` view state and is covered by the existing
manifest signature, preserving canonicalization for packages without it.

```json
{
  "schema_version": "opensaddle.ui-settings.v1",
  "purpose": "presentation",
  "settings_version": 1,
  "scopes": ["project", "user_project"],
  "values_schema": {
    "type": "object",
    "additionalProperties": false,
    "maxProperties": 1,
    "properties": {"show_finished": {"type": "boolean"}}
  },
  "defaults": {"show_finished": true},
  "labels": {"show_finished": "Show finished tasks"}
}
```

Fields use the existing bounded closed scalar schema vocabulary: booleans, bounded
strings, or finite numbers with minimum and maximum; at most 32 properties. Every
property needs a valid default and a plain-text label of 1–80 characters. Defaults
are bounded to 8 KiB UTF-8. Unknown contract fields, duplicate scopes, Boolean
version numbers, control characters in labels and non-presentation purposes fail
package validation. A changed default or scope requires a new valid signature.

The declaration may name user, team, project and user_project scopes, but this is
compatibility metadata, not authorization or proof that a host implements a scope.
No settings persistence, generated form or settings propagation is added by this
contract slice. Upcoming host storage must derive ownership and management rights,
apply expected-revision writes, preserve exact package/schema identity and resolve
defaults separately from executable state. Plugins must never obtain policy or
credential authority from a settings value. No host capability is advertised yet.

Twelve package/catalog checks and a before/after invalid-default regression pass;
receipt: Core `docs/testing/receipts/renderer-settings-contract-20260910.json`.
The actual installer accepts valid signed declarations and rejects tampering.


## Persistent Project plugin settings

`renderer_settings_v1` advertises SQLite-backed `project` and `user_project`
settings only when both storage and the extension catalog are configured. Other
stores return 501 rather than claiming support. User and Team plugin-setting
layers are not implemented by this capability.

`GET /api/v2/projects/{project_id}/application-renderers/{application_id}/settings`
requires `instance_id`, `package_id`, `version` and `manifest_digest` query fields.
Core resolves that exact currently configured and enabled signed renderer. The
response includes its settings contract, declared supported layers with revision
and `can_write`, and effective values/provenance. Resolution is signed defaults,
shared Project overrides, then the authenticated member's private overrides.
No other member's private layer is returned.

`PUT` to the same path plus `/{scope}` accepts only `expected_revision` and `values`.
Each values object is a partial override validated against the signed schema and
bounded to 8 KiB. An empty object restores inheritance for that layer. A stale
revision returns 409. Shared writes require current Project owner/admin membership;
private writes require current membership. There is no caller-controlled owner ID
or platform-operator bypass of membership. Ordinary role changes apply on every
read and write. The metadata table is additive and leaves existing settings intact.

Records are keyed by exact package reference, application and instance in addition
to Project, scope and authenticated owner. Upgrades do not reinterpret old values
under a different schema; prior records remain retained. Migration is a follow-up.
Package selection and membership are checked before and after operations, with
membership and revision checks inside the settings write transaction. A lost or
revoked package returns unavailable; preferences never execute an action. Catalog
and settings storage are distinct databases, so the final check can deny a response
after a preference committed under its old exact-package identity. Such a write
does not grant current activation or runtime authority.

Thirty-four Core/API checks and the before/after regression pass, including real
signed-package installation, shared/private inheritance, invalid values, spoofed
ownership, stale revision/reference, store restart, membership removal and package
disablement. Receipt: Core `docs/testing/receipts/renderer-settings-api-20260910.json`.
Generated Interface forms and propagation to renderer frames remain unfinished.


### Generated plugin preference forms

Project Appearance discovers enabled signed renderer settings declarations and
renders bounded scalar controls in the host. Members can edit private overrides;
owners/admins can edit shared defaults. Fields can return to inheritance. Saves
use exact package identity and expected revisions. Conflicts retain drafts until
discard/reload. The client validates declarations, layers, account identity and
recomputed effective values. No plugin code runs in the editor.

Five mounted/client and existing appearance checks pass, alongside three Core
signed-package API/contract checks and the renderer production build. Transport
responses are injected for UI tests; Core tests install actual signed packages.
Browser visual acceptance remains pending. Frame propagation, user/Team plugin
layers and migrations remain open: saving preferences does not yet change an
embedded renderer. Reload rechecks access; the editor does not poll for revocation.


### Receiving resolved preferences

Installed Perspectives and Project widgets now receive settings in `init` and
`kind: settings` messages, under the existing exact frame identity. Declare
`settings` in the input schema's kind enum alongside the signed settings contract.
The payload is `{schema_version: "opensaddle.resolved-ui-settings.v1",
settings_version, values}`; settings updates carry a strictly increasing
`settings_revision` per generation. Reject stale revisions and wrong identity.
Only effective values are delivered. Packages cannot write preferences through
the frame. Host polling/navigation/data updates recheck exact-package access and
settings; failures remove the frame. The starter implements task visibility and
card limits. Sixteen mounted/client checks and the build pass. Visual acceptance
and combined live-server/browser proof remain pending.


### Live settings proof

The disposable signed-starter walkthrough now verifies the complete editor →
Core persistence → host polling → actual plugin JavaScript flow over HTTP. A
member's private visibility change hides a completed fixture task without frame
reload; clearing the override restores it. A new client observes the saved value,
the owner's private view remains unchanged, and shared writes by the member are
denied. Environment removal revokes the frame. See the reusable
`scripts/prove-renderer-settings-live.tsx` and its dated receipt. The service was
stopped after verification. This closes combined live-server/protocol proof,
while browser visuals and OS sandbox acceptance remain unverified.


### User and Team defaults

The starter now declares all four presentation scopes. The generated Project
settings panel offers My defaults across projects, accepted Team defaults, shared
Project defaults, and private overrides. Effective values follow that order after
signed defaults. User/Team records share an exact package/application key across
Project instances; private/Project records keep instance-specific identity.
Team writes include the accepted association identity/revision and require Team
manager authority. No current association means no Team layer. Clearing a value
returns to the preceding layer. Capability negotiation supports older two-scope
servers, while unsupported declarations fail closed.

Eight mounted/client checks and baseline proof cover the new scope selector and
Team write body. Nine Core checks cover real persistence/authority. These controls
currently use an enabled Project plugin as their schema context; standalone
personal/Team plugin catalogs and browser acceptance remain open.
