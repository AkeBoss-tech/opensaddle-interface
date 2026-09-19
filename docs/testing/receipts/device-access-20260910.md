# Personal device project access

Seven mounted device workflow tests passed; renderer and Electron builds passed. Core `tests/test_device_assignments.py` passed the full enrollment, proposal, acceptance, worker authorization and revocation journey with new authenticated-viewer assertions.

Real Chrome verification used Core at 127.0.0.1:58770, Vite at 5318, and an isolated fixture owner/database. Fixture setup created a paired disposable laptop, project Astra-demo, a source, teammate membership and initial owner-only proposal through Core APIs. The browser changed that policy to selected-teammate use with Codex and the explicit source, proposed it, separately reviewed and accepted it, observed that owner tasks were excluded, then revoked access. No real device or task was involved.

Evidence: `out/screenshots/device-access-20260910/accepted.png` and `revoked.png`. The mismatch between local UI identity and authenticated fixture identity exposed the need for Core viewer authority in roster responses. The resulting controls use that authority. This is local UI/API evidence, not production authentication or remote execution evidence.

Pending: project-side inbox for other device owners’ proposals, complete canonical project discovery, narrow-screen review, worker configuration and remote task execution. The global device selector uses registered workspace projects plus existing assignments; it does not switch the active project workspace.
