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
