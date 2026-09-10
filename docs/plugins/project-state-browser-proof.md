# Project view state browser check

Verified 2026-09-10 with Core `5239c82`, the generated signed project Perspective
fixture, and Interface `b467cc5` plus the project-loading guard in this checkpoint.
Core ran on loopback port 58770 and Vite on 5318. Authentication used only the
disposable fixture account through the connection settings UI.

The installed project-board showed the canonical completed task and its explicit
unverified label. Entering `missing` hid the task. Navigating to Overview and back
restored that filter and the empty-result message. A full browser-tab reload also
restored the selected installed view, filter and empty-result message. Entering
`Render` showed the task again; Tab moved focus from the filter to its task button.

Screenshots are retained locally in:

- `out/screenshots/perspective-state-20260910/restored.png`
- `out/screenshots/perspective-state-20260910/task-focus.png`

The first reload exposed a legacy ProjectWorkspacePage error while the project
list was empty: `Cannot read properties of undefined (reading 'id')`, observed at
05:35:37 UTC. It also contained a fallback to a different active/first project.
The page now waits for the exact route project before mounting its content. The
same reload showed a temporary Project unavailable status, followed by the
authorized installed view and restored filter. No new console error appeared.
The renderer production build passed after the fix.

This is desktop browser/sessionStorage proof. It does not establish cross-device
state sync, state persistence after closing the tab, package upgrade migration,
or native desktop/mobile verification of the new state protocol.

## Upgrade follow-up (2026-09-10)

Core now provides `scripts/dev_project_perspective_upgrade_fixture.py` and
`docs/plugins/project-perspective-upgrade-proof.md`. Its real enablement and
environment APIs accepted versions 1.0.0, 1.0.1, 2.0.0, then rollback to 1.0.0.
The existing mounted-frame/state suite passed all seven tests. Computer use
reported the Mac locked before this follow-up could open a browser, so these
results do not extend the visual evidence above to package upgrades yet.
