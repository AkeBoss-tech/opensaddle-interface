# Project Perspective host

Mounted SurfaceHost/PerspectiveHost test verifies both registered built-in views open the same canonical run, retain explicit verification state, expose host callbacks, reject mismatched project projections and resolve unavailable preferences to Dialogue. Renderer/Electron builds passed.

Chrome against disposable loopback Core created one queued run through public APIs (configured RolePolicyEngine; no worker execution). The project opened Dialogue, switched to Dispatch, opened the same task's canonical run details, then returned with Dispatch restored from the private project preference. Screenshots: out/screenshots/project-perspectives-20260910/dialogue.png and dispatch.png.

A legacy project-page error during initial connection exposed an error-boundary reuse issue. The route boundary now resets when connected mode changes. The browser recovered into the new host after that fix. This is observed integration evidence; no isolated pre-fix regression harness was added for that incidental change.

Limitations: these are compiled built-ins. Dialogue is a focused task launcher/list, not a full conversation canvas yet. Installed package activation, version compatibility, renderer bridge integration, full mobile/accessibility review and package failure recovery remain pending. The host keeps task IDs/actions; no view owns a separate task store or execution authority.
