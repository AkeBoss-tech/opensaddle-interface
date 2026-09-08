# Real local Project persistence receipt — 2026-09-07

This is a local integration receipt, not hosted or visible-GUI proof. The macOS desktop was locked, so visual proof remains pending.

- Core source: immutable archive at commit `80b708e`
- API: production `opensaddle serve-api` on `127.0.0.1:8765`
- State: the resolved normal Electron directory `/Users/akashdubey/Library/Application Support/opensaddle-desktop/opensaddle-server`; existing registry rows were inspected and preserved
- Interface transport: production `AuthoritativeLocalProjectClient`
- Authorized folder registration only: real Project `opensaddle`, root `/Users/akashdubey/Documents/CodingProjects/opensaddle`
- Registration response: HTTP 201; immediate Project list: HTTP 200
- Restart: Core PID `81452` exited cleanly; PID `81902` opened the same state directory and served the post-restart list
- Post-restart Project list: HTTP 200 and contained the exact `opensaddle` Project/root pair
- Folder contents were not imported or copied by this registration proof. The registration itself deleted or overwrote no existing Project rows or user files.
- Handoff state: verification PID `87545` was stopped cleanly after confirming the durable row. Coordinator-owned Core PID `88079` then opened the same canonical directory without legacy development mutations; an unauthenticated loopback GET returned HTTP 200 and included the new `opensaddle` row. This receipt makes no always-on or reboot-process claim. The desktop sidecar uses the same canonical directory for future launches.
- Two exact registrations whose temporary roots no longer existed were removed separately by the coordinator after a mode-0600 SQLite backup and clean foreign-key check. The three registrations for existing folders remained; their unrelated identities are intentionally omitted here.

The runnable probes are retained outside the repository in the persistent agent runtime. They contain only the local loopback URL, Project id, and authorized local root; no token or credential is present.

Coordinator review reran the seven focused empty-start, recovery, mounted hydration, failed-load no-PUT, and connected-v2 regressions successfully (`7/7`).
