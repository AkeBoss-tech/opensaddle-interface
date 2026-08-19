# UI demo-readiness audit — 2026-08-19

## Outcome

The demo-critical interface path is ready for a live walkthrough. Mock mode is
now intentionally and persistently identified as simulated, while connected
local mode remains server-authoritative and never falls back to a simulated
success. The connected journey was exercised through deterministic KRAIL
discovery, a real Codex CLI run in a detached worktree, exact-digest approval,
passing verification, and creation of a durable unapplied commit.

This audit combines:

- an independent read-only Claude Code audit of Interface HEAD;
- live browser inspection at desktop and 390px mobile widths;
- primary-source review of Block Buzz and Grok;
- automated source, contract, accessibility, and build checks; and
- a live OpenSaddle loopback-control-plane rehearsal.

## Claude Code findings and disposition

The raw Claude report is retained outside the repository at
`/Users/akashdubey/.codex/claude-bridge/outbox/opensaddle-ui-audit.md`.

| Finding | Severity | Disposition |
| --- | --- | --- |
| Demo disclosure component existed but was not mounted | P0 | Fixed; the shell now mounts truthful mode-specific copy. |
| Mock steady state appeared as `Connecting` / `Waiting for server` | P0 | Fixed; mock mode has an explicit `Demo` presentation and simulated-workspace status. |
| Composer asserted control-plane enforcement in mock mode | P0 | Fixed; the composer and each run card identify simulation. |
| Work tabs lacked keyboard and panel semantics | P1 | Fixed with the shared `Tabs` primitive; arrow, Home, and End behavior verified live. |
| Two sidebar dialogs lacked focus containment and restoration | P1 | Fixed with `useModalFocus`; trap, Escape close, and focus restoration verified live. |
| Agent and session tab sets were incomplete | P1 | Fixed with roving focus and explicit tab-panel relationships. |
| Connected-local navigation lacked active-page semantics | P1 | Fixed with `NavLink`; `aria-current="page"` verified live. |
| A route error could replace the entire shell | P1 | Fixed with a route-level boundary inside the persistent chrome. |
| Empty-state, naming, breakpoint, and native-confirm drift | P2/P3 | Recorded as post-demo consolidation; none blocks the demonstrated journey. |

## Live findings not visible in the source-only audit

Two real integration issues were found and fixed during the connected rehearsal:

1. `VITE_RUNTIME=mock` previously defaulted to a remote local-server profile,
   which made the intended demo appear disconnected. The default profile is now
   derived explicitly from runtime mode.
2. The authoritative `krail.project-discovery/v1` response projects ecosystems
   as evidence-bearing objects. The Interface adapter accepted only legacy
   string entries. It now validates the authoritative object and projects its
   name for display, while retaining strict failure on malformed values.

The first prompt could also race service initialization. Start now keeps the
prompt editable but disables dispatch until the runtime exists, so a fast Enter
cannot create a false runtime-unavailable failure.

## Buzz and Grok comparison

Primary sources:

- Block Buzz README: <https://github.com/block/buzz/blob/main/README.md>
- Block Buzz architecture: <https://github.com/block/buzz/blob/main/ARCHITECTURE.md>
- Grok product page: <https://x.ai/grok>
- Grok product documentation: <https://docs.x.ai/grok/overview>
- X Grok help and privacy controls: <https://help.x.com/en/using-x/about-grok>

| Dimension | OpenSaddle | Buzz | Grok | Product decision |
| --- | --- | --- | --- | --- |
| First action | Outcome prompt on Start | Enter a shared room/channel | Minimal central prompt | Keep the Grok-like low-friction Start surface. |
| Collaboration | Human, agent, task, evidence, and review surfaces | Humans and agents share rooms and one signed event substrate | Primarily an assistant conversation | Preserve Buzz-like shared workspace density after the first prompt. |
| Work visibility | Plans, tools, changes, checks, evidence, approvals, and runtime | Messages, reactions, workflows, approvals, and Git events share the log | Search/reasoning modes and multi-agent work are progressively exposed | Keep OpenSaddle's structured inspector; do not collapse governed work into transcript prose. |
| Authority | Explicit project policy, exact diff, verification receipt, durable ref, separate apply | Signed identity and event-log auditability | User-facing privacy, personalization, and history controls | Make the active authority boundary ambient and impossible to infer incorrectly. |
| Density | High after entry, with Start as the decompression layer | High-density team communication | Sparse composer-first experience | Use a deliberate two-speed UI: Grok-like entry, Buzz-like workspace, OpenSaddle-specific review. |

OpenSaddle should not imitate either product wholesale. Its defensible interface
is the combination: Grok's low-friction prompt, Buzz's human/agent shared-work
density, and OpenSaddle's own evidence and authority model.

## Acceptance evidence

- Mock Start redirected to `/start`, rendered at 1440px and 390px without
  horizontal overflow, and produced no browser console errors.
- A fast first prompt was held until runtime readiness, then completed through
  the simulated run path with global, composer, run-card, and status-bar
  disclosure.
- Work tabs exposed `aria-controls`, one active tab stop, one tab panel, and
  successful ArrowRight focus/selection behavior.
- The New task dialog kept focus inside after repeated Tab presses, closed on
  Escape, and restored focus to its trigger.
- The local API advertised `mode=local`, durable SQLite storage, `projects`,
  `project_onboarding`, and the exact onboarding contracts.
- Live discovery bound clean HEAD `ded820bcc077943dd6a468c5e123eff8a3aa22fc`
  to fingerprint
  `sha256:80a5d038764a4684690334e58bf57d660376e650f1b559000fa1fc9aaaaf2cb8`.
- Codex produced only the two allowed proposal files in the detached worktree.
- Exact diff digest
  `sha256:d9a3183617440f241b0ea748711c96e28a2dcf8d87d1431b166497dd8c457a77`
  was approved after inspection.
- Verification `validate-krail-onboarding-proposals` passed and produced durable
  commit `341c510def4bebf31f4c86544de69b29e8574089` at
  `refs/opensaddle/onboarding/onb_dbcb01e2cef94a438473b9ddd0c8ae02`.
- The durable commit was deliberately not applied, pushed, or merged. The
  registered source checkout remained clean at its original HEAD.

## Remaining non-demo work

- Consolidate empty states onto `ui/EmptyState`.
- Centralize route labels used by navigation, breadcrumbs, and the palette.
- Replace native destructive `confirm()` calls with `ui/Dialog`.
- Reduce breakpoint sprawl and split the large production bundle.
- A signed and notarized macOS distribution remains a release/operations gate,
  separate from the working local demo.
