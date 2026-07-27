# OpenSaddle UI audit screenshot set

Captured from the local app at `http://127.0.0.1:5173/opensaddle-interface/` on 2026-07-23.

The set contains one full-page baseline screenshot for each primary route and dynamic detail surface. Browser console error count was zero for each captured route.

## Recommended next steps

1. Fix the three highest-risk defects first: sanitize or remove `dangerouslySetInnerHTML` in `ChatPage`, clear the Harness polling interval during effect cleanup, and unsubscribe ChatPage runs on unmount.
2. Enforce governance in code: gate `/admin` at the route/page level, make approval-required workflows wait, and persist permission scopes and policy decisions instead of showing toasts only.
3. Remove or finish misleading controls: tools toggles, plugin credentials, runtime provisioning, create-task, usage period, resize handles, and destructive-action confirmations.
4. Harden data and navigation: validate URLs and file paths, handle localStorage/clipboard failures, fix cross-project permission fallback, and prevent stale-chat sends.
5. Complete accessibility: keyboard-operable tree controls, semantic interactive elements, labels, tab panels, focus trapping, and confirmation affordances.
6. Add automated frontend coverage for routing, permissions, workflows, artifacts, settings persistence, and the key modal/error states.

The detailed Claude report is stored separately at `/Users/akashdubey/.claude/jobs/bd4235a8/tmp/child-thread-report.md`.
