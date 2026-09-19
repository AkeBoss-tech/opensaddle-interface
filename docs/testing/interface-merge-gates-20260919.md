# Interface merge gate repair

At `4ad3fff`, local `PERSONAL-RUNTIME-STARTUP-1` failed: the unchanged real
process test observed a child PID after commissioning had rejected a startup
error. The detached process-group signal could return `EPERM` as the child
exited. Cleanup then rejected before confirming that the child was reaped. The
repair falls back to signaling the direct child if it remains active, waits for
close, and confirms on POSIX that its PID disappears within a bound. The same
test passed after the repair and in 20 consecutive focused runs.

An independent review found that a launcher could exit before handoff while a
child inherited its process group. The earlier repair checked only the leader
on that path. A real shell fixture with ignored stdio reproduced the false
cleanup claim against archived `4ad3fff`: the same-group child remained alive
but commissioning returned the ordinary missing-handoff error. Cleanup now
signals the commissioned process group even after leader close and requires
both leader PID and original group disappearance before reporting cleanup.
If group cleanup cannot be confirmed, it reports that uncertainty explicitly.
This proof does not cover descendants that create a separate process group.

The CI workspace migration failure came from a test fixture using seeded demo
data. The loader correctly quarantined that snapshot, so its expectation that
the name migrated as an ordinary workspace was invalid. The corrected test
uses user-owned name and member data, verifies their migration and the exact
raw recovery snapshot, and checks seeded demo quarantine separately. No
production migration code changed.

The first full rerun after the group fix exposed an unrelated asynchronous
test race in the package installer. The test clicked “Trust publisher key” and
asserted its request before the fingerprint calculation and request had
settled. It now waits within a bound for the rendered fingerprint, trusted
install control and installation result while retaining the exact route and
result assertions. The installer implementation was unchanged.

After installing declared locked dependencies into ignored package-local
`node_modules`, local `npm run real:check` passed: 342 workspace, 355 feature,
2 scoped SDK and 124 server tests, plus typechecks and builds. The prior
baseline failures, repeat run and full-check log are recorded by digest in
the [receipt](receipts/interface-merge-gates-20260919.json). This qualifies
the local checkout for review; hosted PR checks must rerun after the patch is
pushed.
