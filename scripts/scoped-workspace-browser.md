# Scoped workspace browser proof

Run Core's `scripts.dev_scoped_renderer_fixture` with an empty disposable directory
and an unused loopback port. It installs signed personal and Team fragments from
`scripts/scoped-view-fixture.html`. Never point this harness at a personal runtime.

Serve this Interface repository with Vite on a second loopback port. Use a
private temporary Vite configuration whose `/api` proxy targets the fixture and
injects `Authorization: Bearer ...` from the fixture's `owner.token` file on the
server side. Do not embed that token in HTML, browser storage, commands or logs.

Open `/scripts/scoped-workspace-browser.html` with CUA. Select the personal view,
check ready, click the in-frame button, reload and check the persisted workspace.
Show default workspace should escape locally. Add `?team=TEAM_ID` using the ID
from the fixture metadata and repeat for the separate Team scope. Disable the
Team package using the real Core API and verify the frame disappears while the
host's recovery controls and default content remain usable.

This intentionally unstyled harness exercises production components; it does
not stand in for full application navigation, styling or Electron verification.
Stop both disposable services after the walkthrough. Existing personal runtime,
device records and Project permissions must remain untouched.

For package disable/re-enable acceptance, activate the view and reload to mount
it in the workspace. Use **Disable package** in the catalog, wait for active
frames to disappear, and check default content remains. Use **Use view** again,
then reload and verify the selected scope reports ready. Repeat with `?team=…`;
keyboard activation should work. The 2026-09-10 browser receipt records both
scopes reaching enabled revision 3 with their environment selection retained.
