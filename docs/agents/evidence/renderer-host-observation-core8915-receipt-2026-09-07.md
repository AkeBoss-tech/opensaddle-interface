# Renderer host observation receipt — Core 8915

Captured on 2026-09-07 against the corrected Core fixture at `127.0.0.1:8915` and the Interface desktop shell at `127.0.0.1:4177`. Authentication was read only from the fixture's mode-0600 token path. No bearer or host report token was printed or saved here.

## Exact activation

- Project: `renderer-proof`
- Application/instance: `review-evidence` / `review-main`
- Package: `dev.opensaddle.fixture-renderer@1.0.0`
- Native renderer generation: `3` for the crash sequence
- Host identity authority: `client_asserted`
- Observation authority: `host_reported`
- Semantic correctness: `not_verified`

The desktop renderer displayed the authenticated fixture report in a separate renderer process. The React shell created the host session after receiving the native generation, then reported `loading` sequence 1 and `ready` sequence 2. After the repaired heartbeat scheduler was loaded, the same ready generation advanced monotonically through sequence 5.

CDP `Page.crash` was sent to the native `data:` renderer target, while the HTTP shell target remained responsive. Core then returned generation 3 as `error`, sequence 8, with the bounded code `renderer_unavailable`; the shell changed to “Host report: error.” Earlier generations were returned as `unknown` with `session_expired_or_selection_changed` after replacement.

The initial browser attempt found a real CORS defect: the exact host-token header preflight returned HTTP 400. Core corrected the allowlist in `7dd5e80`; the same preflight then returned 200 and the browser journey above succeeded. This receipt describes host-reported process lifecycle only. It is not evidence that the plug-in's output is semantically correct.

## Visual evidence

- [Desktop shell showing the authenticated report](../screenshots/renderer-host-observation-core8915-desktop-shell-2026-09-07.png)
- [Desktop lifecycle showing the client-asserted ready report](../screenshots/renderer-host-observation-core8915-desktop-lifecycle-2026-09-07.png)

The shell screenshot cannot composite the native `WebContentsView` pixels through Chromium's page screenshot API. Native content and typed state are therefore recorded separately in the [native migration receipt](application-state-migration-core8909-native-receipt-2026-09-07.md), which includes the exact CDP DOM values before replacement, after migration, after editing, and after rollback.
