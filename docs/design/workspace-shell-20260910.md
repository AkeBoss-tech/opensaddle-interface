# Global workspace and project view model

## Product intent

The OpenSaddle logo opens the user's global workspace: a manager conversation spanning authorized projects and a customizable dashboard. A narrow outer rail selects teams/projects. A selected project's inner navigation contains only that project's views and configuration.

The interface style is independent of the coding agent. Codex-style, Grok Bot-style, and OpenClaw v2-style renderers must consume the same project tasks, history, evidence, and review contracts; choosing a renderer must not grant authority or change the executing agent.

## Navigation and ownership

- Global: manager conversation, dashboard, cross-project inbox/search, personal machines, user settings, plugin library.
- Team: team overview, shared projects, members, shared machines, policies, team settings and default views.
- Project: tasks, knowledge, artifacts, history, views, enabled plugins, project settings.
- Profile remains in the outer rail. User settings do not move into project settings.
- Project view preferences may have team/project defaults and a personal override. Effective security policy is computed by Core, not merged with appearance preferences.

## Required UI contracts

1. A persistent scope indicator identifies user, team, or project context. Cross-project manager actions identify their destination and permissions.
2. Manager conversation and dashboard are distinct global views. Dashboard customization adds/removes/reorders/resizes supported widgets and saves the user's layout. Widgets distinguish loading, empty, stale and unavailable states.
3. Machine inventory distinguishes personally owned machines, team-owned machines and project assignment. Assignment uses the existing authorization/worker lifecycle, not a second machine registry.
4. A project view selector lists installed compatible renderers, their package version and any missing capabilities. Renderer selection preserves the active project/task and shared task records.
5. View plugins declare routes, supported resource types, required capabilities and state schema/version. Core remains responsible for execution and approvals. Use the existing application hosts and extension contracts; do not load arbitrary plugin code directly into the main renderer.
6. Keep review, permissions, connection status and exact artifact provenance available consistently across renderers. Plugin failure falls back to a built-in view without losing project state.
7. Settings visibly separate User, Team and Project scopes. Show inherited policy and effective values. Shared defaults require the appropriate role; personal appearance overrides do not mutate team state.
8. One connection model drives shell selection and status. A temporary disconnection must not switch users into a different seeded/demo product shell. Deduplicate repeated recovery errors.

## Current implementation and gaps

The original saddle logo and Slack-like ThreadFirstSidebar remain in the repository. Connected local mode uses a separate shell. The connected shell now contains the saddle logo, project rail and project-specific built-in routes; it suppresses the inner project switcher while a project is selected.

The current home is project navigation, not a live cross-project manager. Custom dashboard persistence, separate user/team/project settings, and runtime-compatible interchangeable project renderers are not yet completed.

Desktop UI-plugin projectViews currently describe project-list density/fields. They are not full application renderers. The Perspective catalog has a supported Developer view and capability-gated Designer/Research manager definitions. Do not present those definitions or named renderer styles as installed working applications.

## Implementation sequence

Visual research and four generated directions are retained in [Perspective research](perspective-research-20260909/research-brief.md). Core's `docs/architecture/ui-research-integration.md` records the parent review. Start with Dialogue and Dispatch over shared records; Observatory comes later. Preserve one host and the existing saddle logo, and treat generated permissions, counts and content as illustrative.

1. Unify shell navigation, logo, profile, scope and connection handling while preserving existing operational state.
2. Implement explicit settings/machine ownership surfaces using authoritative contracts.
3. Deliver the global manager against real cross-project authorization and supported task dispatch; add a persisted dashboard with actual data widgets.
4. Extend the existing plugin/application host contracts into a project renderer selector; ship one complete default renderer, then an independently packaged alternate renderer as compatibility proof.
5. Verify project switching, per-project view persistence, plugin failure fallback, reconnect/restart and exact-result review end to end.
