# design-sync notes — opensaddle-interface

## Repo shape

This repo is an Electron/React **app**, not a published component-library
package — there's no `dist/` entry with `.d.ts` exports and no Storybook.
Only 6 components were scoped in for this sync (user-approved, see chat):
`Icon`, `ProviderLogo` (both presentational, `src/components/common/`) and
`CommandPalette`, `ToastStack`, `Sidebar`, `Topbar` (all coupled to the app's
`StoreProvider` context and/or `react-router-dom`).

Everything else under `src/` (pages, `App.tsx`, `main.tsx`) is intentionally
excluded — `main.tsx` calls `ReactDOM.createRoot(...)` at module top level, so
the converter's default synth-entry mode (which blanket-exports every `.tsx`
file under `srcDir`) crashed the whole bundle (`Target container is not a DOM
element`) and left `window.OpenSaddleUI` empty. Fixed by hand-writing
`.design-sync/entry.ts` — a barrel that only re-exports the 6 scoped
components (+ `PROVIDER_NAME` from `ProviderLogo`, needed by its preview) —
and pointing `cfg.entry` at it. **If new components are added to the synced
set, add their re-export to `.design-sync/entry.ts` too** — the componentSrcMap
`.d.ts` extraction works off the pinned src path regardless, but the runtime
bundle (what previews actually render) only contains what `entry.ts` exports.

## Provider chain

`cfg.provider` chains the app's real `StoreProvider` (uses its own seed/demo
data via `createSeedData()` — not a mock) → `MemoryRouter` (from
`react-router-dom`, merged in via `cfg.extraEntries`). `StoreProvider` itself
is a repo-owned module, pulled in via `cfg.extraEntries: ["./src/data/store.tsx"]`
(needs the explicit `.tsx` extension — `cfgPath()` does `existsSync` with no
extension resolution).

## Fonts

App's CSS references `Inter` with no shipped `@font-face` (`[FONT_MISSING]`).
User chose to fetch it from Google Fonts (SIL OFL) rather than accept a
system-font substitute. Downloaded the "latin" subset variable-instance woff2
(covers weights 400/500/600/700 — Google serves the same file for all of
them) into `.design-sync/fonts/inter-latin.woff2` + `inter.css`, wired via
`cfg.extraFonts`.

## Known render warns

- `CommandPalette` `[RENDER_THIN]` (rendered height 0px) — the preview is
  correctly authored (`cardMode: "single"`, screenshot confirmed complete and
  styled). False positive: the component's `.palette-backdrop` is
  `position: fixed`, which collapses the measured root height even though
  content renders correctly. Confirmed via `_screenshots/review/common__CommandPalette.png`.
- `ToastStack` needed `cardMode: "single"` (it's a `position: fixed` toast
  stack — no grid layout can present it). The preview's wrapper div has
  `minHeight: 160` but the toast stack still renders in its real fixed
  top-right position, leaving most of the card visually empty — this matches
  real product behavior (toasts always float over the viewport), not a bug.

## Re-sync risks

- `.design-sync/entry.ts` is a hand-maintained file, not auto-generated.
  Adding/removing a component from `componentSrcMap` must be mirrored here or
  the runtime bundle silently omits it (dts/prompt.md would still generate,
  but the preview would floor-card with "Element type is invalid").
- The Inter font file was fetched once from a live Google Fonts CDN URL
  (`fonts.googleapis.com/css2?family=Inter`) baked into `.design-sync/fonts/`.
  If Inter's static asset versioning changes upstream, nothing here will
  detect drift automatically — it's a one-time snapshot.
- Only 6 of the app's UI components are synced. Scope was explicitly limited
  to `src/components/common/` + 2 layout components coupled to app state; the
  much larger set of page-level components (`src/pages/*`) was excluded as
  out of scope, not because of a technical limitation.
