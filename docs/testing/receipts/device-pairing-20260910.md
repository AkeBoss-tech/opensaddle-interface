# Device pairing verification

Verified the personal Devices page against disposable Core on loopback port 58770, with a fixed fixture owner and isolated database. Browser route: `/opensaddle-interface/devices`. This is not production authentication or remote task execution evidence.

Registered a disposable device, generated a code in the browser, supplied it privately to the actual device CLI, compared the exact fingerprint, checked the match control, confirmed enrollment, then reviewed and revoked pairing. Inventory updated to Paired then Pairing revoked. No project assignment or task permissions were created. Active pairing secrets were not captured in screenshots.

Evidence: `out/screenshots/device-pairing-20260910/fingerprint.png`, `paired.png`, `revoked.png`. Existing screenshots are unchanged. Five inventory/pairing component tests and renderer/Electron builds passed. Core pairing/contact/enrollment/inventory tests: nine passed. Test scope includes hidden CLI input, fingerprint-match gating, consumed-code removal and exact revision on revocation.

A stale registration notice found during visual verification was cleared on refresh. Remote HTTPS setup, real machine execution, project consent UI and mobile pairing review remain outside this checkpoint.
