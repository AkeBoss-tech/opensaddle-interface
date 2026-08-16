# Connected local-project onboarding demo

The desktop onboarding route is `/project/:projectId/onboarding`. It is a client
of the authoritative Python OpenSaddle project API. Connected mode never starts
the legacy natural-language `/api/runs` task and never falls back to demo data.

## Demo prerequisites

- The local OpenSaddle service is connected and advertises both `projects` and
  `project_onboarding`. An older projects-only daemon is rejected before the
  renderer creates or navigates to a governed workspace.
- The folder is registered as an OpenSaddle local project.
- KRAIL is available to the Python service for deterministic discovery.
- Codex CLI or Claude Code is installed, authenticated, and reported ready by
  `/api/projects/:id/onboarding/readiness?runner=...`.
- Governed changes require a Git repository with a HEAD and a clean working
  tree. A non-Git or dirty folder can still be profiled, but the UI truthfully
  blocks agent execution.
- Existing source `.opensaddle` data is ignored by KRAIL discovery and cannot be
  targeted by governed actions. The UI presents it as an informational warning,
  not as a reason to block safe read-only discovery or an otherwise-ready run.

## Golden path

1. Add a local folder and leave **Prepare project profile and automation
   recommendations** enabled.
2. OpenSaddle registers the exact root, then navigates to the onboarding route.
   The backend registration completes before the renderer creates any local
   project, channel, agent, permission, or connector state.
3. `POST /api/projects/:id/onboarding/prepare` performs deterministic KRAIL
   discovery without launching an agent. The UI shows the bound fingerprint,
   repository facts, languages, and evidence-backed commands.
4. Choose the server-projected `project-orient` option and start it with the
   ready Codex or Claude runner. The server returns immediately and owns the
   detached-worktree run; the route polls its durable state across navigation
   and reloads. OpenSaddle reviews and promotes only that worktree diff; it does
   not provide OS, process, network, credential, or secret isolation.
5. Review the canonical `krail.project-profile/v1` and
   `krail.automation-recommendations/v1` proposals, every changed file, the
   complete patch, its SHA-256 digest, and the verification commands.
6. Approve that exact digest or reject and clean the worktree. Approval runs
   real verification, checks the diff again, and creates a commit only when the
   verified diff is unchanged.
7. Inspect the durable `refs/opensaddle/onboarding/:runId` commit. Applying it
   is a separate, explicit fast-forward guarded by the registered repository's
   current HEAD and clean status. Push and merge remain outside this flow.
8. Applying the orientation commit preserves the chained execution head, so a
   reviewed project action can be selected next. Applying an ordinary project
   action invalidates the discovery fingerprint; the UI requires a KRAIL
   refresh before another action can start.

## Failure states to demonstrate

- Disconnect the Python service: the page shows an unavailable connected
  contract and does not simulate success.
- Select a missing or unauthenticated runner: discovery remains available but
  the detached-worktree action is blocked with the failed readiness checks and the
  explicit warning that the subprocess retains the local user's host authority.
- Attach a non-Git, no-HEAD, or dirty folder: profile-only discovery remains
  visible while governed change execution is disabled.
- Fail a verification command: the receipt names the failed check and no commit
  or replay action appears.
- Change the worktree after review: the digest-bound approval fails stale rather
  than committing a different patch.
- Lose the HTTP response after apply: retrying uses the receipt's immutable base
  commit, so an already-fast-forwarded project reconciles without a second Git
  effect.
