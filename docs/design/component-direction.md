# A Codex-inspired OpenSaddle workbench

Reviewed September 20, 2026 after the user's request to use real component references and make OpenSaddle resemble Codex. This is an initial shell pass, not a completed redesign of every product surface.

| Reference | Useful pattern | Applied here |
| --- | --- | --- |
| [Rare UI Hook Sidebar](https://www.rareui.com/components/hooksidebar) | Labeled navigation groups and a clear selected route | One compact sidebar, persistent Project links and inset Project views. Keep normal links and keyboard focus; use a static selection instead of springs. |
| [Rare UI Task List](https://www.rareui.com/components/tasklist) | Compact, readable rows | Quieter outcome/task rows. Runtime completion remains server-owned; clicking a decorative checkbox must never mark a Run complete. |
| [ObsidianUI Apple Spotlight](https://www.obsidianui.dev/docs/apple-spotlight) | Search with shortcuts in a focused surface | A visible Search anything control opens the existing keyboard-accessible command palette; no second search index or backend. |
| [Rare UI Code Block](https://www.rareui.com/components/codeblock) | Filename, language, copy affordance | Candidate for a later artifact-view pass; not implemented in this slice. |

## Product choices

Use warm light/dark surfaces with plum and coral accents, a 244px sidebar, restrained selected rows, and a clear task-entry surface. Keep the OpenSaddle mark. Eliminate the duplicate project icon rail; named Project links remain available on Project routes. Put fleet/team operations under an expandable Workspace tools group, with Settings visible. Home leads with starting work and preserves authoritative objectives, approvals and outcomes below.

These are original React/CSS adaptations of interaction patterns, not copied library source. No new animation/UI dependencies. Rare UI describes personal/commercial use with attribution appreciated and prohibits reselling its components as a kit. ObsidianUI links an MIT license. No licensed source was vendored. Avoid animated orbs, spring-heavy sidebars, cursor effects and marketing scroll effects in the operational workspace.

## Scope and verification

The existing task routes, authority checks, run actions and data stores are unchanged. High contrast keeps its palette; reduced motion disables shell animation. Existing focused navigation/dashboard tests and TypeScript checks passed. A native package is used for visual inspection; that evidence must not be confused with a complete task-execution acceptance run.

The user subsequently requested more color and a stronger style guide. See [style-guide.md](style-guide.md) for the implemented brand palette and component rules.

Native interaction evidence: installed 0.2.3 opened command search, filtered with typed text, and navigated to Work using Down/Enter. The accessibility tree lagged during New task navigation; the screenshot subsequently showed the task form route, so no routing repair was needed or applied. No provider task was launched during design verification.
