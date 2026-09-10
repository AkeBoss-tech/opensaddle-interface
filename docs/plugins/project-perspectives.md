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
