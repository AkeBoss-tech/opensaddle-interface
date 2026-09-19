# Connector write review in Project task detail

The normal Project task page now offers an exact human review when Core advertises
`agent_connector_sessions_v1` with broker-scoped write actions. It reads the
privileged current Run write-proposal list, validates each exact item and
rechecks Run access. On a click it refetches the individual proposal to verify
the digest and arguments before approving.
The card displays the connector, action, full arguments, agent attribution,
expiry, exact request digest, and current state. The approval POST happens only
on a human click and contains `expected_request_digest`; the UI has no dispatch
call. A lost response is presented as an unknown approval outcome, with no
automatic POST retry. `approved`, `dispatching`, `effect_unknown`, and
`completed` have distinct copy; none claims that an external effect was undone.

Owning invariant: `PROJECT-AGENT-WRITE-REVIEW-1` in
`docs/testing/invariants.md`. Public transport and mounted task tests cover
capability gating, Run-list/individual-GET binding, one-click exact digest, caller and Run
substitution, lost acknowledgement, and the state distinctions. After the last
UI change, the owning tests passed 5/5. The broader feature suite passed
366/366, TypeScript typecheck and production build passed, and lint exited 0
with no warning in the new files. `git diff --check` passed.

Chrome visual verification of the final list-backed implementation used a disposable local HTTP fixture at
`http://127.0.0.1:5179/opensaddle-interface/project/P/tasks/run_1`. The
populated task showed the exact arguments and approval button; a human click
changed the card to `approved`, removed the button, and said the agent must
separately dispatch. CUA screenshot observations of both states were inspected
in the task session; this tool did not persist image files. The fixture does
not exercise installed Core, a provider, a real external write, or a remote
account. It intentionally implements only the task-detail routes, so unrelated
task-history queries return 404.

The Core Run proposal list replaces SSE discovery so a busy event stream
cannot hide a short-lived request. The list is bounded to the newest 50
eligible proposals and reports truncation; the UI states when older requests
are omitted. A completed request already opened in the mounted task is
rechecked by its exact proposal ID on refresh, so it does not disappear when
Core removes it from the pending list. Historical completed writes are not
rediscovered on a fresh page; the separate connector audit remains the history surface. The list and
individual GET remain Core-authorized; this UI never infers approval from
a list row alone.

Real Core acceptance followed using the root-provided final source archive
`/tmp/opensaddle-20260919/activation-final-archive` (tree prefix `701e`). A
disposable loopback Uvicorn app used `LocalBootstrapAuthenticator` and the
actual reviewed agent/task/session setup from the Core write-effect test. Its
installed local MCP stdio action wrote only to a private fixture marker.
Chrome opened the normal Project task page. The current Run proposal list
returned one `proposed` request with exact arguments. One browser click made
Core report `approved` while the marker remained empty. A separate agent-token
HTTP dispatch returned a completed `external_write` receipt and exactly one
marker line for `{record: approved, value: one}`. Core's pending list then
returned zero, exact proposal GET returned `completed`, and the mounted task
refresh displayed `completed` rather than mistaking absence from the pending
list for no write. Sanitized machine receipt:
[connector-write-ui-real-core-20260919.json](../../testing/receipts/connector-write-ui-real-core-20260919.json).

An initial disposable run's short fixture lease expired during browser setup;
Core returned 401 on dispatch and no marker appeared. The final run used a
300-second fixture lease and completed the journey. This is a local MCP effect
test, not a model, remote provider, hosted IAM, or production installation
test. The CUA browser screenshots were inspected in-session but not saved as
files.

The adopted desktop runtime uses a main-process route proxy. Before the proxy
change, the same new public test failed on the first Run-scoped list GET with
`Personal runtime request path is unavailable`; browser HTTP validation did
not cover this boundary. The proxy now admits only the Run list GET, exact
proposal GET, and exact approval POST. The approval body must contain only a
64-hex `expected_request_digest`. Agent dispatch and neighboring routes remain
denied. `test/personalRuntimeProxy.test.ts` passed 14/14 and the Electron build
passed after the fix. This verifies proxy forwarding with a fake Core fetch;
the real Core browser journey above was direct HTTP, not a packaged desktop
runtime test.
