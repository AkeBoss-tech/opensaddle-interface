# UI Components

> Derives from `README.md`. Read the three-layer frame first.

## Where we are

`src/ui/` exports generic widgets only:

```
Button, Dialog, Drawer, EmptyState, Menu, Select,
SplitPane, Status, Tabs, Tooltip, VirtualList, cx
```

Nothing is domain-aware. That is precisely why channels feel empty: there is no component
that knows what an agent, an artifact, or an approval *is*, so every surface reinvents a
worse version inline.

Design tokens already exist and are good — `src/styles/tokens.css` covers surfaces,
content, semantic states, typography, spacing, focus, motion, plus light theme, high
contrast, and reduced motion. **Build on these tokens. Do not introduce new raw colors.**

## Tier 1 — Substrate components

Every surface needs these. Build them once, in `src/ui/`.

### `<EntityRef>`

The single most valuable component in this document. Renders a reference to *any*
principal or artifact.

```tsx
type EntityKind = 'user' | 'agent' | 'artifact' | 'thread' | 'run' | 'skill' | 'project'

interface EntityRefProps {
  kind: EntityKind
  id: string
  /** Compact inline chip (in prose) vs. block card. */
  variant?: 'inline' | 'block'
  /** Optional pre-resolved display data to avoid a resolver round-trip. */
  hint?: { label: string; avatarUrl?: string; state?: ActionabilityState }
  onActivate?: (kind: EntityKind, id: string) => void
}
```

Requirements:

- Inline variant renders as a chip with a kind glyph + label, tinted with the entity's
  semantic color (agent uses `--os-color-accent-soft`, artifact uses state color).
- Hover reveals a preview card (lazy-resolved). Click activates.
- Unresolvable entities render as a muted chip with the raw id and a tooltip — **never
  throw, never render blank.** External data is unreliable by definition.
- Keyboard focusable, correct `aria-label` including entity kind.

This component is the fix for @-mention styling **and** the body of every unfurl. Both
current problems collapse into building it well once.

### `<EntityPicker>`

The typeahead behind `@` and `/`.

```tsx
interface EntityPickerProps {
  kinds: EntityKind[]
  /** Scope resolution to a project; omit for workspace-wide. */
  projectId?: string
  query: string
  onSelect: (ref: { kind: EntityKind; id: string; label: string }) => void
}
```

Requirements:

- Backed by a **resolver service**, not a per-surface array. The current agent picker
  reads `data.agents` filtered by project inline; that is the bug.
- Grouped results by kind, keyboard navigable, ⏎ selects, Esc dismisses.
- `/` opens with `kinds: ['skill']` — this is how workspace-wide skills become invocable
  from any composer in the app.

### `<ArtifactCard>`

Source-badged compact unfurl. Same component for a PR, an issue, a thread, a run, a site.

- Header row: provider glyph + `Provider · Kind`, e.g. `GitHub · PR`.
- Title, truncated to one line.
- Footer: `<StateBadge>` + `<StalenessLabel>`.
- Entire card is one activation target. Max height fixed; never reflows the transcript.

### `<StateBadge>`

Renders the universal actionability vocabulary. One component, every surface.

```tsx
type ActionabilityState =
  | 'blocked' | 'actionable' | 'claimed' | 'in-progress' | 'done'
```

Map to existing semantic tokens: `blocked`→danger, `actionable`→accent,
`claimed`→warning, `in-progress`→info, `done`→success. **Never** introduce
methodology-specific labels ("frontier", "sprint-ready") into this component — those are
view-layer captions over the same state.

### `<ApprovalGate>`

Inline approve/deny with reason. The backend lifecycle already exists at
`/api/integrations/invocations/:id/{approve,deny,execute}` — there is simply no reusable
component in front of it.

- Shows what will happen, to which external system, under whose identity.
- Approve and Deny are equally weighted. Deny requires no reason; approve on an
  externally visible mutation shows the target explicitly.
- Renders its own resolved state after action (approved by X, 2m ago).

### `<StalenessLabel>`

```tsx
interface StalenessLabelProps {
  fetchedAt: number
  degraded?: boolean   // provider unreachable; serving cache
}
```

Mandatory once external data is canonical. Show staleness where it changes a decision —
on actionability and claim state, not on every field.

### `<PrincipalAvatar>` + `<PresenceDot>`

Humans and agents unified, because in this model they are the same kind of thing. An
agent avatar differs by glyph treatment, not by being a different component. Presence dot
composes onto it.

### `<ReactionBar>`

A real one. Pill list + add-reaction popover + hover toolbar anchored to the message.
Replaces the `useState` counter at `ChatPage.tsx:1854`.

## Tier 2 — Surface framework

### `<SurfaceHost>`

The registry render point.

- Looks up a registered surface by id, resolves its permission gate, renders it inside an
  error boundary.
- Passes only declared inputs. **A surface must not reach into the store directly** — if
  it can, the membrane does not exist.
- Renders a typed empty state when a surface has no data and a recovery state when it
  throws.

### `<SurfaceToolbar>` / `<FilterBar>`

Shared chrome so three different methodologies still feel like one application.

### `<WorkItemRow>`

The shared row shape that the Work inbox, a board card, and a DAG node detail all render.
One row component, three containers.

## Tier 3 — Per-methodology views

Only these are methodology-specific:

- **DAG canvas** — Wayfinder. Nodes, edges, frontier highlighting. Opens focused on
  actionable nodes, not full topology.
- **Board columns** — agile. Columns from a declarative state mapping, drag to transition.
- **Spec tree** — factory. Hierarchical, approval state per node.

Each is a registered surface consuming Tier 1 + Tier 2. **No view gets privileged data
access that another view could not also request.** If the DAG needs something the board
cannot ask for, that is a Tier 1 gap, not a DAG feature.

## Visual direction

Reference: Block's Buzz (`github.com/block/buzz`) for the human+agent workspace feel.

- Density over decoration. Message rows should be tight; the current channel wastes
  vertical space on an oversized intro block.
- **Tint the sidebar with the active team's color.** Per-team color already exists in the
  configure-team dialog and light tokens already exist — they are simply not wired
  together. `color-mix(in srgb, var(--team-color) 12%, var(--os-color-surface))`. This is
  the single highest-recognition visual change available, and it works in both themes.
- Agent messages differ from human messages by a chip, not by a card. Cards around agent
  output are what make a channel feel like a dashboard instead of a room.
- Hover actions, not always-visible buttons.

## Acceptance

A slice of this work is done when:

1. `<EntityRef>` renders a mention that survives a round-trip through storage as
   structured data — not text that gets regex-stripped.
2. `/` in any composer, anywhere in the app, offers workspace-level skills.
3. A second, hypothetical view could be written using only exported Tier 1 + Tier 2
   components and the declared surface inputs.
