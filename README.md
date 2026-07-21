# OpenSaddle Interface

Interactive enterprise agent workspace prototype — React + Vite + TypeScript, with localStorage-backed mock data.

**Live demo:** https://akeboss-tech.github.io/opensaddle-interface/

## Features

- Codex-style chat with streaming agent runs, tool cards, diffs, artifacts
- Auto routing pill (model · harness · runtime) with preferences
- Project-scoped chats, agents, sites, quick APIs/scripts, dashboards, custom interfaces
- Shared/private visibility for resources
- Runs & automations, environments, plugin store, usage/budgets
- Organization admin + settings
- Seeded demo conversations and ⌘K command palette
- Dark / light / high-contrast themes

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

GitHub Pages serves from `/opensaddle-interface/` (`base` in `vite.config.ts`).

## Demo data

All state persists in `localStorage` (`opensaddle-data-v1`). Reset from **Settings → Reset to seed**.
