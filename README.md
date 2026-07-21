# OpenSaddle Interface

Interactive enterprise agent workspace — React + Vite + TypeScript.

**Live demo:** https://akeboss-tech.github.io/opensaddle-interface/ (also https://akashdubey.me/opensaddle-interface/)

## Features

- Codex-style chat with streaming agent runs, tool cards, diffs, artifacts
- Auto routing pill (model · harness · runtime)
- **Agents** and **Workflows** areas (separate from chats)
- **Permissions** matrix scoped to users and agents (deny wins; intersection required)
- **Files** workspace with OPFS persistence + Worker WASM sandbox
- OAuth tool broker client (GitHub/Jira/Slack mock PKCE flow)
- Project sources (GitHub repos), folders, and inheritance-aware grants
- Environments wired to local / browser / KRAIL sessions
- OpenSaddle HTTP client for estimate/runs (falls back to mock)
- Electron desktop harness scaffold (`electron/`) for on-device CLIs

## Develop

```bash
npm install
npm run dev
```

Optional sidecars:

```bash
# OpenSaddle run/estimate API (from the opensaddle repo)
uv run opensaddle serve-api --port 8765

# KRAIL session service
npm install --prefix packages/krail
npm run krail
```

Desktop harness:

```bash
npm install --prefix electron
npm run desktop
```

Set `VITE_RUNTIME=mock|browser|desktop` to force capability mode.

## Build

```bash
npm run build
npm run preview
```

GitHub Pages serves from `/opensaddle-interface/`.

## Demo data

State persists in `localStorage` (`opensaddle-data-v3`) plus OPFS for files. Reset from **Settings → Reset to seed**.
