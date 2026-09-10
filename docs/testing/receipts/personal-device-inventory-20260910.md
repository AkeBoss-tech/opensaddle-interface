# Personal device inventory verification

Verified the connected Interface against an isolated Core database at loopback,
using a fixed test identity (`visual-check-owner`). This fixture verifies UI and
Core registration integration, not real account authentication or remote pairing.

- Opened Settings, then Manage devices.
- Registered `Visual check Mac` with no Project and observed its persisted name,
  owner, Not paired, and Connection not verified states.
- Inspected the populated page at the normal desktop viewport and 600 × 800.
- Found the legacy mobile sidebar covering the form; corrected the connected
  sidebar to a menu drawer and verified navigation back through Settings.
- Tab from Device name focused Operating system.
- Saved desktop and narrow screenshots in `out/screenshots/devices-20260910/`.
- 46 focused UI/service tests passed; renderer and Electron builds passed.

The web router still expects `/opensaddle-interface` even with a root Vite asset
base. Verification used `/opensaddle-interface/devices`. Pairing controls,
project-sharing controls, real remote execution and the replaceable Perspective
SDK remain pending. These screenshots do not prove those capabilities.
