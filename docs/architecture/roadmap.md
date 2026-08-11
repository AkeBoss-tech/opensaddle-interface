# Roadmap and Work Slices

> Derives from `README.md`. Read the three-layer frame first.

## Sequencing principle

Slices are ordered so that each one ships something usable on its own. Slice 1 is
unconditionally correct — it fixes shipped defects and needs no backend change. Slices
3–5 are the platform bet.

## Slice 1 — Entity layer (no backend change)

**Fixes today's defects.** Do this regardless of whether Wayfinder ever ships.

Build:
- `src/ui/EntityRef.tsx` — inline + block variants, hover preview, graceful unresolved
- `src/ui/EntityPicker.tsx` — typeahead, grouped by kind, keyboard driven
- `src/services/entityResolver.ts` — resolves `(kind, id)` → display data; local store
  first, remote fallback; batched and cached

Replace:
- `ChatPage.tsx:751-780` — the mention regex. Mentions become **structured references
  stored in the message**, not text that gets stripped. Delegation reads the reference;
  it never re-parses prose.
- `ChatPage.tsx:1935-1968` — the ad-hoc `slack-agent-picker` → `<EntityPicker>`
- `ChatPage.tsx:1854` + `team-channel.css:263` — the 👍 counter → `<ReactionBar>`

Done when:
- A mention round-trips through storage as structured data
- An @-mention renders as a styled chip with hover preview in every surface
- Removing the regex breaks nothing

## Slice 2 — Skills as substrate

Promote skills out of `LocalProjectSettings.skills` (`src/types/index.ts:48,73`) into a
workspace-level registry with project scoping.

```ts
interface Skill {
  id: string
  name: string
  description: string
  scope: 'workspace' | 'project'
  projectId?: string
  source: 'builtin' | 'local-folder' | 'plugin'
  path?: string
  enabled: boolean
}
```

Done when:
- `/` in any composer offers workspace skills
- A skill defined once is invocable from a channel, a thread, and a project page
- Local-folder skills still work, now as one `source` among several

## Slice 3 — Surface registry

Build:
- `src/surfaces/registry.ts` — register/lookup by id, with declared inputs
- `src/ui/SurfaceHost.tsx` — permission gate + error boundary + typed empty state
- `GET /api/surfaces`

Migrate **one existing page** (suggest the Work inbox) to render through `SurfaceHost` to
prove the boundary against real code rather than a toy.

Done when:
- A surface cannot reach the store directly — only declared inputs
- A surface that throws degrades to a recovery state without taking down the shell

## Slice 4 — ExternalArtifact + actionability

Build:
- `ExternalArtifact` type + `artifact`/`surface` resource kinds
- `GET/POST /api/artifacts*`, `POST /api/artifacts/:id/thread` with idempotency key
- Declarative actionability config → `<StateBadge>`
- Two-gate authorization with `gate` in the response
- GitHub adapter as a tool in the existing integration broker

Done when:
- No computed status is persisted anywhere
- A denied mutation reports which gate failed
- Artifacts render in the Work inbox alongside native work

## Slice 5 — Two views, together

**Do not cut this to one.** A single consumer produces an abstraction shaped exactly like
that consumer.

- Wayfinder DAG canvas
- Minimal board (columns from declarative state mapping)

Both registered surfaces, both consuming only Tier 1 + Tier 2 + declared inputs.

Done when:
- The board required **zero** changes below the view layer
- Any change one view needed that the other could not request was fixed in Tier 1, not
  special-cased

## Slice 6 — Visual polish

Independent of the above; can run in parallel.

- Tint sidebar with active team color (`--team-color` already exists in configure-team;
  light tokens already exist in `tokens.css`; they are simply not wired together)
- Collapse the redundant flat `TEAM CHANNELS` list into the project tree — the same
  channel currently appears in two places under two mental models
- Move `ADMIN` behind the team header gear
- Persistent search field replacing the magnifier icon
- Message density pass in the channel transcript

## Parallelization

| Slice | Depends on | Can run parallel with |
|---|---|---|
| 1 | — | 2, 6 |
| 2 | 1 (EntityPicker) | 6 |
| 3 | — | 1, 2, 6 |
| 4 | 3 | 6 |
| 5 | 4 | 6 |
| 6 | — | all |

Slices 1, 3, and 6 have no dependencies and can start immediately.

## Working agreements for agents

- **Match the surrounding code.** This repo uses no CSS framework — plain CSS with
  `--os-*` tokens from `src/styles/tokens.css`. Do not add Tailwind, styled-components,
  or a component library.
- **Do not add runtime dependencies** without flagging it. Current deps: react,
  react-dom, react-router-dom, and icon packs. That is deliberate.
- **Verify before claiming done:** `npm run typecheck && npm run lint && npm test`.
  The full gate is `npm run real:check`.
- Dark theme is the default; light and high-contrast must not break. Verify both.
- Reduced-motion and focus-ring tokens exist — use them.
- Do not touch `AkeBoss-tech/opensaddle` (the package repo) — out of scope.
- Prefer deleting redundant code over adding parallel code. Slice 1 should be net-negative
  lines in `ChatPage.tsx`.
