# OpenSaddle Perspective visual research
Research date: 2026-09-09 (America/New_York). Public official pages only. No account sign-in, installations, external submissions, or OpenSaddle repository edits.

## Recommendation
Build three independently packaged project Perspectives—Dialogue, Observatory and Dispatch—over the same project/task/run/artifact/knowledge records. Give Global Home its own customizable, cross-project host surface. Let a Perspective change the information hierarchy and interaction grammar, not just colors. Keep agent provider choice independent.

The supplied architecture is the design authority here. Prior memory about permission-gated projections was used only as historical context; no existing repository implementation was audited.

## Reference findings and limits
**Codex.** The [official launch article](https://openai.com/index/introducing-the-codex-app/) documents project-organized task threads, review inside the thread and parallel work. The [current product page](https://openai.com/codex/) visibly demonstrates project and chat navigation beside a dominant work area. Useful pattern: a stable task entry point with progressive disclosure of review and artifacts. OpenSaddle adaptation: reserve project selection for the outer host rail; the inner sidebar lists only the selected project's channels and tasks. Captures are public webpage/product imagery, not a tested authenticated Codex session. The launch article is explicitly historical.

**Claude Code.** The [product page](https://claude.com/product/claude-code) visibly shows session navigation, a conversation and collapsed work activity. The [desktop reference](https://code.claude.com/docs/en/desktop#arrange-your-workspace) documents rearrangeable chat, diff, browser, terminal, file, plan, task and subagent panes. Useful pattern: the conversation remains meaningful while neighboring panes carry dense material. Apply bounded pane presets and a clear selected task in Dialogue. These are documented capabilities, not interactions executed in the app; the documentation itself gives version constraints.

**Grok Bot.** The name resolves to an [official product page](https://x.ai/bot), distinct from simply referring to Grok chat. It describes persistent teammate-style Bots, parallel work, learning routines and approval requests. Its animated marketing demonstration visibly separates a named-Bot list, conversation, and computer/work output. Borrow approachable participants and concise activity receipts; do not let an agent's identity become the only way to find a task. The original viewport capture is clipped; prefer the later grok-bot-demo.png viewport. The full-page capture has animation/stitching repetitions and is context only. No app behavior, background reliability, tool authority or approval semantics were tested.

**OpenClaw “v2”.** The verified reference is the [official Control UI documentation](https://docs.openclaw.ai/web/control-ui), which exposes sessions/sidebar, chat, panels/docks, settings, pairing, offline/reconnect and a Gateway relationship. This supports studying connection/recovery as explicit interface concerns. The specific “v2” visual designation could not be established from the focused official-source search; do not label these captures “OpenClaw v2.” No running Control UI was accessed and the screenshot is documentation, not an application screenshot. Adopt the visible separation of environment recovery from task content as a design recommendation, not a claim of product parity.

**Linear.** The [board-layout documentation](https://linear.app/docs/board-layout#swimlanes) documents shared board/list views, configurable grouping and swimlanes. Its expanded swimlane example visibly organizes readable project cards by status and time. Use status columns and optional assignee lanes in Dispatch, with an inspector to preserve board position while opening conversation/run evidence. The original “board” image is a decorative skeleton illustration and is not evidence of working behavior. The improved swimlane captures show official example imagery; board operations were not exercised.

**Milanote.** The [visual project management page](https://milanote.com/product/project-management) presents flexible spatial boards mixing text, images, files and tasks. Borrow deliberate spatial proximity and mixed evidence formats for Observatory. Add typed source/claim relationships and explicit provenance; do not imply that arbitrary adjacency proves support. The capture is marketing imagery with a cookie banner, not a live board.

## Generated directions
All four PNGs were created with the built-in imagegen tool. They are original generated concepts, not screenshots or proof of working OpenSaddle functionality. Exact prompts are in [concept-prompts.md](./concept-prompts.md). All people, evidence quotations, counts and task outcomes in them are illustrative.

| Direction | Visual and interaction purpose | First implementation slice |
|---|---|---|
| [Dialogue](./concepts/dialogue.png) | Warm ivory, editorial title, restrained terracotta; channel/task list → conversation → contextual artifact pane | Open one task, follow its run, inspect an artifact without leaving the conversation |
| [Observatory](./concepts/observatory.png) | Pale mint, evergreen type, spacious source → claim → synthesis canvas | Link a source to a claim; inspect provenance; show conflicting and incomplete evidence |
| [Dispatch](./concepts/dispatch.png) | Dark navy, cobalt activity, amber attention; board with persistent task inspector | Open a blocked task and reach host review with the same task/run selected |
| [Global Home](./concepts/global-home.png) | Bright editorial grid, named next actions, devices, recent artifacts | Continue a task across projects or open a concrete pending decision |

The “impossible image” ambition is expressed through dramatically different workspaces and polished visual direction. These are feasible interface concepts, not a claim of novel runtime capabilities.

## Host and plugin responsibilities
| Responsibility | Owner | Concrete rule |
|---|---|---|
| Logo, global Home, outer team/project rail, profile | Trusted host | Identical navigation and accessible names across Perspectives; plugin cannot replace these |
| Current user/team/project scope | Trusted host | Readable breadcrumb outside the plugin; data access is filtered by authority, not a visual filter |
| Connections, approvals, permission changes, recovery | Trusted host and its authoritative backend | Plugin may request a host review, never render an independent grant workflow |
| Project content area | Perspective package | Own layout, local navigation, density, canvas coordinates, inspector arrangement and presentational preferences |
| Projects, channels/tasks, runs, artifacts, knowledge | Shared domain services | Same records and links in every view; no second task store |
| Agent selection | Shared task/run configuration | Separate from Perspective selection; changing the view does not change the worker |
| Devices and their owners | Global host/domain | Device exists when unassigned; project assignment does not transfer ownership or imply permission |
| Device task access | Authoritative permissions | Show owner, assignment, effective actor/team access and unmet requirements separately |
| Global dashboard widgets | Host-controlled composition | User can arrange widgets; each receives only authorized cross-project projections |
| Failure and fallback | Trusted host | If a Perspective fails, retain scope, approvals and recovery; offer a basic task view |

A proposed package contract should declare its compatible host version, supported domain projections, theme variables and presentation preferences. Store layout preferences separately from domain state. Dispatching actions should go through host APIs with normal authorization checks. A crashed or unavailable package must not erase the selected task or hide a pending approval.

## Required corrections before implementation
The images establish direction, not an exact implementation specification:
- All four generations vary the host logo, colors and profile avatar. Freeze one host shell and identity across packages; only the content area should inherit the Perspective theme.
- Move Perspective selection into one stable host-owned project control. The generated placements differ.
- Dialogue calls the assistant “Atlas,” also the project name. Use a distinct agent display name and role. Remove the decorative sidebar slogan when space is needed for task navigation.
- Observatory invents studies, quotes and dates. Replace every example with explicitly labeled fixtures or real sourced records. A captured-today badge is not evidence freshness. Add source date, capture date and provenance inspection; a contradictory citation must not silently support the synthesis. Preserve a keyboard-accessible list equivalent to the canvas.
- Dispatch says any “team member” can approve. Replace with the actual authorized approver; “review required” is an unmet requirement, not an effective permission. The run trace must not imply device checks happened before access existed. Use explicit task, run and approval states rather than inferring them from card position.
- Global Home shows two decision rows but one approval in the header. Counts must derive from shared state. Replace the one-click “Approve” shortcut with “Review” opening the complete host decision. Replace the large ornamental mountain widget with an optional user-selected widget or a useful continuation.
- Supply responsive behavior: keep host scope/approvals reachable, collapse the inner navigation on narrow screens, turn inspectors into a full-width detail view with a return action, and offer a list view for boards/canvases. Provide focus order, keyboard movement, text state labels, contrast checks and reduced-motion behavior.

## Reference capture manifest
All paths below are actual browser captures. Preferred references are first. Screenshots retain the page's original content; no generated material was substituted.

| File | Source URL | What it establishes |
|---|---|---|
| [codex-workspace.png](./references/codex-workspace.png) | https://openai.com/codex/ | Public product workspace imagery; sidebar/task structure |
| [claude-code-product.png](./references/claude-code-product.png) | https://claude.com/product/claude-code | Public session/conversation demonstration |
| [claude-code-docs.png](./references/claude-code-docs.png) | https://code.claude.com/docs/en/desktop#arrange-your-workspace | Documented pane arrangement, with version note |
| [linear-swimlanes-detail.png](./references/linear-swimlanes-detail.png) | https://linear.app/docs/board-layout#swimlanes | Enlarged readable official board example |
| [linear-swimlanes.png](./references/linear-swimlanes.png) | https://linear.app/docs/board-layout#swimlanes | Example plus supporting documentation |
| [grok-bot-demo.png](./references/grok-bot-demo.png) | https://x.ai/bot | Preferred readable marketing demo frame; bottom composer partly clipped; not live app behavior |
| [grok-bot-full.png](./references/grok-bot-full.png) | https://x.ai/bot | Full public page; animation/stitching repetitions; context only |
| [grok-bot-overview.png](./references/grok-bot-overview.png) | https://x.ai/bot | Product identity and upper demo; viewport clips the lower demo |
| [openclaw-docs.png](./references/openclaw-docs.png) | https://docs.openclaw.ai/web/control-ui | Documentation only; no verified “v2” product screenshot |
| [milanote.png](./references/milanote.png) | https://milanote.com/product/project-management | Spatial board marketing image; cookie banner present |
| [codex.png](./references/codex.png) | https://openai.com/index/introducing-the-codex-app/ | Historical article text capture |
| [codex-product.png](./references/codex-product.png) | https://openai.com/codex/ | Product heading; limited interaction value |
| [grok-bot.png](./references/grok-bot.png) | https://x.ai/bot | Superseded clipped animation frame; limited |
| [linear-board.png](./references/linear-board.png) | https://linear.app/docs/board-layout | Decorative skeleton illustration; limited |

## Implementation handoff
Start with the host boundary and one shared fixture dataset. Demonstrate the same task in Dialogue, Observatory and Dispatch, preserving its selection, run history, artifacts and permissions while switching packages. Then add Home continuation and an unassigned device. Verify one denied action, one host approval, one disconnected state and one crashed-Perspective fallback. This proves the defining interaction contract before investing in polish.

Deliverables are local research and generated imagery only. No repository implementation, deployed experience or authenticated product validation is claimed.

