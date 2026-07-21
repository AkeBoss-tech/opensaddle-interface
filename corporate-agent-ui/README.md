# AgentOS HTML Mockup

A standalone, interactive prototype for an enterprise AI agent workspace inspired by ChatGPT and Codex. Single file, no build step.

## Run

```bash
python3 -m http.server 4500
# then open http://localhost:4500/
```

Or open `index.html` directly in a modern browser.

## What to try

- **Codex-style agent run** — send a coding prompt ("Build a feature…"). You'll see streaming states (Planning → Reading files → Implementing → Running tests → Validating), a live task plan, expandable tool-call cards (input/output/duration/cost), and a **diff artifact** with accept/reject per hunk, revert-run, and "Create pull request".
- **Research run** — ask to "research/compare…" for a cited report artifact with retrieved sources.
- **Auto routing pill** — the composer shows `Auto · Model · Harness · Runtime`. Click it to see *why* the route was chosen, the estimated cost, routing preferences (fastest / lowest cost / highest quality / keep data local / enterprise-only / cost threshold), and manual model/harness/runtime overrides.
- **Run inspector** (top-right panel) — tabs for Activity (permission & tool timeline), Files touched, Sources, Environment, Permissions, and Run details with a user / developer / compliance **execution trace** plus run metrics (tokens, tool calls, cache hits, cost, approvals).
- **Granular permissions** — trigger with a "Salesforce", "deploy", or "email" prompt. The modal shows the capability, why it's needed, requesting project, data sent, receiving model, reversibility, and cost/risk, with grant scopes: once / this chat / this project / until date / always / deny / deny & add policy.
- **Projects & inheritance** — open a project → Permissions tab to see the scope lineage (Org → Engineering → Scarlet Sync → project) and per-capability sources: inherited from org/parent, overridden here, or explicitly denied.
- **Environments** — a runtime manager with local desktop, browser sandbox, ephemeral/persistent cloud, GPU, and restricted corporate environments (specs, packages, network policy, secrets, idle timeout, cost). "Provision runtime" opens a config side sheet.
- **Runs & automations** — scheduled, background, condition-based monitors, and cloud runtimes, with a chronological run timeline and pause/retry/duplicate controls.
- **Usage & budgets** — spend breakdowns (by project/runtime/harness/user), budgets with 50/80/100% alerts, cost-per-task, local vs cloud, and estimated Auto savings.
- **Command palette** — `⌘K` (or click the ⌘ icon) to navigate and run actions.
- **Themes** — the sun icon cycles Dark → Light → High-contrast.
- **Resizable** — drag the sidebar edge and the inspector edge.

## Keyboard

- `⌘K` command palette · `⌘N` new chat · `Esc` close overlays
