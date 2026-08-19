# Full working demo

## Demo A — product tour with seeded data

```sh
VITE_RUNTIME=mock npm run dev -- --host 127.0.0.1 --port 4173
```

Open <http://127.0.0.1:4173/opensaddle-interface/>.

Suggested walkthrough:

1. Start at the outcome prompt and point out the persistent simulation
   disclosure.
2. Ask: `Summarize the highest-priority work and show the evidence I should review.`
3. Open the completed run card to show its plan, tools, cited artifact, cost,
   and `Simulated` badge.
4. Open Work, use the Needs attention filter, and show approvals and blocked
   work across teams.
5. Open a project or thread to show the Buzz-like shared human/agent workspace
   and the OpenSaddle-specific evidence, changes, checks, and access inspector.

## Demo B — authoritative local onboarding

Install the KRAIL extra when running from a source checkout:

```sh
uv sync --extra krail
uv run opensaddle serve-api --host 127.0.0.1 --port 8765 --state-dir /tmp/opensaddle-demo-state
```

In the Interface checkout:

```sh
VITE_RUNTIME=browser VITE_OPENSADDLE_URL=http://127.0.0.1:8765 npm run dev -- --host 127.0.0.1 --port 5173
```

Open <http://127.0.0.1:5173/opensaddle-interface/>.

Suggested walkthrough:

1. Add a clean Git project and open KRAIL onboarding.
2. Run deterministic discovery and show the fingerprint, repository facts,
   evidence locators, and repository-backed verification commands.
3. Select Codex CLI or Claude Code and show its server-probed readiness.
4. Start **Analyze and propose setup**. Explain that the runner retains local
   host authority while OpenSaddle bounds and reviews only the detached-worktree
   diff.
5. Inspect the two proposal files and the exact diff digest.
6. Approve that unchanged digest. Show the passing verification receipt and
   durable `refs/opensaddle/onboarding/...` commit.
7. Stop before **Apply verified commit** unless the audience explicitly wants
   to demonstrate the separate fast-forward replay boundary.

Do not describe the mock tour as enforced governance, and do not describe a
durable onboarding commit as applied, pushed, or merged until those separate
actions have actually occurred.
