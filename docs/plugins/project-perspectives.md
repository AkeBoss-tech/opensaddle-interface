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
