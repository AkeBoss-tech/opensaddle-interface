# Agent setup browser check — 2026-09-19

Environment: Vite at `http://127.0.0.1:5176/opensaddle-interface/`, disposable Core from [`scripts/agent-setup-browser-fixture.py`](../../scripts/agent-setup-browser-fixture.py) on loopback port 8767, Chrome. The fixture has one synthetic Project/source, a deterministic toy GitHub metadata adapter restricted to `fixture/public`, a local human principal and no provider subprocess or external account. Set a throwaway `OPENSADDLE_BROWSER_FIXTURE_TOKEN` before starting it; connect the Interface through Settings. Stop the fixture process to delete its temporary SQLite and blob state.

Observed through the normal `/project/browser-fixture/agents` route:

1. Core options populated the registered Git source and Codex/Claude supported-adapter selector, plus installed typed read actions. With an exact `github/get_repository` owner `fixture`, repo `public`, the editor displayed the pending constraint and rationale.
2. The draft review displayed the complete synthetic instructions, exact source ID, harness, definition digest, exact `owner`/`repo` grant and rationale, and assumption before publication. The publish control stayed disabled until the review checkbox was selected. Publication changed the selected proposal to `Published` and showed the task form.
3. A synthetic task admitted one queued Run, and `Open this Run` navigated to the matching authoritative task detail route. No worker was attached, so this proves UI-to-Core admission and Run navigation, not provider execution or connector dispatch.
4. After the fixture participant was changed to `paused` with revision 1 via Core's lifecycle API, a new task click showed `This agent is no longer available to start a task.` No new Run link appeared.
5. At a 390×844 browser viewport the two panels stacked in one column; the full review instructions, exact grant and task state remained readable. The viewport was reset after inspection. Browser error log was empty after the fix.

The first browser attempt exposed `TypeError: Illegal invocation` before option loading: the remote client invoked a captured `fetch` as a method of itself. The default transport now calls `globalThis.fetch(...)`, and the same browser route then completed the sequence above. Automated UI/client tests, typecheck and build passed after the change. Repo-wide lint retains an unrelated `ScopedWorkspace.tsx:45` Hooks error.

The browser captures used only fixture names and data. The computer-use screenshot API displayed the desktop and narrow frames inline during verification; it did not provide a repository file output path, so this record preserves the inspected states as text rather than claiming a saved screenshot artifact.
